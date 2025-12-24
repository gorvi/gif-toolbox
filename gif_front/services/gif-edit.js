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

function clamp01(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function alphaFromOpacity(opacity, fallback) {
  const v = Number(opacity)
  if (!Number.isFinite(v)) return clamp01(fallback)
  return clamp01((100 - v) / 100)
}

function colorWithAlpha(color, alpha) {
  const p = parseHexColor(color)
  if (p) return `rgba(${p.r},${p.g},${p.b},${clamp01(alpha)})`
  return String(color || '')
}

function calcShadowOffset(distance, angle) {
  const dist = Math.max(0, Number(distance) || 0)
  const radians = (Number(angle) || 0) * (Math.PI / 180)
  const shadowX = Math.round((dist / 10) * Math.cos(radians) * 10) / 10
  const shadowY = Math.round((dist / 10) * Math.sin(radians) * 10) / 10
  return { shadowX, shadowY }
}

function getAnimTransform(animation, phase01) {
  const anim = String(animation || '')
  if (!anim) return { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0 }
  const p = ((Number(phase01) || 0) % 1 + 1) % 1
  const s2 = Math.sin(p * Math.PI)
  const s = Math.sin(p * Math.PI * 2)
  if (anim === 'fade') return { alpha: 1 - 0.7 * s2, dx: 0, dy: 0, scale: 1, rotate: 0 }
  if (anim === 'slide') return { alpha: 1, dx: 10 * s, dy: 0, scale: 1, rotate: 0 }
  if (anim === 'bounce') return { alpha: 1, dx: 0, dy: -20 * s2, scale: 1, rotate: 0 }
  if (anim === 'pulse') return { alpha: 1, dx: 0, dy: 0, scale: 1 + 0.1 * s2, rotate: 0 }
  if (anim === 'zoom') return { alpha: 1, dx: 0, dy: 0, scale: 1 + 0.2 * s2, rotate: 0 }
  if (anim === 'shake') {
    const freq = 5
    const ss = Math.sin(p * Math.PI * 2 * freq)
    const sc = Math.cos(p * Math.PI * 2 * freq)
    return { alpha: 1, dx: 5 * ss, dy: 0, scale: 1, rotate: (2 * sc * Math.PI) / 180 }
  }
  return { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0 }
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

  const xPct = Number(cfg.xPct)
  const yPct = Number(cfg.yPct)
  const anchorX = Number.isFinite(xPct) ? Math.max(0, Math.min(100, xPct)) / 100 : 0.5
  const anchorY = Number.isFinite(yPct) ? Math.max(0, Math.min(100, yPct)) / 100 : 0.5

  const sizeMode = String(cfg.sizeMode || 'M').toUpperCase()
  const fillHex = cfg.color || '#ffffff'
  const strokeEnabled = cfg.stroke !== false
  const bgEnabled = !!cfg.bg
  const shadowEnabled = !!cfg.shadow

  const fill = parseHexColor(fillHex) || { css: 'rgb(255,255,255)' }
  const stroke = parseHexColor(cfg.strokeColor || '#000000') || { css: 'rgb(0,0,0)' }
  const bg = parseHexColor(cfg.bgColor || '#000000') || { css: 'rgb(0,0,0)' }

  const base = Math.min(w, h)
  const scale = sizeMode === 'S' ? 0.075 : (sizeMode === 'L' ? 0.14 : 0.105)
  const scalePct = Math.max(50, Math.min(300, Number(cfg.textScalePct) || 150))
  const fontPx = Math.max(10, Math.round(base * scale * (scalePct / 100)))
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

  const centerX = Math.round(w * anchorX)
  const topY = Math.round(h * anchorY - blockH / 2)
  const leftX = Math.max(margin, Math.min(w - margin - blockW, Math.round(centerX - blockW / 2)))
  const clampedTop = Math.max(margin, Math.min(h - margin - blockH, topY))

  const textAlpha = alphaFromOpacity(cfg.textOpacity, 1)
  const strokeAlpha = alphaFromOpacity(cfg.strokeOpacity, 1)
  const shadowAlpha = alphaFromOpacity(cfg.shadowOpacity, 1)

  let bgAlpha = 0.36
  if (Number.isFinite(Number(cfg.bgOpacity))) bgAlpha = alphaFromOpacity(cfg.bgOpacity, 0.36)
  else if (Number.isFinite(Number(cfg.bgAlpha))) bgAlpha = clamp01(Number(cfg.bgAlpha))
  bgAlpha = Math.max(0.05, Math.min(1, bgAlpha))

  const anim = String(cfg.animation || '')
  const speed = Math.max(0.5, Math.min(2, Number(cfg.animationSpeed || 1)))
  const frameTotal = Math.max(1, Number(cfg._frameTotal) || 1)
  const frameIndex = Math.max(0, Number(cfg._frameIndex) || 0)
  const phase = ((frameIndex / frameTotal) * speed) % 1
  const animT = anim ? getAnimTransform(anim, phase) : { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0 }

  const baseAlpha = Math.max(0, Math.min(1, textAlpha * clamp01(animT.alpha)))

  const drawCenterX = Math.round(leftX + blockW / 2)
  const drawCenterY = Math.round(clampedTop + blockH / 2)
  const originX = -blockW / 2
  const originY = -blockH / 2

  ctx.translate(drawCenterX, drawCenterY)
  if (animT.dx || animT.dy) ctx.translate(Number(animT.dx) || 0, Number(animT.dy) || 0)
  if (animT.rotate) ctx.rotate(Number(animT.rotate) || 0)
  if (animT.scale && Number(animT.scale) !== 1) ctx.scale(Number(animT.scale) || 1, Number(animT.scale) || 1)

  ctx.beginPath()
  ctx.rect(originX, originY, blockW, blockH)
  ctx.clip()

  if (bgEnabled) {
    ctx.globalAlpha = bgAlpha * baseAlpha
    ctx.fillStyle = bg.css
    roundRectPath(ctx, originX, originY, blockW, blockH, Math.round(fontPx * 0.5))
    ctx.fill()
  }

  if (shadowEnabled) {
    const sc = String(cfg.shadowColor || '')
    const dist = Math.max(0, Number(cfg.shadowDistance) || 0)
    if (sc && dist > 0) {
      const angle = Number(cfg.shadowAngle) || 0
      const o = calcShadowOffset(dist, angle)
      const blurBase = Math.max(0, Number(cfg.shadowBlur) || 0) / 10
      const blur = blurBase * (fontPx / 34)
      ctx.shadowColor = colorWithAlpha(sc, shadowAlpha)
      ctx.shadowBlur = blur
      ctx.shadowOffsetX = (Number(o.shadowX) || 0) * 0.5
      ctx.shadowOffsetY = (Number(o.shadowY) || 0) * 0.5
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0)'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0)'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }

  let strokeWidth = fontPx * 0.14
  if (Number.isFinite(Number(cfg.strokeWidth))) {
    const w01 = Math.max(0, Math.min(50, Number(cfg.strokeWidth))) / 50
    strokeWidth = w01 * (fontPx * 0.14)
  }

  if (strokeEnabled && strokeWidth > 0) {
    ctx.strokeStyle = stroke.css
    ctx.lineWidth = Math.max(1, strokeWidth)
    ctx.lineJoin = 'round'
  }

  for (let i = 0; i < lines.length; i++) {
    const y = originY + paddingY + i * lineHeight
    const line = lines[i]
    if (strokeEnabled && strokeWidth > 0) {
      ctx.globalAlpha = baseAlpha * strokeAlpha
      ctx.strokeText(line, 0, y)
    }
    ctx.globalAlpha = baseAlpha
    ctx.fillStyle = fill.css
    ctx.fillText(line, 0, y)
  }
  ctx.restore()

  const out = ctx.getImageData(0, 0, w, h).data
  rgba.set(out)
}

function clampCropConfig(cropConfig) {
  const cfg = cropConfig || null
  if (!cfg || cfg.enabled === false) return null
  const toNum = (v, fb) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fb
  }
  const clampPct = (n) => Math.max(0, Math.min(100, n))
  const minSize = 10

  let x = clampPct(toNum(cfg.x, 0))
  let y = clampPct(toNum(cfg.y, 0))
  let w = clampPct(toNum(cfg.width, 100))
  let h = clampPct(toNum(cfg.height, 100))
  if (w < minSize) w = minSize
  if (h < minSize) h = minSize
  if (x + w > 100) x = 100 - w
  if (y + h > 100) y = 100 - h
  x = clampPct(x)
  y = clampPct(y)
  return { x, y, width: w, height: h }
}

