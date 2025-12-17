const { GifWriter } = require('../libs/omggif.js')

function buildPalette256_8x8x4() {
  const colors = []
  const rLevels = []
  const gLevels = []
  const bLevels = [0, 85, 170, 255]
  for (let i = 0; i < 8; i++) {
    rLevels.push(Math.round((i / 7) * 255))
    gLevels.push(Math.round((i / 7) * 255))
  }
  for (let r = 0; r < 8; r++) {
    for (let g = 0; g < 8; g++) {
      for (let b = 0; b < 4; b++) {
        const rr = rLevels[r]
        const gg = gLevels[g]
        const bb = bLevels[b]
        colors.push((rr << 16) | (gg << 8) | bb)
      }
    }
  }
  return { colors, rLevels, gLevels, bLevels }
}

const PALETTE_256_INFO = buildPalette256_8x8x4()
const PALETTE_256 = PALETTE_256_INFO.colors

function clampByte(n) {
  if (n < 0) return 0
  if (n > 255) return 255
  return n
}

function quantizeIndexAndColor(r, g, b) {
  const rIdx = Math.max(0, Math.min(7, Math.round((r * 7) / 255)))
  const gIdx = Math.max(0, Math.min(7, Math.round((g * 7) / 255)))
  const bIdx = Math.max(0, Math.min(3, Math.round((b * 3) / 255)))
  const idx = (rIdx * 8 + gIdx) * 4 + bIdx

  const rr = PALETTE_256_INFO.rLevels[rIdx]
  const gg = PALETTE_256_INFO.gLevels[gIdx]
  const bb = PALETTE_256_INFO.bLevels[bIdx]
  return { idx, rr, gg, bb }
}

function sleep0() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 端侧图片序列合成 GIF（稳定优先）
 * @param {Object} options
 * @param {{path:string}[]} options.images 选择的图片路径列表（按顺序）
 * @param {any} options.canvas 2d canvas node
 * @param {any} options.ctx 2d context
 * @param {number} options.maxSidePx 最长边像素
 * @param {number} options.frameDelayMs 每帧时长 ms
 * @param {number} options.loop 0=无限循环，>0 循环次数
 * @param {(p:{step:string, index:number, total:number})=>void} [options.onProgress] 进度回调
 * @returns {Promise<{outPath:string, width:number, height:number, size:number}>}
 */
