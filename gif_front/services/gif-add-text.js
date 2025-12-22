const { GifReader, GifWriter } = require('../libs/omggif.js')

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

function readFileAsUint8Array(filePath) {
  const fs = wx.getFileSystemManager()
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success: (res) => {
        const data = res && res.data
        if (!data) {
          reject(new Error('读取文件失败'))
          return
        }
        resolve(new Uint8Array(data))
      },
      fail: (e) => reject(new Error((e && e.errMsg) ? e.errMsg : '读取文件失败')),
    })
  })
}

function u8ToAscii(u8, start, len) {
  const s = Math.max(0, start | 0)
  const l = Math.max(0, len | 0)
  const end = Math.min(u8.length, s + l)
  let out = ''
  for (let i = s; i < end; i++) out += String.fromCharCode(u8[i])
  return out
}

function detectFileKind(bytes) {
  const u8 = bytes || new Uint8Array(0)
  if (u8.length >= 6) {
    const h6 = u8ToAscii(u8, 0, 6)
    if (h6 === 'GIF87a' || h6 === 'GIF89a') return { kind: 'gif', label: 'GIF' }
  }

  if (u8.length >= 12) {
    const riff = u8ToAscii(u8, 0, 4)
    const webp = u8ToAscii(u8, 8, 4)
    if (riff === 'RIFF' && webp === 'WEBP') return { kind: 'webp', label: 'WebP' }
  }

  if (u8.length >= 8) {
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return { kind: 'png', label: 'PNG' }
  }

  if (u8.length >= 3) {
    if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return { kind: 'jpg', label: 'JPG' }
  }

  if (u8.length >= 12) {
    const ftyp = u8ToAscii(u8, 4, 4)
    if (ftyp === 'ftyp') return { kind: 'video', label: '视频文件' }
  }

  return { kind: 'unknown', label: '未知格式' }
}

function assertGifBytes(bytes) {
  const info = detectFileKind(bytes)
  if (info.kind === 'gif') return
  if (info.kind === 'webp') {
    throw new Error('当前文件是 WebP 动图（微信常见），暂不支持；请尝试“聊天选择”并选择 .gif 文件')
  }
  if (info.kind === 'png' || info.kind === 'jpg') {
    throw new Error(`当前文件是 ${info.label}，不是 GIF（可能相册选择时被转成静态图）；请尝试“聊天选择”并选择 .gif 文件`)
  }
  if (info.kind === 'video') {
    throw new Error('当前文件是视频，不是 GIF；请尝试“聊天选择”并选择 .gif 文件')
  }
  throw new Error('当前文件不是标准 GIF；请尝试“聊天选择”并选择 .gif 文件')
}

function clearRectRGBA(buffer, imgW, imgH, x, y, w, h) {
  const x0 = Math.max(0, Math.min(imgW, x | 0))
  const y0 = Math.max(0, Math.min(imgH, y | 0))
  const w0 = Math.max(0, w | 0)
  const h0 = Math.max(0, h | 0)
  if (!w0 || !h0) return

  const x1 = Math.min(imgW, x0 + w0)
  const y1 = Math.min(imgH, y0 + h0)
  for (let yy = y0; yy < y1; yy++) {
    const row = (yy * imgW + x0) * 4
    const end = (yy * imgW + x1) * 4
    buffer.fill(0, row, end)
  }
}