function cropRGBA(srcRGBA, srcW, srcH, sx, sy, sw, sh, outRGBA) {
  const x0 = Math.max(0, Math.min(srcW - 1, sx | 0))
  const y0 = Math.max(0, Math.min(srcH - 1, sy | 0))
  const w0 = Math.max(1, Math.min(srcW - x0, sw | 0))
  const h0 = Math.max(1, Math.min(srcH - y0, sh | 0))
  const stride = srcW * 4
  for (let y = 0; y < h0; y++) {
    const srcP = (y0 + y) * stride + x0 * 4
    const dstP = y * w0 * 4
    outRGBA.set(srcRGBA.subarray(srcP, srcP + w0 * 4), dstP)
  }
  return { w: w0, h: h0 }
}

function clampRotateConfig(rotateConfig) {
  const cfg = rotateConfig || null
  if (!cfg || cfg.enabled === false) return { deg: 0 }
  const deg0 = Number(cfg.deg)
  if (!Number.isFinite(deg0)) return { deg: 0 }
  const d = ((Math.round(deg0 / 90) * 90) % 360 + 360) % 360
  if (d === 90 || d === 180 || d === 270) return { deg: d }
  return { deg: 0 }
}

function clampResizeConfig(resizeConfig) {
  const cfg = resizeConfig || null
  if (!cfg || cfg.enabled === false) return { scalePct: 100 }
  const pct0 = Number(cfg.scalePct)
  const pct = Number.isFinite(pct0) ? Math.round(pct0) : 100
  return { scalePct: Math.max(25, Math.min(100, pct)) }
}