async function convertImagesToGif(options) {
  const {
    images,
    canvas,
    ctx,
    maxSidePx,
    frameDelayMs,
    loop,
    dither,
    onProgress,
  } = options || {}

  if (!images || !images.length) throw new Error('请先选择图片')
  if (!canvas || !ctx) throw new Error('画布未就绪，请稍后重试')
  if (!maxSidePx || maxSidePx <= 0) throw new Error('参数不合法：最长边')
  if (!frameDelayMs || frameDelayMs <= 0) throw new Error('参数不合法：帧时长')

  const total = images.length
  const delayCs = Math.max(1, Math.round(frameDelayMs / 10)) // GIF delay in centiseconds

  // 先加载第一张确定尺寸（保持宽高比）
  const firstInfo = await wx.getImageInfo({ src: images[0].path })
  const w0 = firstInfo.width || 0
  const h0 = firstInfo.height || 0
  if (!w0 || !h0) throw new Error('读取图片信息失败')

  const scale = Math.min(1, maxSidePx / Math.max(w0, h0))
  const outW = Math.max(1, Math.round(w0 * scale))
  const outH = Math.max(1, Math.round(h0 * scale))

  canvas.width = outW
  canvas.height = outH

  // 预估 buffer（粗略）：头+每帧压缩块，给一个较宽裕的上限，避免越界
  const maxBytes = Math.min(60 * 1024 * 1024, 1024 * 1024 + outW * outH * total) // 上限 60MB
  const buffer = new Uint8Array(maxBytes)
  const writer = new GifWriter(buffer, outW, outH, { loop: loop })

  for (let i = 0; i < total; i++) {
    const imgPath = images[i].path
    if (typeof onProgress === 'function') onProgress({ step: '绘制', index: i + 1, total })

    // 加载图片到 canvas
    const img = canvas.createImage()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = imgPath
    })

    ctx.clearRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, outW, outH)

    if (typeof onProgress === 'function') onProgress({ step: '取像素', index: i + 1, total })
    const imageData = ctx.getImageData(0, 0, outW, outH)
    const rgba = imageData.data
    const indexed = new Uint8Array(outW * outH)

    if (dither) {
      // Floyd–Steinberg dithering (err arrays store numerator with /16 denominator)
      const errR = new Int32Array(outW + 2)
      const errG = new Int32Array(outW + 2)
      const errB = new Int32Array(outW + 2)
      let nextR = new Int32Array(outW + 2)
      let nextG = new Int32Array(outW + 2)
      let nextB = new Int32Array(outW + 2)

      for (let y = 0; y < outH; y++) {
        // reset next row
        nextR.fill(0)
        nextG.fill(0)
        nextB.fill(0)

        for (let x = 0; x < outW; x++) {
          const p = (y * outW + x) * 4
          const a = rgba[p + 3]
          // alpha blend to white (no transparency)
          const invA = 255 - a
          let r = rgba[p] * a / 255 + 255 * invA / 255
          let g = rgba[p + 1] * a / 255 + 255 * invA / 255
          let b = rgba[p + 2] * a / 255 + 255 * invA / 255

          r = clampByte(Math.round(r + errR[x + 1] / 16))
          g = clampByte(Math.round(g + errG[x + 1] / 16))
          b = clampByte(Math.round(b + errB[x + 1] / 16))

          const q = quantizeIndexAndColor(r, g, b)
          indexed[y * outW + x] = q.idx

          const dr = r - q.rr
          const dg = g - q.gg
          const db = b - q.bb

          // distribute error
          errR[x + 2] += dr * 7
          errG[x + 2] += dg * 7
          errB[x + 2] += db * 7

          nextR[x] += dr * 3
          nextG[x] += dg * 3
          nextB[x] += db * 3

          nextR[x + 1] += dr * 5
          nextG[x + 1] += dg * 5
          nextB[x + 1] += db * 5

          nextR[x + 2] += dr * 1
          nextG[x + 2] += dg * 1
          nextB[x + 2] += db * 1
        }

        // swap rows
        errR.set(nextR)
        errG.set(nextG)
        errB.set(nextB)
      }
    } else {
      for (let p = 0, j = 0; p < rgba.length; p += 4, j++) {
        const a = rgba[p + 3]
        const invA = 255 - a
        const r = clampByte(Math.round(rgba[p] * a / 255 + 255 * invA / 255))
        const g = clampByte(Math.round(rgba[p + 1] * a / 255 + 255 * invA / 255))
        const b = clampByte(Math.round(rgba[p + 2] * a / 255 + 255 * invA / 255))
        indexed[j] = quantizeIndexAndColor(r, g, b).idx
      }
    }

    if (typeof onProgress === 'function') onProgress({ step: '编码', index: i + 1, total })
    writer.addFrame(0, 0, outW, outH, indexed, {
      palette: PALETTE_256,
      delay: delayCs,
      disposal: 1,
    })

    // 让出事件循环，避免 UI 假死
    await sleep0()
  }

  const gifSize = writer.end()
  const gifBytes = buffer.slice(0, gifSize)

  const fs = wx.getFileSystemManager()
  const outPath = `${wx.env.USER_DATA_PATH}/gif_${Date.now()}.gif`
  if (typeof onProgress === 'function') onProgress({ step: '写入文件', index: total, total })
  fs.writeFileSync(outPath, gifBytes.buffer, 'binary')

  // 获取文件大小
  let size = 0
  try {
    const stat = fs.statSync(outPath)
    size = stat.size || 0
  } catch (e) {}

  return { outPath, width: outW, height: outH, size }
}

module.exports = {
  convertImagesToGif,
}


