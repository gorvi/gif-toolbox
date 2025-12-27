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

function configureSmoothing(ctx, quality) {
  if (!ctx) return
  if (typeof ctx.imageSmoothingEnabled !== 'undefined') {
    ctx.imageSmoothingEnabled = quality !== 'none'
  }
  if (typeof ctx.imageSmoothingQuality !== 'undefined') {
    ctx.imageSmoothingQuality = quality === 'high' ? 'high' : 'low'
  }
}

function getCoverCropRect(imageItem, iw, ih, outW, outH) {
  const clamp01 = (n) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return 0
    if (v < 0) return 0
    if (v > 1) return 1
    return v
  }

  const item = imageItem || {}
  const rect = item.cropRect
  if (rect && typeof rect.sx === 'number' && typeof rect.sy === 'number' && typeof rect.sw === 'number' && typeof rect.sh === 'number') {
    const sx = Math.max(0, Math.min(iw - 1, Math.round(rect.sx)))
    const sy = Math.max(0, Math.min(ih - 1, Math.round(rect.sy)))
    const sw = Math.max(1, Math.min(iw - sx, Math.round(rect.sw)))
    const sh = Math.max(1, Math.min(ih - sy, Math.round(rect.sh)))
    return { sx, sy, sw, sh }
  }

  const cropConfig = item.cropConfig
  if (cropConfig && typeof cropConfig.x === 'number' && typeof cropConfig.y === 'number' && typeof cropConfig.width === 'number' && typeof cropConfig.height === 'number') {
    const x = clamp01(cropConfig.x)
    const y = clamp01(cropConfig.y)
    const w = clamp01(cropConfig.width)
    const h = clamp01(cropConfig.height)

    const sx = Math.max(0, Math.min(iw - 1, Math.round(x * iw)))
    const sy = Math.max(0, Math.min(ih - 1, Math.round(y * ih)))
    const sw = Math.max(1, Math.min(iw - sx, Math.round(Math.min(1 - x, w) * iw)))
    const sh = Math.max(1, Math.min(ih - sy, Math.round(Math.min(1 - y, h) * ih)))
    return { sx, sy, sw, sh }
  }

  const outAspect2 = outW / outH
  const srcAspect = iw / ih
  let sx = 0
  let sy = 0
  let sw = iw
  let sh = ih
  if (srcAspect > outAspect2) {
    sh = ih
    sw = Math.max(1, Math.round(ih * outAspect2))
    sx = Math.round((iw - sw) / 2)
    sy = 0
  } else {
    sw = iw
    sh = Math.max(1, Math.round(iw / outAspect2))
    sx = 0
    sy = Math.round((ih - sh) / 2)
  }
  return { sx, sy, sw, sh }
}