function rotateRGBA(srcRGBA, srcW, srcH, deg, outRGBA) {
  const d = ((Number(deg) || 0) % 360 + 360) % 360
  if (d === 0) return { w: srcW, h: srcH }
  if (d === 180) {
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const srcP = (y * srcW + x) * 4
        const dx = srcW - 1 - x
        const dy = srcH - 1 - y
        const dstP = (dy * srcW + dx) * 4
        outRGBA[dstP] = srcRGBA[srcP]
        outRGBA[dstP + 1] = srcRGBA[srcP + 1]
        outRGBA[dstP + 2] = srcRGBA[srcP + 2]
        outRGBA[dstP + 3] = srcRGBA[srcP + 3]
      }
    }
    return { w: srcW, h: srcH }
  }
  if (d === 90) {
    const outW = srcH
    const outH = srcW
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const srcP = (y * srcW + x) * 4
        const dx = outW - 1 - y
        const dy = x
        const dstP = (dy * outW + dx) * 4
        outRGBA[dstP] = srcRGBA[srcP]
        outRGBA[dstP + 1] = srcRGBA[srcP + 1]
        outRGBA[dstP + 2] = srcRGBA[srcP + 2]
        outRGBA[dstP + 3] = srcRGBA[srcP + 3]
      }
    }
    return { w: outW, h: outH }
  }
  if (d === 270) {
    const outW = srcH
    const outH = srcW
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const srcP = (y * srcW + x) * 4
        const dx = y
        const dy = outH - 1 - x
        const dstP = (dy * outW + dx) * 4
        outRGBA[dstP] = srcRGBA[srcP]
        outRGBA[dstP + 1] = srcRGBA[srcP + 1]
        outRGBA[dstP + 2] = srcRGBA[srcP + 2]
        outRGBA[dstP + 3] = srcRGBA[srcP + 3]
      }
    }
    return { w: outW, h: outH }
  }
  return { w: srcW, h: srcH }
}