function resampleBilinearRGBA(srcRGBA, srcW, srcH, outW, outH, outRGBA) {
  if (srcW === outW && srcH === outH) {
    outRGBA.set(srcRGBA)
    return
  }

  const scaleX = srcW / outW
  const scaleY = srcH / outH

  for (let y = 0; y < outH; y++) {
    const sy = (y + 0.5) * scaleY - 0.5
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)))
    const y1 = Math.min(srcH - 1, y0 + 1)
    const dy = sy - y0

    for (let x = 0; x < outW; x++) {
      const sx = (x + 0.5) * scaleX - 0.5
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)))
      const x1 = Math.min(srcW - 1, x0 + 1)
      const dx = sx - x0

      const p00 = (y0 * srcW + x0) * 4
      const p10 = (y0 * srcW + x1) * 4
      const p01 = (y1 * srcW + x0) * 4
      const p11 = (y1 * srcW + x1) * 4

      const w00 = (1 - dx) * (1 - dy)
      const w10 = dx * (1 - dy)
      const w01 = (1 - dx) * dy
      const w11 = dx * dy

      const outP = (y * outW + x) * 4
      outRGBA[outP] = clampByte(Math.round(srcRGBA[p00] * w00 + srcRGBA[p10] * w10 + srcRGBA[p01] * w01 + srcRGBA[p11] * w11))
      outRGBA[outP + 1] = clampByte(Math.round(srcRGBA[p00 + 1] * w00 + srcRGBA[p10 + 1] * w10 + srcRGBA[p01 + 1] * w01 + srcRGBA[p11 + 1] * w11))
      outRGBA[outP + 2] = clampByte(Math.round(srcRGBA[p00 + 2] * w00 + srcRGBA[p10 + 2] * w10 + srcRGBA[p01 + 2] * w01 + srcRGBA[p11 + 2] * w11))
      outRGBA[outP + 3] = clampByte(Math.round(srcRGBA[p00 + 3] * w00 + srcRGBA[p10 + 3] * w10 + srcRGBA[p01 + 3] * w01 + srcRGBA[p11 + 3] * w11))
    }
  }
}

function normalizeText(text) {
  const t = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return t.trim()
}

function parseHexColor(hex) {
  const s = String(hex || '').trim()
  if (!s) return null
  if (s.startsWith('#') && (s.length === 7 || s.length === 4)) {
    if (s.length === 7) {
      const r = parseInt(s.slice(1, 3), 16)
      const g = parseInt(s.slice(3, 5), 16)
      const b = parseInt(s.slice(5, 7), 16)
      if ([r, g, b].every((x) => Number.isFinite(x))) return { r, g, b, css: `rgb(${r},${g},${b})` }
    } else {
      const r = parseInt(s[1] + s[1], 16)
      const g = parseInt(s[2] + s[2], 16)
      const b = parseInt(s[3] + s[3], 16)
      if ([r, g, b].every((x) => Number.isFinite(x))) return { r, g, b, css: `rgb(${r},${g},${b})` }
    }
  }
  return null
}

function splitTextLinesNoWrap(text, maxLines) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines = raw.map((s) => String(s || '').trim())
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const limit = Math.max(1, Number(maxLines) || 10)
  return lines.slice(0, limit)
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function applyTextOverlay(canvas, ctx, rgba, w, h, textConfig) {
  if (!canvas || !ctx || !rgba || !w || !h) return

  const cfg = textConfig || {}
  const text = normalizeText(cfg.text)
  if (!text) return

  const position = String(cfg.position || 'BOTTOM').toUpperCase()
  const sizeMode = String(cfg.sizeMode || 'M').toUpperCase()
  const fillHex = cfg.color || '#ffffff'
  const strokeEnabled = cfg.stroke !== false
  const bgEnabled = !!cfg.bg

  const fill = parseHexColor(fillHex) || { css: 'rgb(255,255,255)' }
  const stroke = parseHexColor(cfg.strokeColor || '#000000') || { css: 'rgb(0,0,0)' }
  const bg = parseHexColor(cfg.bgColor || '#000000') || { css: 'rgb(0,0,0)' }

  const base = Math.min(w, h)
  const scale = sizeMode === 'S' ? 0.075 : (sizeMode === 'L' ? 0.14 : 0.105)
  const fontPx = Math.max(12, Math.round(base * scale))
  const lineHeight = Math.round(fontPx * 1.18)
  const paddingX = Math.max(6, Math.round(fontPx * 0.45))
  const paddingY = Math.max(4, Math.round(fontPx * 0.32))
  const margin = Math.max(6, Math.round(base * 0.06))
  const maxWidth = Math.max(20, w - margin * 2)

  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h

  const imageData = ctx.createImageData(w, h)
  imageData.data.set(rgba)
  ctx.putImageData(imageData, 0, 0)

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = `700 ${fontPx}px sans-serif`

  const lines = splitTextLinesNoWrap(text, 10)
  if (!lines.length) {
    ctx.restore()
    return
  }

  let maxLineW = 0
  for (const line of lines) {
    const mw = ctx.measureText(line).width
    if (mw > maxLineW) maxLineW = mw
  }
  const blockW = Math.min(maxWidth, Math.ceil(maxLineW + paddingX * 2))
  const blockH = Math.ceil(lines.length * lineHeight + paddingY * 2)

  let topY = margin
  if (position === 'TOP') topY = margin
  else if (position === 'CENTER') topY = Math.round((h - blockH) / 2)
  else topY = Math.max(margin, h - margin - blockH)

  const centerX = Math.round(w / 2)
  const leftX = Math.round(centerX - blockW / 2)

  if (bgEnabled) {
    ctx.globalAlpha = Math.max(0.05, Math.min(1, Number(cfg.bgAlpha) || 0.36))
    ctx.fillStyle = bg.css
    roundRectPath(ctx, leftX, topY, blockW, blockH, Math.round(fontPx * 0.5))
    ctx.fill()
    ctx.globalAlpha = 1
  }

  ctx.beginPath()
  ctx.rect(leftX, topY, blockW, blockH)
  ctx.clip()

  if (strokeEnabled) {
    ctx.strokeStyle = stroke.css
    ctx.lineWidth = Math.max(2, Math.round(fontPx * 0.14))
    ctx.lineJoin = 'round'
  }
  ctx.fillStyle = fill.css

  for (let i = 0; i < lines.length; i++) {
    const y = topY + paddingY + i * lineHeight
    const line = lines[i]
    if (strokeEnabled) ctx.strokeText(line, centerX, y)
    ctx.fillText(line, centerX, y)
  }
  ctx.restore()

  const out = ctx.getImageData(0, 0, w, h).data
  rgba.set(out)
}