function isLikelyBinaryImage(rgba, outW, outH) {
  const w = Math.max(1, outW | 0)
  const h = Math.max(1, outH | 0)
  const total = w * h
  const targetSamples = 2000
  const step = Math.max(1, Math.floor(Math.sqrt(total / targetSamples)))

  let black = 0
  let white = 0
  let mid = 0
  let samples = 0

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4
      const r = rgba[p]
      const g = rgba[p + 1]
      const b = rgba[p + 2]
      const l = (r * 299 + g * 587 + b * 114) / 1000
      if (l <= 30) black++
      else if (l >= 225) white++
      else mid++
      samples++
    }
  }

  if (!samples) return false
  const bwRatio = (black + white) / samples
  const midRatio = mid / samples
  return bwRatio >= 0.92 && midRatio <= 0.08
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
    outAspect,
    frameDelayMs,
    loop,
    dither,
    onProgress,
  } = options || {}

  if (!images || !images.length) throw new Error('请先选择图片')
  if (!canvas || !ctx) throw new Error('画布未就绪，请稍后重试')
  if (!maxSidePx || maxSidePx <= 0) throw new Error('参数不合法：导出分辨率')
  if (!frameDelayMs || frameDelayMs <= 0) throw new Error('参数不合法：帧时长')

  const total = images.length
  const delayCs = Math.max(1, Math.round(frameDelayMs / 10)) // GIF delay in centiseconds

  // 先加载第一张确定画布尺寸（保持宽高比）
  const firstInfo = await wx.getImageInfo({ src: images[0].path })
  const w0 = firstInfo.width || 0
  const h0 = firstInfo.height || 0
  if (!w0 || !h0) throw new Error('读取图片信息失败')

  const maxDim0 = Math.max(w0, h0)
  const baseLongEdge = maxSidePx

  let outW = 0
  let outH = 0
  if (outAspect && outAspect > 0 && Number.isFinite(outAspect)) {
    if (outAspect >= 1) {
      outW = baseLongEdge
      outH = Math.max(1, Math.round(outW / outAspect))
    } else {
      outH = baseLongEdge
      outW = Math.max(1, Math.round(outH * outAspect))
    }
  } else {
    const scale = baseLongEdge / maxDim0
    outW = Math.max(1, Math.round(w0 * scale))
    outH = Math.max(1, Math.round(h0 * scale))
  }

  canvas.width = outW
  canvas.height = outH

  // 预估 buffer（粗略）：头+每帧压缩块，给一个较宽裕的上限，避免越界
  const maxBytes = Math.min(60 * 1024 * 1024, 1024 * 1024 + outW * outH * total) // 上限 60MB
  const buffer = new Uint8Array(maxBytes)
  const writer = new GifWriter(buffer, outW, outH, { loop: loop })

  for (let i = 0; i < total; i++) {
    const imgPath = images[i].path
    if (typeof onProgress === 'function') onProgress({ step: '绘制', index: i + 1, total })

    const info = await wx.getImageInfo({ src: imgPath })
    const iw = info.width || 0
    const ih = info.height || 0
    if (!iw || !ih) throw new Error('读取图片信息失败')

    // 加载图片到 canvas
    const img = canvas.createImage()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = imgPath
    })

    ctx.clearRect(0, 0, outW, outH)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, outW, outH)

    const fitMode = (images[i] && images[i].fitMode) || 'contain'
    configureSmoothing(ctx, dither ? 'high' : 'low')
    if (fitMode === 'cover') {
      const rect = getCoverCropRect(images[i], iw, ih, outW, outH)
      ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outW, outH)
    } else {
      const fitScale = Math.min(outW / iw, outH / ih)
      const dw = Math.max(1, Math.round(iw * fitScale))
      const dh = Math.max(1, Math.round(ih * fitScale))
      const dx = Math.round((outW - dw) / 2)
      const dy = Math.round((outH - dh) / 2)
      ctx.drawImage(img, dx, dy, dw, dh)
    }

    if (typeof onProgress === 'function') onProgress({ step: '取像素', index: i + 1, total })
    let imageData = ctx.getImageData(0, 0, outW, outH)
    let rgba = imageData.data
    const binary = dither ? isLikelyBinaryImage(rgba, outW, outH) : false

    if (binary) {
      ctx.clearRect(0, 0, outW, outH)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, outW, outH)
      configureSmoothing(ctx, 'none')
      if (fitMode === 'cover') {
        const rect = getCoverCropRect(images[i], iw, ih, outW, outH)
        ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outW, outH)
      } else {
        const fitScale = Math.min(outW / iw, outH / ih)
        const dw = Math.max(1, Math.round(iw * fitScale))
        const dh = Math.max(1, Math.round(ih * fitScale))
        const dx = Math.round((outW - dw) / 2)
        const dy = Math.round((outH - dh) / 2)
        ctx.drawImage(img, dx, dy, dw, dh)
      }
      imageData = ctx.getImageData(0, 0, outW, outH)
      rgba = imageData.data
    }
    const indexed = new Uint8Array(outW * outH)

    if (dither && !binary) {
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