function toIndexSet(arr) {
  const out = Object.create(null)
  const list = Array.isArray(arr) ? arr : []
  for (const v of list) {
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    const i = n | 0
    if (i < 0) continue
    out[i] = true
  }
  return out
}

async function editGif(options) {
  const {
    inputPath,
    canvas,
    ctx,
    maxSidePx,
    frameStep,
    dither,
    cropConfig,
    trimConfig,
    textConfig,
    rotateConfig,
    resizeConfig,
    onProgress,
  } = options || {}

  if (!inputPath) throw new Error('请先选择 GIF')
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

  const trim = trimConfig || {}
  const startFrame0 = Math.max(0, Math.min(totalFrames - 1, Number(trim.startFrame) || 0))
  const endFrame0 = Math.max(startFrame0, Math.min(totalFrames - 1, Number(trim.endFrame) || (totalFrames - 1)))
  const deletedSet = toIndexSet(trim.deletedFrames)
  const candidates = []
  for (let i = startFrame0; i <= endFrame0; i++) {
    if (!deletedSet[i]) candidates.push(i)
  }
  if (!candidates.length) throw new Error('剪切后无可用帧，请至少保留 1 帧')

  const keepPlan = []
  for (let p = 0; p < candidates.length; p += keepEvery) {
    const srcIndex = candidates[p]
    let delaySum = 0
    const endP = Math.min(candidates.length, p + keepEvery)
    for (let q = p; q < endP; q++) {
      const info = reader.frameInfo(candidates[q])
      delaySum += Number(info && info.delay) || 0
    }
    const delayCs = Math.max(1, delaySum || keepEvery)
    keepPlan.push({ index: srcIndex, delayCs })
  }

  const crop = clampCropConfig(cropConfig)
  let cropX = 0
  let cropY = 0
  let cropW = srcW
  let cropH = srcH
  if (crop) {
    cropX = Math.max(0, Math.min(srcW - 1, Math.round((crop.x / 100) * srcW)))
    cropY = Math.max(0, Math.min(srcH - 1, Math.round((crop.y / 100) * srcH)))
    cropW = Math.max(1, Math.min(srcW - cropX, Math.round((crop.width / 100) * srcW)))
    cropH = Math.max(1, Math.min(srcH - cropY, Math.round((crop.height / 100) * srcH)))
  }

  const rotate = clampRotateConfig(rotateConfig)
  const resize = clampResizeConfig(resizeConfig)

  const rotW = (rotate.deg === 90 || rotate.deg === 270) ? cropH : cropW
  const rotH = (rotate.deg === 90 || rotate.deg === 270) ? cropW : cropH

  const maxDim0 = Math.max(rotW, rotH)
  const baseLongEdge = Math.min(maxSidePx, maxDim0)
  const scale0 = baseLongEdge / maxDim0
  const scale1 = scale0 * (resize.scalePct / 100)
  const outW = Math.max(1, Math.round(rotW * scale1))
  const outH = Math.max(1, Math.round(rotH * scale1))

  const loop = reader.loopCount()
  const writer = new GifWriter(
    new Uint8Array(Math.min(60 * 1024 * 1024, 1024 * 1024 + outW * outH * Math.max(1, keepPlan.length))),
    outW,
    outH,
    (loop === null || loop === undefined) ? {} : { loop }
  )

  let composited = new Uint8Array(srcW * srcH * 4)
  const croppedRGBA = new Uint8Array(cropW * cropH * 4)
  const rotatedRGBA = rotate.deg ? new Uint8Array(cropW * cropH * 4) : null
  const outRGBA = new Uint8Array(outW * outH * 4)
  const indexed = new Uint8Array(outW * outH)

  let kept = 0
  let keepPtr = 0
  let nextKeep = keepPlan[0] ? keepPlan[0].index : Number.POSITIVE_INFINITY
  let outDurationCs = 0

  for (let i = 0; i < totalFrames; i++) {
    const info = reader.frameInfo(i)
    let saved = null
    if (info && info.disposal === 3) {
      saved = composited.slice()
    }

    if (typeof onProgress === 'function') onProgress({ step: '解码', index: i + 1, total: totalFrames })
    reader.decodeAndBlitFrameRGBA(i, composited)

    if (i === nextKeep) {
      const delayCs = keepPlan[keepPtr] ? keepPlan[keepPtr].delayCs : Math.max(1, keepEvery)

      if (typeof onProgress === 'function') onProgress({ step: '裁剪', index: i + 1, total: totalFrames })
      cropRGBA(composited, srcW, srcH, cropX, cropY, cropW, cropH, croppedRGBA)

      let scaleSrcRGBA = croppedRGBA
      let scaleSrcW = cropW
      let scaleSrcH = cropH
      if (rotate.deg && rotatedRGBA) {
        if (typeof onProgress === 'function') onProgress({ step: '旋转', index: i + 1, total: totalFrames })
        const rr = rotateRGBA(croppedRGBA, cropW, cropH, rotate.deg, rotatedRGBA)
        scaleSrcRGBA = rotatedRGBA
        scaleSrcW = rr.w
        scaleSrcH = rr.h
      }

      if (typeof onProgress === 'function') onProgress({ step: '缩放', index: i + 1, total: totalFrames })
      resampleBilinearRGBA(scaleSrcRGBA, scaleSrcW, scaleSrcH, outW, outH, outRGBA)

      const hasText = textConfig && normalizeText(textConfig.text)
      if (hasText) {
        if (!canvas || !ctx) throw new Error('画布未就绪，请稍后重试')
        if (typeof onProgress === 'function') onProgress({ step: '文字', index: i + 1, total: totalFrames })
        const cfg = (textConfig && textConfig.animation) ? { ...textConfig, _frameIndex: keepPtr, _frameTotal: keepPlan.length } : textConfig
        applyTextOverlay(canvas, ctx, outRGBA, outW, outH, cfg)
      }

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
      outDurationCs += Math.max(1, Number(delayCs) || 1)
      kept++
      keepPtr++
      nextKeep = keepPlan[keepPtr] ? keepPlan[keepPtr].index : Number.POSITIVE_INFINITY
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
  const outPath = `${wx.env.USER_DATA_PATH}/gif_edit_${Date.now()}.gif`
  if (typeof onProgress === 'function') onProgress({ step: '写入文件', index: kept, total: kept })
  fs.writeFileSync(outPath, gifBytes.buffer, 'binary')

  let size = 0
  try {
    const stat = fs.statSync(outPath)
    size = stat.size || 0
  } catch (e) {}

  const fps = outDurationCs > 0 ? (kept * 100) / outDurationCs : 0
  return { outPath, width: outW, height: outH, frames: kept, size, durationCs: outDurationCs, fps }
}

function canvasToTempPng(canvas, width, height) {
  return new Promise((resolve, reject) => {
    const opts = { x: 0, y: 0, width, height, destWidth: width, destHeight: height, fileType: 'png' }
    if (canvas && typeof canvas.toTempFilePath === 'function') {
      canvas.toTempFilePath({
        ...opts,
        success: (res) => resolve(res && res.tempFilePath ? res.tempFilePath : ''),
        fail: (e) => reject(new Error((e && e.errMsg) ? e.errMsg : '导出缩略图失败')),
      })
      return
    }
    if (typeof wx.canvasToTempFilePath === 'function') {
      wx.canvasToTempFilePath({
        ...opts,
        canvas,
        success: (res) => resolve(res && res.tempFilePath ? res.tempFilePath : ''),
        fail: (e) => reject(new Error((e && e.errMsg) ? e.errMsg : '导出缩略图失败')),
      })
      return
    }
    reject(new Error('当前环境不支持导出缩略图'))
  })
}

async function getGifFrameThumbs(options) {
  const { inputPath, canvas, ctx, maxSidePx, frameStep, onProgress } = options || {}
  if (!inputPath) throw new Error('请先选择 GIF')
  if (!canvas || !ctx) throw new Error('画布未就绪，请稍后重试')

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

  const maxSide = Math.max(1, Number(maxSidePx) || 96)
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH))
  const outW = Math.max(1, Math.round(srcW * scale))
  const outH = Math.max(1, Math.round(srcH * scale))

  const composited = new Uint8Array(srcW * srcH * 4)
  const outRGBA = new Uint8Array(outW * outH * 4)
  const thumbs = new Array(totalFrames)
  const keepEvery = Math.max(1, Number(frameStep) || 1)

  for (let i = 0; i < totalFrames; i++) {
    const info = reader.frameInfo(i)
    let saved = null
    if (info && info.disposal === 3) saved = composited.slice()

    if (typeof onProgress === 'function') onProgress({ step: '解码', index: i + 1, total: totalFrames })
    reader.decodeAndBlitFrameRGBA(i, composited)

    if (i % keepEvery === 0) {
      resampleBilinearRGBA(composited, srcW, srcH, outW, outH, outRGBA)

      if (canvas.width !== outW) canvas.width = outW
      if (canvas.height !== outH) canvas.height = outH
      const imageData = ctx.createImageData(outW, outH)
      imageData.data.set(outRGBA)
      ctx.putImageData(imageData, 0, 0)

      if (typeof onProgress === 'function') onProgress({ step: '导出', index: i + 1, total: totalFrames })
      const src = await canvasToTempPng(canvas, outW, outH)
      thumbs[i] = { index: i, src }
    } else {
      thumbs[i] = { index: i, src: '' }
    }

    if (info && info.disposal === 2) {
      clearRectRGBA(composited, srcW, srcH, info.x, info.y, info.width, info.height)
    } else if (info && info.disposal === 3 && saved) {
      composited.set(saved)
    }

    if (i % 5 === 0) await sleep0()
  }

  return thumbs
}