async function addTextToGif(options) {
  const { inputPath, canvas, ctx, textConfig, maxSidePx, frameStep, dither, onProgress } = options || {}
  if (!inputPath) throw new Error('请先选择 GIF')
  if (!canvas || !ctx) throw new Error('画布未就绪，请稍后重试')
  if (!maxSidePx || maxSidePx <= 0) throw new Error('参数不合法：导出分辨率')

  const keepEvery = Math.max(1, Number(frameStep) || 1)

  if (typeof onProgress === 'function') onProgress({ step: '读取文件', index: 0, total: 1 })
  const bytes = await readFileAsUint8Array(inputPath)
  assertGifBytes(bytes)

  let reader = null
  try {
    reader = new GifReader(bytes)
  } catch (e) {
    throw new Error('GIF 文件解析失败，可能文件损坏或不完整')
  }

  const srcW = reader.width
  const srcH = reader.height
  const totalFrames = reader.numFrames()
  if (!srcW || !srcH || !totalFrames) throw new Error('GIF 文件解析失败')

  const maxDim0 = Math.max(srcW, srcH)
  const baseLongEdge = Math.min(maxSidePx, maxDim0)
  const scale = baseLongEdge / maxDim0
  const outW = Math.max(1, Math.round(srcW * scale))
  const outH = Math.max(1, Math.round(srcH * scale))

  const loop = reader.loopCount()
  const writer = new GifWriter(
    new Uint8Array(Math.min(60 * 1024 * 1024, 1024 * 1024 + outW * outH * Math.max(1, Math.ceil(totalFrames / keepEvery)))),
    outW,
    outH,
    (loop === null || loop === undefined) ? {} : { loop }
  )

  let composited = new Uint8Array(srcW * srcH * 4)
  const outRGBA = new Uint8Array(outW * outH * 4)
  const indexed = new Uint8Array(outW * outH)

  let kept = 0
  let nextKeep = 0

  for (let i = 0; i < totalFrames; i++) {
    const info = reader.frameInfo(i)
    let saved = null
    if (info && info.disposal === 3) {
      saved = composited.slice()
    }

    if (typeof onProgress === 'function') onProgress({ step: '解码', index: i + 1, total: totalFrames })
    reader.decodeAndBlitFrameRGBA(i, composited)

    if (i === nextKeep) {
      const groupEnd = Math.min(totalFrames, i + keepEvery)
      let delaySum = 0
      for (let k = i; k < groupEnd; k++) {
        const kInfo = reader.frameInfo(k)
        const d = Number(kInfo && kInfo.delay) || 0
        delaySum += d
      }
      const delayCs = Math.max(1, delaySum || keepEvery)

      if (typeof onProgress === 'function') onProgress({ step: '缩放', index: i + 1, total: totalFrames })
      resampleBilinearRGBA(composited, srcW, srcH, outW, outH, outRGBA)

      if (typeof onProgress === 'function') onProgress({ step: '加字', index: i + 1, total: totalFrames })
      applyTextOverlay(canvas, ctx, outRGBA, outW, outH, textConfig)

      const binary = dither ? isLikelyBinaryImage(outRGBA, outW, outH) : false

      if (typeof onProgress === 'function') onProgress({ step: '量化', index: i + 1, total: totalFrames })
      if (dither && !binary) {
        const errR = new Int32Array(outW + 2)
        const errG = new Int32Array(outW + 2)
        const errB = new Int32Array(outW + 2)
        let nextR = new Int32Array(outW + 2)
        let nextG = new Int32Array(outW + 2)
        let nextB = new Int32Array(outW + 2)

        for (let y = 0; y < outH; y++) {
          nextR.fill(0)
          nextG.fill(0)
          nextB.fill(0)

          for (let x = 0; x < outW; x++) {
            const p = (y * outW + x) * 4
            const a = outRGBA[p + 3]
            const invA = 255 - a
            let r = outRGBA[p] * a / 255 + 255 * invA / 255
            let g = outRGBA[p + 1] * a / 255 + 255 * invA / 255
            let b = outRGBA[p + 2] * a / 255 + 255 * invA / 255

            r = clampByte(Math.round(r + errR[x + 1] / 16))
            g = clampByte(Math.round(g + errG[x + 1] / 16))
            b = clampByte(Math.round(b + errB[x + 1] / 16))

            const q = quantizeIndexAndColor(r, g, b)
            indexed[y * outW + x] = q.idx

            const dr = r - q.rr
            const dg = g - q.gg
            const db = b - q.bb

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

          errR.set(nextR)
          errG.set(nextG)
          errB.set(nextB)
        }
      } else {
        for (let p = 0, j = 0; p < outRGBA.length; p += 4, j++) {
          const a = outRGBA[p + 3]
          const invA = 255 - a
          const r = clampByte(Math.round(outRGBA[p] * a / 255 + 255 * invA / 255))
          const g = clampByte(Math.round(outRGBA[p + 1] * a / 255 + 255 * invA / 255))
          const b = clampByte(Math.round(outRGBA[p + 2] * a / 255 + 255 * invA / 255))
          indexed[j] = quantizeIndexAndColor(r, g, b).idx
        }
      }

      if (typeof onProgress === 'function') onProgress({ step: '编码', index: i + 1, total: totalFrames })
      writer.addFrame(0, 0, outW, outH, indexed, { palette: PALETTE_256, delay: delayCs, disposal: 1 })
      kept++
      nextKeep += keepEvery
    }

    if (info && info.disposal === 2) {
      clearRectRGBA(composited, srcW, srcH, info.x, info.y, info.width, info.height)
    } else if (info && info.disposal === 3 && saved) {
      composited = saved
    }

    if (i === nextKeep - keepEvery || (i % 5 === 0)) {
      await sleep0()
    }
  }

  const gifSize = writer.end()
  const gifBytes = writer.getOutputBuffer().slice(0, gifSize)

  const fs = wx.getFileSystemManager()
  const outPath = `${wx.env.USER_DATA_PATH}/gif_text_${Date.now()}.gif`
  if (typeof onProgress === 'function') onProgress({ step: '写入文件', index: kept, total: kept })
  fs.writeFileSync(outPath, gifBytes.buffer, 'binary')

  let size = 0
  try {
    const stat = fs.statSync(outPath)
    size = stat.size || 0
  } catch (e) {}

  return { outPath, width: outW, height: outH, frames: kept, size }
}

module.exports = {
  addTextToGif,
}