async function getGifFramePng(options) {
  const { inputPath, canvas, ctx, frameIndex, maxSidePx } = options || {}
  if (!inputPath) throw new Error('请先选择 GIF')
  if (!canvas || !ctx) throw new Error('画布未就绪，请稍后重试')

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

  const idx0 = Math.max(0, Math.min(totalFrames - 1, Number(frameIndex) || 0))

  const maxSide = Math.max(1, Number(maxSidePx) || 480)
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH))
  const outW = Math.max(1, Math.round(srcW * scale))
  const outH = Math.max(1, Math.round(srcH * scale))

  const composited = new Uint8Array(srcW * srcH * 4)
  const outRGBA = new Uint8Array(outW * outH * 4)

  for (let i = 0; i <= idx0; i++) {
    const info = reader.frameInfo(i)
    let saved = null
    if (info && info.disposal === 3) saved = composited.slice()

    reader.decodeAndBlitFrameRGBA(i, composited)

    if (i === idx0) {
      resampleBilinearRGBA(composited, srcW, srcH, outW, outH, outRGBA)

      if (canvas.width !== outW) canvas.width = outW
      if (canvas.height !== outH) canvas.height = outH
      const imageData = ctx.createImageData(outW, outH)
      imageData.data.set(outRGBA)
      ctx.putImageData(imageData, 0, 0)

      const src = await canvasToTempPng(canvas, outW, outH)
      return { index: idx0, src, width: outW, height: outH }
    }

    if (info && info.disposal === 2) {
      clearRectRGBA(composited, srcW, srcH, info.x, info.y, info.width, info.height)
    } else if (info && info.disposal === 3 && saved) {
      composited.set(saved)
    }

    if (i % 5 === 0) await sleep0()
  }

  return { index: idx0, src: '', width: outW, height: outH }
}

module.exports = {
  editGif,
  getGifFrameThumbs,
  getGifFramePng,
}
