const { getGifMeta } = require('../../services/gif-compress')
const { editGif, getGifFrameThumbs, getGifFramePng } = require('../../services/gif-edit')
const { filterEmoji, calcShadowOffset, hexToRgba } = require('../video-to-gif/utils')

const MAX_SIDE_OPTIONS = [0, 320, 480, 720]
const FRAME_STEP_OPTIONS = [1, 2, 3, 4]

const QUALITY_MODE = {
  STANDARD: 'STANDARD',
  HIGH: 'HIGH',
}

const TOOL_TITLE = {
  crop: '裁剪',
  trim: '删帧',
  text: '文字',
  compress: '压缩',
  rotate: '旋转',
  resize: '缩放',
}

function chooseGifFromAlbum() {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: 1,
      sizeType: ['original'],
      sourceType: ['album'],
      success: (res) => {
        resolve((res.tempFilePaths && res.tempFilePaths[0]) || '')
      },
      fail: reject,
    })
  })
}

function chooseGifFromChat() {
  return new Promise((resolve, reject) => {
    if (!wx.chooseMessageFile) {
      reject(new Error('当前微信版本不支持从聊天选择文件'))
      return
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['gif'],
      success: (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || null
        resolve(file ? file.path : '')
      },
      fail: reject,
    })
  })
}

function chooseGifFromChatImage() {
  return new Promise((resolve, reject) => {
    if (!wx.chooseMessageFile) {
      reject(new Error('当前微信版本不支持从聊天选择图片'))
      return
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'image',
      success: (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || null
        resolve(file ? file.path : '')
      },
      fail: reject,
    })
  })
}

function isCancelError(e) {
  const msg = String((e && (e.errMsg || e.message)) || '')
  return msg.includes('cancel') || msg.includes('fail cancel')
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function toStrokeStyle(enabled, color, width, opacity) {
  if (!enabled) return ''
  const c = String(color || '#000000')
  const w = Math.max(1, Number(width) || 2)
  const a = Math.max(0, Math.min(1, Number.isFinite(Number(opacity)) ? Number(opacity) : 1))
  const cc = c.startsWith('#') && c.length === 7 ? hexToRgba(c, a) : c
  return `-webkit-text-stroke: ${w}px ${cc};`
}

function toBgStyle(enabled, color, opacity) {
  if (!enabled) return ''
  const c = String(color || '#000000')
  const a = Math.max(0, Math.min(1, Number.isFinite(Number(opacity)) ? Number(opacity) : 0.36))
  const cc = c.startsWith('#') && c.length === 7 ? hexToRgba(c, a) : c
  return `background: ${cc};`
}

function clampPct(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}

function aspectToNumber(aspect) {
  const s = String(aspect || '')
  if (s === 'free' || s === 'none') return null
  const parts = s.split(':')
  if (parts.length === 2) {
    const a = Number(parts[0])
    const b = Number(parts[1])
    if (a > 0 && b > 0) return a / b
  }
  return null
}

function countKeys(obj) {
  const o = obj || {}
  return Object.keys(o).length
}

function splitTextLinesNoWrap(text, maxLines) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines = raw.map((s) => String(s || '').trim())
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const limit = Math.max(1, Number(maxLines) || 10)
  return lines.slice(0, limit)
}

Page({
  data: {
    inputPath: '',
    inputInfoText: '',
    inputBytes: 0,
    inputW: 0,
    inputH: 0,
    inputFrames: 0,
    gifStage: { leftPx: 0, topPx: 0, widthPx: 0, heightPx: 0 },

    maxSideIndex: 0,
    maxSideLabels: MAX_SIDE_OPTIONS.map((v) => (v ? `${v}px` : '原图')),
    frameStepIndex: Math.max(0, FRAME_STEP_OPTIONS.indexOf(1)),
    frameStepLabels: ['不抽帧', '每2帧取1帧', '每3帧取1帧', '每4帧取1帧'],
    qualityMode: QUALITY_MODE.HIGH,
    metaQualityText: '高(默认)',

    activeTool: 'none',
    activeToolTitle: '',
    drawerOverlapsPreview: false,

    cropAspect: 'none',
    cropConfig: { enabled: false, x: 0, y: 0, width: 100, height: 100 },
    cropPreviewConfig: null,
    cropDragging: false,
        cropPreviewConfig: null,
        cropDragging: false,

    trimStartFrame: 0,
    trimEndFrame: 0,
    maxFrameIndex: 0,
    trimText: '',
    trimThumbs: [],
    trimThumbLoading: false,
    trimThumbProgressText: '',
    trimSelected: {},
    trimDeleted: {},
    trimSelectedCount: 0,
    trimDeletedCount: 0,
    trimDeletePulse: false,
    trimPreviewPath: '',
    trimThumbHint: '',
    gifDisplaySrc: '',
    gifPlaying: true,
    previewModalVisible: false,
    previewModalSrc: '',
    previewModalIndex: 1,
    previewModalTotal: 1,
    previewModalTitle: '预览',
    previewModalNavVisible: false,
    previewModalCanPrev: false,
    previewModalCanNext: false,
    previewControlsVisible: true,
    previewAutoplay: false,

    textActiveTab: 'keyboard',
    textSizeMode: 'M',
    textStrokeEnabled: false,
    textShadowEnabled: false,
    textBgEnabled: false,
    textKeyboardHeightPx: 0,
    textInputCount: 0,
    textPreviewLines: [],
    textConfig: {
      text: '',
      xPct: 50,
      yPct: 50,
      color: '#ffffff',
      textOpacity: 0,
      textScalePct: 150,

      strokeColor: '',
      strokeWidth: 30,
      strokeOpacity: 0,

      shadowColor: '',
      shadowBlur: 30,
      shadowDistance: 30,
      shadowAngle: 45,
      shadowOpacity: 0,
      shadowX: 2,
      shadowY: 2,

      bgColor: '',
      bgOpacity: 0,

      animation: '',
      animationSpeed: 1,

      _fontStyle: '',
      _strokeStyle: '',
      _shadowStyle: 'none',
      _bgStyle: '',
      _animStyle: '',
    },
    textDragging: false,

    rotatePreviewMode: 'none',
    rotatePreviewLabel: '无',
    rotatePreviewTransformStyle: '',
    rotatePreviewOptions: [
      { label: '无', value: 'none' },
      { label: '顺时针90°', value: 'cw90' },
      { label: '逆时针90°', value: 'ccw90' },
      { label: '镜像翻转', value: 'mirror' },
    ],

    resizeScalePct: 100,
    resizePresets: [50, 75, 100],

    colorOptions: ['#ffffff', '#000000', '#ff4d4f', '#20c05c', '#2f54eb', '#ffd54d', '#9254de', '#13c2c2', '#fa8c16'],
    animationOptions: [
      { label: '无', value: '' },
      { label: '淡入', value: 'fade' },
      { label: '滑入', value: 'slide' },
      { label: '弹跳', value: 'bounce' },
      { label: '脉冲', value: 'pulse' },
      { label: '摇晃', value: 'shake' },
      { label: '缩放', value: 'zoom' },
    ],

    processing: false,
    progressText: '',
    progressPercent: 0,

    outPath: '',
    outSizeText: '',
    outputDirty: false,
    primaryActionText: '生成',
  },

  updateCompressMetaText() {
    const metaQualityText = this.data.qualityMode === QUALITY_MODE.HIGH ? '高(默认)' : '标'
    if (metaQualityText !== this.data.metaQualityText) this.setData({ metaQualityText })
  },

  computePrimaryActionText() {
    if (!this.data.inputPath) return '选择GIF'
    if (!this.data.outPath) return '生成'
    if (this.data.outputDirty) return '重新生成'
    return '预览'
  },

  updatePrimaryActionText() {
    const next = this.computePrimaryActionText()
    if (next !== this.data.primaryActionText) this.setData({ primaryActionText: next })
  },

  markOutputDirty() {
    if (!this.data.outPath) {
      this.updatePrimaryActionText()
      return
    }
    if (!this.data.outputDirty) {
      this.setData({ outputDirty: true }, () => this.updatePrimaryActionText())
      return
    }
    this.updatePrimaryActionText()
  },

  onLoad(query) {
    const autoChoose = query && (query.autoChoose === '1' || query.autoChoose === 1)
    if (autoChoose) {
      setTimeout(() => {
        if (!this.data.inputPath && !this.data.processing) this.onChooseSource()
      }, 0)
    }
    this.updatePrimaryActionText()
  },

  onUnload() {
    this.stopPreviewAutoplay()
  },

  onReady() {
    const q = wx.createSelectorQuery()
    q.select('#workCanvas').fields({ node: true, size: true }).exec((res) => {
      const node = res && res[0] && res[0].node
      if (!node) return
      this.canvas = node
      this.ctx = node.getContext('2d')
      if (this.data.activeTool === 'trim') this.prepareTrimThumbs()
    })
  },

  scheduleUpdateGifStage() {
    const run = () => this.updateGifStage()
    if (typeof wx.nextTick === 'function') wx.nextTick(run)
    else setTimeout(run, 0)
  },

  scheduleUpdateDrawerOverlap() {
    const run = () => this.updateDrawerOverlap()
    if (typeof wx.nextTick === 'function') wx.nextTick(run)
    else setTimeout(run, 0)
  },

  updateDrawerOverlap() {
    const activeTool = String(this.data.activeTool || 'none')
    if (!activeTool || activeTool === 'none') {
      if (this.data.drawerOverlapsPreview) {
        this.setData({ drawerOverlapsPreview: false }, () => this.scheduleUpdateGifStage())
      }
      return
    }

    const q = wx.createSelectorQuery()
    q.select('#gifContainer').boundingClientRect()
    q.select('#editDrawer').boundingClientRect()
    q.exec((res) => {
      const containerRect = res && res[0]
      const drawerRect = res && res[1]
      if (!containerRect || !drawerRect) return
      const overlap = (drawerRect.top || 0) < ((containerRect.bottom || 0) - 1)
      if (overlap !== !!this.data.drawerOverlapsPreview) {
        this.setData({ drawerOverlapsPreview: overlap }, () => this.scheduleUpdateGifStage())
      }
    })
  },

  updateGifStage() {
    const inputW = Number(this.data.inputW) || 0
    const inputH = Number(this.data.inputH) || 0
    if (!inputW || !inputH) return

    const q = wx.createSelectorQuery()
    q.select('#gifContainer').boundingClientRect((rect) => {
      if (!rect || !rect.width || !rect.height) return

      const scale = Math.min(rect.width / inputW, rect.height / inputH)
      const widthPx = Math.max(1, Math.round(inputW * scale))
      const heightPx = Math.max(1, Math.round(inputH * scale))
      const leftPx = Math.round((rect.width - widthPx) / 2)
      const topPx = Math.round((rect.height - heightPx) / 2)

      this.setData({ gifStage: { leftPx, topPx, widthPx, heightPx } }, () => {
        if (this._pendingCropReset) {
          this._pendingCropReset = false
          this.resetCropForAspect()
        }
      })
    }).exec()
  },

  onResize() {
    if (!this.data.inputPath) return
    this.scheduleUpdateGifStage()
    this.scheduleUpdateDrawerOverlap()
  },

  async loadInputGif(path) {
    if (!path) return
    wx.showLoading({ title: '读取中…', mask: true })
    try {
      const inputBytes = await new Promise((resolve) => {
        if (!wx.getFileInfo) {
          resolve(0)
          return
        }
        wx.getFileInfo({
          filePath: path,
          success: (res) => resolve(Number(res && res.size) || 0),
          fail: () => resolve(0),
        })
      })
      const meta = await getGifMeta(path)
      const inputW = Number(meta.width) || 0
      const inputH = Number(meta.height) || 0
      const frames = Number(meta.frames) || 0
      const fps = Number(meta.fps) || 0
      const sizeText = inputBytes > 0 ? formatBytes(inputBytes) : ''
      const inputInfoText = fps > 0
        ? `${inputW}×${inputH}px · ${frames}帧 · ${fps.toFixed(1)}FPS${sizeText ? ` · ${sizeText}` : ''}`
        : `${inputW}×${inputH}px · ${frames}帧${sizeText ? ` · ${sizeText}` : ''}`

      const maxFrameIndex = Math.max(0, frames - 1)
      this.setData({
        inputPath: path,
        gifDisplaySrc: path,
        gifPlaying: true,
        inputInfoText,
        inputBytes,
        inputW,
        inputH,
        inputFrames: frames,
        maxFrameIndex,
        maxSideIndex: 0,
        frameStepIndex: Math.max(0, FRAME_STEP_OPTIONS.indexOf(1)),
        qualityMode: QUALITY_MODE.HIGH,
        metaQualityText: '高(默认)',
        trimStartFrame: 0,
        trimEndFrame: maxFrameIndex,
        trimThumbs: [],
        trimThumbLoading: false,
        trimThumbProgressText: '',
        trimSelected: {},
        trimDeleted: {},
        trimSelectedCount: 0,
        trimDeletedCount: 0,
        trimPreviewPath: '',
        trimThumbHint: '',
        outPath: '',
        outSizeText: '',
        outputDirty: false,
        textActiveTab: 'keyboard',
        textSizeMode: 'M',
        textStrokeEnabled: false,
        textShadowEnabled: false,
        textBgEnabled: false,
        textConfig: {
          text: '',
          xPct: 50,
          yPct: 50,
          color: '#ffffff',
          textOpacity: 0,
          textScalePct: 150,
          strokeColor: '',
          strokeWidth: 30,
          strokeOpacity: 0,
          shadowColor: '',
          shadowBlur: 30,
          shadowDistance: 30,
          shadowAngle: 45,
          shadowOpacity: 0,
          shadowX: 2,
          shadowY: 2,
          bgColor: '',
          bgOpacity: 0,
          animation: '',
          animationSpeed: 1,
          _fontStyle: '',
          _strokeStyle: '',
          _shadowStyle: 'none',
          _bgStyle: '',
          _animStyle: '',
        },
      }, () => {
        this._gifStillSrc = ''
        this.refreshTrimText()
        this._pendingCropReset = true
        this.scheduleUpdateGifStage()
        this.resetCropForAspect()
        this.updateCompressMetaText()
        this.updatePrimaryActionText()
        this.updateTextStyles()
      })
    } finally {
      wx.hideLoading()
    }
  },

  getRotatePreviewComputed(mode) {
    const m = String(mode || 'none')
    if (m === 'cw90') return { label: '顺时针90°', style: 'transform: rotate(90deg); transform-origin: 50% 50%;' }
    if (m === 'ccw90') return { label: '逆时针90°', style: 'transform: rotate(-90deg); transform-origin: 50% 50%;' }
    if (m === 'mirror') return { label: '镜像', style: 'transform: scaleX(-1); transform-origin: 50% 50%;' }
    return { label: '无', style: '' }
  },

  onRotatePreviewPick(e) {
    if (this.data.processing) return
    const picked = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode || 'none')
    const nextMode = (picked === String(this.data.rotatePreviewMode || 'none')) ? 'none' : picked
    const computed = this.getRotatePreviewComputed(nextMode)
    this.setData({
      rotatePreviewMode: nextMode,
      rotatePreviewLabel: computed.label,
      rotatePreviewTransformStyle: computed.style,
    })
  },

  onResizePreset(e) {
    if (this.data.processing) return
    const pct = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.pct)
    const next = Number.isFinite(pct) ? pct : 100
    this.setData({ resizeScalePct: next }, () => this.markOutputDirty())
  },

  onResizeSliderChange(e) {
    if (this.data.processing) return
    const pct = Number(e && e.detail && e.detail.value)
    const next = Number.isFinite(pct) ? pct : 100
    this.setData({ resizeScalePct: next }, () => this.markOutputDirty())
  },

  onToggleGifPlay() {
    const next = !this.data.gifPlaying
    this.setGifPlaying(next)
  },

  async setGifPlaying(playing) {
    const shouldPlay = !!playing
    if (!this.data.inputPath) {
      this.setData({ gifPlaying: false, gifDisplaySrc: '' })
      return
    }
    if (shouldPlay) {
      this.setData({ gifPlaying: true, gifDisplaySrc: this.data.inputPath })
      return
    }

    this.setData({ gifPlaying: false })
    if (this._gifStillSrc) {
      this.setData({ gifDisplaySrc: this._gifStillSrc })
      return
    }
    if (!this.canvas || !this.ctx) {
      setTimeout(() => {
        if (this.data.gifPlaying) return
        this.setGifPlaying(false)
      }, 60)
      return
    }
    try {
      const maxSidePx = Math.max(480, Math.min(720, Math.max(Number(this.data.inputW) || 0, Number(this.data.inputH) || 0)))
      const res = await getGifFramePng({
        inputPath: this.data.inputPath,
        canvas: this.canvas,
        ctx: this.ctx,
        frameIndex: 0,
        maxSidePx,
      })
      const src = (res && res.src) || ''
      if (src) this._gifStillSrc = src
      if (!this.data.gifPlaying) this.setData({ gifDisplaySrc: src || this.data.inputPath })
    } catch (e) {
      if (!this.data.gifPlaying) this.setData({ gifDisplaySrc: this.data.inputPath })
    }
  },

  onChooseSource() {
    if (this.data.processing) return
    wx.showActionSheet({
      itemList: ['相册选择（GIF）', '聊天图片（GIF）', '聊天文件（GIF）'],
      success: async (res) => {
        const tapIndex = Number(res && res.tapIndex)
        try {
          const path = tapIndex === 0
            ? await chooseGifFromAlbum()
            : (tapIndex === 1 ? await chooseGifFromChatImage() : await chooseGifFromChat())
          await this.loadInputGif(path)
        } catch (e) {
          if (isCancelError(e)) return
          wx.showModal({ title: '读取失败', content: (e && e.message) ? e.message : '读取失败，请重试', showCancel: false })
        }
      },
      fail: (e) => {
        if (isCancelError(e)) return
      },
    })
  },

  onOpenTool(e) {
    if (this.data.processing) return
    if (!this.data.inputPath) {
      this.onChooseSource()
      return
    }
    const tool = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tool) || 'none'
    const patch = { activeTool: tool, activeToolTitle: TOOL_TITLE[tool] || '', textKeyboardHeightPx: 0 }
    if (tool === 'trim') {
      this._trimDeleteHinted = false
      if (this._trimDeletePulseTimer) clearTimeout(this._trimDeletePulseTimer)
      this._trimDeletePulseTimer = null
      patch.trimDeletePulse = false
    }
    if (tool === 'text') {
      this._textToolSnapshot = {
        textConfig: JSON.parse(JSON.stringify(this.data.textConfig || {})),
        textStrokeEnabled: !!this.data.textStrokeEnabled,
        textShadowEnabled: !!this.data.textShadowEnabled,
        textBgEnabled: !!this.data.textBgEnabled,
        textSizeMode: String(this.data.textSizeMode || 'M'),
        outputDirty: !!this.data.outputDirty,
      }
      patch.textActiveTab = 'keyboard'
      patch.textInputCount = String((this.data.textConfig && this.data.textConfig.text) || '').length
    }
    this.setData(patch, () => {
      this.scheduleUpdateGifStage()
      this.scheduleUpdateDrawerOverlap()
      setTimeout(() => this.scheduleUpdateGifStage(), 280)
      setTimeout(() => this.scheduleUpdateDrawerOverlap(), 280)
      if (tool === 'trim') this.prepareTrimThumbs()
      if (tool === 'text') this.updateTextStyles()
    })
  },

  onCloseTool() {
    if (this.data.processing) return
    this._textToolSnapshot = null
    this.setData({ activeTool: 'none', activeToolTitle: '', textKeyboardHeightPx: 0, textInputCount: 0 }, () => {
      this.scheduleUpdateGifStage()
      this.scheduleUpdateDrawerOverlap()
      setTimeout(() => this.scheduleUpdateGifStage(), 280)
      setTimeout(() => this.scheduleUpdateDrawerOverlap(), 280)
    })
  },

  onCancelTool() {
    if (this.data.processing) return
    if (this.data.activeTool === 'text' && this._textToolSnapshot) {
      const s = this._textToolSnapshot
      const cfg = s.textConfig || {}
      const text = String(cfg.text || '')
      this._textToolSnapshot = null
      this.setData({
        textConfig: cfg,
        textStrokeEnabled: !!s.textStrokeEnabled,
        textShadowEnabled: !!s.textShadowEnabled,
        textBgEnabled: !!s.textBgEnabled,
        textSizeMode: String(s.textSizeMode || 'M'),
        outputDirty: !!s.outputDirty,
        textInputCount: text.length,
        activeTool: 'none',
        activeToolTitle: '',
        textKeyboardHeightPx: 0,
      }, () => {
        this.updatePrimaryActionText()
        this.updateTextStyles()
        this.scheduleUpdateGifStage()
        this.scheduleUpdateDrawerOverlap()
        setTimeout(() => this.scheduleUpdateGifStage(), 280)
        setTimeout(() => this.scheduleUpdateDrawerOverlap(), 280)
      })
      return
    }
    this.onCloseTool()
  },

  onGestureStart() {},
  onGestureMove() {},
  onGestureEnd() {},

  onGifImageLoad() {
    this.scheduleUpdateGifStage()
    this.scheduleUpdateDrawerOverlap()
  },

  onGifImageError() {
    wx.showToast({ title: '预览加载失败', icon: 'none' })
  },

  onMaxSidePick(e) {
    if (this.data.processing) return
    const idx = Number(e.detail && e.detail.value) || 0
    this.setData({ maxSideIndex: idx }, () => this.markOutputDirty())
  },

  refreshTrimText() {
    const total = Number(this.data.inputFrames) || 0
    if (!total) {
      this.setData({ trimText: '' })
      return
    }
    const deleted = countKeys(this.data.trimDeleted)
    const trimText = deleted ? `删帧：已删${deleted}帧` : ''
    this.setData({ trimText })
  },

  updateTrimCounts() {
    const prevSelectedCount = Number(this.data.trimSelectedCount) || 0
    const trimSelectedCount = countKeys(this.data.trimSelected)
    const trimDeletedCount = countKeys(this.data.trimDeleted)
    this.setData({ trimSelectedCount, trimDeletedCount }, () => {
      if (this.data.activeTool !== 'trim') return
      if (trimSelectedCount <= 0) return
      if (prevSelectedCount > 0) return
      if (this._trimDeleteHinted) return
      this._trimDeleteHinted = true
      this.setData({ trimDeletePulse: true })
      if (this._trimDeletePulseTimer) clearTimeout(this._trimDeletePulseTimer)
      this._trimDeletePulseTimer = setTimeout(() => {
        this._trimDeletePulseTimer = null
        if (this.data.activeTool !== 'trim') return
        this.setData({ trimDeletePulse: false })
      }, 520)
    })
  },

  async prepareTrimThumbs() {
    if (this.data.processing) return
    if (!this.data.inputPath) return
    if (!this.canvas || !this.ctx) return
    if (this.data.trimThumbLoading) return
    const total = Number(this.data.inputFrames) || 0
    if (total && Array.isArray(this.data.trimThumbs) && this.data.trimThumbs.length === total) return

    const thumbLimit = 240
    const thumbEvery = total > thumbLimit ? Math.max(2, Math.ceil(total / thumbLimit)) : 1
    const trimThumbHint = thumbEvery > 1 ? `帧数较多，缩略图按每${thumbEvery}帧显示 1 张（不影响删除/恢复）` : ''

    this.setData({ trimThumbLoading: true, trimThumbProgressText: '准备中…' })
    try {
      const thumbs = await getGifFrameThumbs({
        inputPath: this.data.inputPath,
        canvas: this.canvas,
        ctx: this.ctx,
        maxSidePx: 96,
        frameStep: thumbEvery,
        onProgress: ({ step, index, total }) => {
          const i = Number(index) || 0
          const t = Number(total) || 0
          const pct = t > 0 ? Math.round((i / t) * 100) : 0
          this.setData({ trimThumbProgressText: `${step} ${Math.min(100, Math.max(0, pct))}%` })
        },
      })
      this.setData({ trimThumbs: thumbs, trimThumbHint, trimThumbLoading: false, trimThumbProgressText: '' })
    } catch (e) {
      this.setData({ trimThumbLoading: false, trimThumbProgressText: '' })
      wx.showToast({ title: (e && e.message) ? e.message : '生成缩略图失败', icon: 'none' })
    }
  },

  onTrimThumbTap(e) {
    if (this.data.processing) return
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index)
    if (!Number.isFinite(idx)) return
    const next = { ...(this.data.trimSelected || {}) }
    if (next[idx]) delete next[idx]
    else next[idx] = true
    this.setData({ trimSelected: next }, () => this.updateTrimCounts())
  },

  onTrimClearSelection() {
    if (this.data.processing) return
    this.setData({ trimSelected: {} }, () => this.updateTrimCounts())
  },

  onTrimSelectAll() {
    if (this.data.processing) return
    const del = this.data.trimDeleted || {}
    const next = {}
    const total = Number(this.data.inputFrames) || 0
    for (let i = 0; i < total; i++) {
      if (!del[i]) next[i] = true
    }
    this.setData({ trimSelected: next }, () => this.updateTrimCounts())
  },

  onTrimDeleteSelected() {
    if (this.data.processing) return
    const selected = this.data.trimSelected || {}
    const keys = Object.keys(selected).map((k) => Number(k)).filter((n) => Number.isFinite(n))
    if (!keys.length) return

    const del0 = this.data.trimDeleted || {}
    const total = Number(this.data.inputFrames) || 0
    const alreadyDeleted = countKeys(del0)
    let willDelete = 0
    for (const i of keys) {
      if (i >= 0 && i < total && !del0[i]) willDelete++
    }
    if (!willDelete) return
    if (total - (alreadyDeleted + willDelete) <= 0) {
      wx.showToast({ title: '至少保留 1 帧', icon: 'none' })
      return
    }

    wx.showModal({
      title: `确认删除 ${willDelete} 帧？`,
      content: '删除后可用“恢复”撤销',
      confirmText: '确认删除',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (!res || !res.confirm) return
        const nextDel = { ...del0 }
        for (const i of keys) nextDel[i] = true
        this.setData({ trimDeleted: nextDel, trimSelected: {}, trimPreviewPath: '' }, () => {
          this.updateTrimCounts()
          this.refreshTrimText()
          this.markOutputDirty()
        })
      },
    })
  },

  onTrimRestoreSelected() {
    if (this.data.processing) return
    const selected = this.data.trimSelected || {}
    const keys = Object.keys(selected).map((k) => Number(k)).filter((n) => Number.isFinite(n))
    const nextDel = { ...(this.data.trimDeleted || {}) }
    if (!keys.length) {
      const hasDeleted = countKeys(nextDel) > 0
      if (!hasDeleted) return
      this.setData({ trimDeleted: {}, trimSelected: {}, trimPreviewPath: '' }, () => {
        this.updateTrimCounts()
        this.refreshTrimText()
        this.markOutputDirty()
      })
      return
    }
    for (const i of keys) if (nextDel[i]) delete nextDel[i]
    this.setData({ trimDeleted: nextDel, trimSelected: {}, trimPreviewPath: '' }, () => {
      this.updateTrimCounts()
      this.refreshTrimText()
      this.markOutputDirty()
    })
  },

  async onTrimPreview() {
    if (this.data.processing) return
    if (!this.data.inputPath) return
    if (!this.canvas || !this.ctx) {
      wx.showToast({ title: '画布未就绪，请稍后重试', icon: 'none' })
      return
    }

    const total = Number(this.data.inputFrames) || 0
    if (!total) return

    const del = this.data.trimDeleted || {}
    const indices = []
    for (let i = 0; i < total; i++) {
      if (!del[i]) indices.push(i)
    }
    if (!indices.length) {
      wx.showToast({ title: '没有可预览的帧', icon: 'none' })
      return
    }

    const selected = this.data.trimSelected || {}
    const selectedList = Object.keys(selected).map((k) => Number(k)).filter((n) => Number.isFinite(n) && !del[n])
    const startFrame = selectedList.length ? Math.min(...selectedList) : indices[0]
    const startCursor = Math.max(0, indices.indexOf(startFrame))
    await this.openPreviewFrames({ indices, cursor: startCursor, title: '预览' })
  },

  async openPreviewFrames({ indices, cursor, title }) {
    this._previewMode = 'frames'
    this._previewFrameIndices = Array.isArray(indices) ? indices.slice() : []
    this._previewFrameCursor = Math.max(0, Math.min(this._previewFrameIndices.length - 1, Number(cursor) || 0))
    if (!this._previewFrameCache) this._previewFrameCache = {}
    this.stopPreviewAutoplay()
    this._gifWasPlaying = !!this.data.gifPlaying
    await this.setGifPlaying(false)
    try {
      const list = this._previewFrameIndices || []
      const c = Number(this._previewFrameCursor) || 0
      const frameIndex = list[c] || 0
      const total = Number(this.data.inputFrames) || 1
      this.setData({
        previewModalVisible: true,
        previewModalTitle: String(title || '预览'),
        previewModalNavVisible: true,
        previewModalSrc: '',
        previewModalIndex: frameIndex + 1,
        previewModalTotal: total,
        previewModalCanPrev: c > 0,
        previewModalCanNext: c < list.length - 1,
        previewControlsVisible: true,
        previewAutoplay: true,
      })
      await this.updatePreviewFrame()
      this.startPreviewAutoplay()
    } catch (e) {
      wx.showToast({ title: (e && e.message) ? e.message : '预览失败', icon: 'none' })
    }
  },

  openPreviewSingle({ src, title }) {
    this._previewMode = 'single'
    this._previewFrameIndices = null
    this._previewFrameCursor = 0
    this._previewTouch = null
    this._previewMoved = false
    this.stopPreviewAutoplay()
    this._gifWasPlaying = !!this.data.gifPlaying
    this.setGifPlaying(false)
    this.setData({
      previewModalVisible: true,
      previewModalSrc: src,
      previewModalIndex: 1,
      previewModalTotal: 1,
      previewModalTitle: String(title || '预览'),
      previewModalNavVisible: false,
      previewModalCanPrev: false,
      previewModalCanNext: false,
      previewControlsVisible: true,
      previewAutoplay: false,
    })
  },

  onTogglePreviewControls() {
    if (!this.data.previewControlsVisible) this.setData({ previewControlsVisible: true })
  },

  onTogglePreviewAutoplay() {
    if (this._previewMode !== 'frames') return
    const next = !this.data.previewAutoplay
    if (next) this.startPreviewAutoplay()
    else this.stopPreviewAutoplay()
  },

  startPreviewAutoplay() {
    this.stopPreviewAutoplay()
    if (this._previewMode !== 'frames') return
    if (!this.data.previewModalVisible) return
    if (!this.data.previewAutoplay) this.setData({ previewAutoplay: true })
    const tickMs = 120
    this._previewAutoplayTimer = setInterval(() => {
      if (this._previewMode !== 'frames') return
      if (!this.data.previewModalVisible) return
      const indices = this._previewFrameIndices || []
      if (indices.length <= 1) return
      const cursor = Number(this._previewFrameCursor) || 0
      const nextCursor = (cursor >= indices.length - 1) ? 0 : (cursor + 1)
      this._previewFrameCursor = nextCursor
      this.updatePreviewFrame()
    }, tickMs)
  },

  stopPreviewAutoplay() {
    if (this._previewAutoplayTimer) clearInterval(this._previewAutoplayTimer)
    this._previewAutoplayTimer = null
    if (this.data.previewAutoplay) this.setData({ previewAutoplay: false })
  },

  async updatePreviewFrame() {
    if (this._previewMode !== 'frames') return
    const indices = this._previewFrameIndices || []
    const cursor = Number(this._previewFrameCursor) || 0
    if (!indices.length || cursor < 0 || cursor >= indices.length) return

    const frameIndex = indices[cursor]
    const total = Number(this.data.inputFrames) || 1
    const canPrev = cursor > 0
    const canNext = cursor < indices.length - 1

    let src = this._previewFrameCache && this._previewFrameCache[frameIndex]
    if (!src) {
      wx.showLoading({ title: '加载中…', mask: false })
      try {
        try {
          const res = await getGifFramePng({
            inputPath: this.data.inputPath,
            canvas: this.canvas,
            ctx: this.ctx,
            frameIndex,
            maxSidePx: MAX_SIDE_OPTIONS[this.data.maxSideIndex] || 480,
          })
          src = (res && res.src) || ''
          if (!this._previewFrameCache) this._previewFrameCache = {}
          if (src) this._previewFrameCache[frameIndex] = src
        } catch (e) {
          wx.showToast({ title: (e && e.message) ? e.message : '加载失败', icon: 'none' })
        }
      } finally {
        wx.hideLoading()
      }
    }

    this.setData({
      previewModalSrc: src,
      previewModalIndex: frameIndex + 1,
      previewModalTotal: total,
      previewModalCanPrev: canPrev,
      previewModalCanNext: canNext,
    })
  },

  onPreviewPrev() {
    if (this._previewMode !== 'frames') return
    const cursor = Number(this._previewFrameCursor) || 0
    if (cursor <= 0) return
    this._previewFrameCursor = cursor - 1
    this.updatePreviewFrame()
  },

  onPreviewNext() {
    if (this._previewMode !== 'frames') return
    const indices = this._previewFrameIndices || []
    const cursor = Number(this._previewFrameCursor) || 0
    if (cursor >= indices.length - 1) return
    this._previewFrameCursor = cursor + 1
    this.updatePreviewFrame()
  },

  onPreviewTouchStart(e) {
    const t = (e && e.touches && e.touches[0]) || null
    if (!t) return
    this._previewTouch = { x: t.clientX, y: t.clientY }
  },

  onPreviewTouchMove(e) {
    if (this._previewMode !== 'frames') return
    const start = this._previewTouch
    const t = (e && e.touches && e.touches[0]) || null
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) this._previewDragging = true
  },

  onPreviewTouchEnd(e) {
    if (this._previewMode !== 'frames') return
    const start = this._previewTouch
    this._previewTouch = null
    this._previewDragging = false
    const t = (e && e.changedTouches && e.changedTouches[0]) || null
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 32 || Math.abs(dx) < Math.abs(dy)) return
    if (dx > 0) this.onPreviewPrev()
    else this.onPreviewNext()
  },

  resetCropForAspect() {
    const aspect = this.data.cropAspect
    if (aspect === 'none') {
      this.setData({ cropConfig: { enabled: false, x: 0, y: 0, width: 100, height: 100 }, cropPreviewConfig: null }, () => this.markOutputDirty())
      return
    }
    const a = aspectToNumber(aspect)
    if (!a) {
      this.setData({
        cropConfig: { enabled: true, x: 10, y: 10, width: 80, height: 80 },
        cropPreviewConfig: { x: 10, y: 10, width: 80, height: 80 },
      }, () => this.markOutputDirty())
      return
    }

    const stageW = Number(this.data.gifStage && this.data.gifStage.widthPx) || 0
    const stageH = Number(this.data.gifStage && this.data.gifStage.heightPx) || 0
    if (!stageW || !stageH) {
      this._pendingCropReset = true
      this.scheduleUpdateGifStage()
      this.setData({
        cropConfig: { enabled: true, x: 10, y: 10, width: 80, height: 80 },
        cropPreviewConfig: { x: 10, y: 10, width: 80, height: 80 },
      }, () => this.markOutputDirty())
      return
    }

    const margin = 0.86
    const maxWpx = stageW * margin
    const maxHpx = stageH * margin
    const stageAspect = stageW / stageH

    let wPx = 0
    let hPx = 0
    if (stageAspect >= a) {
      hPx = maxHpx
      wPx = hPx * a
    } else {
      wPx = maxWpx
      hPx = wPx / a
    }

    const w = clampPct((wPx / stageW) * 100)
    const h = clampPct((hPx / stageH) * 100)
    const x = clampPct(Math.round((100 - w) / 2))
    const y = clampPct(Math.round((100 - h) / 2))
    this.setData({
      cropConfig: { enabled: true, x, y, width: w, height: h },
      cropPreviewConfig: { x, y, width: w, height: h },
    }, () => this.markOutputDirty())
  },

  onCropAspectChange(e) {
    if (this.data.processing) return
    const ratio = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.ratio) || 'none'
    this.setData({ cropAspect: ratio }, () => {
      this._pendingCropReset = true
      this.scheduleUpdateGifStage()
      this.resetCropForAspect()
    })
  },

  ensureCropInBounds(cfg, rect) {
    const config = { ...cfg }
    const stageW = Number((rect && rect.width) || (this.data.gifStage && this.data.gifStage.widthPx)) || 0
    const stageH = Number((rect && rect.height) || (this.data.gifStage && this.data.gifStage.heightPx)) || 0
    let x = clampPct(config.x)
    let y = clampPct(config.y)
    let w = clampPct(config.width)
    let h = clampPct(config.height)

    if (!stageW || !stageH) {
      const minSize = 10
      if (w < minSize) w = minSize
      if (h < minSize) h = minSize
      if (x + w > 100) x = 100 - w
      if (y + h > 100) y = 100 - h
      config.x = clampPct(x)
      config.y = clampPct(y)
      config.width = clampPct(w)
      config.height = clampPct(h)
      return config
    }

    let xPx = (x / 100) * stageW
    let yPx = (y / 100) * stageH
    let wPx = (w / 100) * stageW
    let hPx = (h / 100) * stageH

    const minWpx = Math.max(24, stageW * 0.08)
    const minHpx = Math.max(24, stageH * 0.08)
    if (wPx < minWpx) wPx = minWpx
    if (hPx < minHpx) hPx = minHpx

    const a = aspectToNumber(this.data.cropAspect)
    if (a) {
      const targetHpx = wPx / a
      const targetWpx = hPx * a
      if (Math.abs(targetHpx - hPx) <= Math.abs(targetWpx - wPx)) hPx = targetHpx
      else wPx = targetWpx

      if (wPx > stageW) {
        wPx = stageW
        hPx = wPx / a
      }
      if (hPx > stageH) {
        hPx = stageH
        wPx = hPx * a
      }
      if (wPx < minWpx) {
        wPx = minWpx
        hPx = wPx / a
      }
      if (hPx < minHpx) {
        hPx = minHpx
        wPx = hPx * a
      }
    }

    xPx = Math.max(0, Math.min(stageW - wPx, xPx))
    yPx = Math.max(0, Math.min(stageH - hPx, yPx))

    x = clampPct((xPx / stageW) * 100)
    y = clampPct((yPx / stageH) * 100)
    w = clampPct((wPx / stageW) * 100)
    h = clampPct((hPx / stageH) * 100)

    config.x = x
    config.y = y
    config.width = w
    config.height = h
    return config
  },

  onCropDragStart(e) {
    if (this.data.processing) return
    const t = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || 'move'
    const touch = (e && e.touches && e.touches[0]) || null
    if (!touch) return
    this._cropDrag = {
      type: t,
      startX: touch.clientX,
      startY: touch.clientY,
      origin: { ...this.data.cropConfig },
    }
    const q = wx.createSelectorQuery()
    q.select('#gifStage').boundingClientRect((rect) => {
      if (!this._cropDrag || !rect) return
      this._cropDrag.rect = rect
    }).exec()
    this.setData({ cropDragging: true })
  },

  onCropDragMove(e) {
    if (this.data.processing) return
    const drag = this._cropDrag
    const touch = (e && e.touches && e.touches[0]) || null
    if (!drag || !touch) return

    const apply = (rect) => {
      if (!rect || !rect.width || !rect.height) return
      const a = aspectToNumber(this.data.cropAspect)
      const deltaXpx = touch.clientX - drag.startX
      const deltaYpx = touch.clientY - drag.startY

      const baseXpx = (clampPct(drag.origin.x) / 100) * rect.width
      const baseYpx = (clampPct(drag.origin.y) / 100) * rect.height
      const baseWpx = (clampPct(drag.origin.width) / 100) * rect.width
      const baseHpx = (clampPct(drag.origin.height) / 100) * rect.height

      const minWpx = Math.max(24, rect.width * 0.08)
      const minHpx = Math.max(24, rect.height * 0.08)

      let xPx = baseXpx
      let yPx = baseYpx
      let wPx = baseWpx
      let hPx = baseHpx

      if (drag.type === 'move') {
        xPx = baseXpx + deltaXpx
        yPx = baseYpx + deltaYpx
      } else if (drag.type === 'resize-br') {
        wPx = baseWpx + deltaXpx
        hPx = baseHpx + deltaYpx
      } else if (drag.type === 'resize-tl') {
        xPx = baseXpx + deltaXpx
        yPx = baseYpx + deltaYpx
        wPx = baseWpx - deltaXpx
        hPx = baseHpx - deltaYpx
      } else if (drag.type === 'resize-tr') {
        yPx = baseYpx + deltaYpx
        wPx = baseWpx + deltaXpx
        hPx = baseHpx - deltaYpx
      } else if (drag.type === 'resize-bl') {
        xPx = baseXpx + deltaXpx
        wPx = baseWpx - deltaXpx
        hPx = baseHpx + deltaYpx
      }

      if (wPx < minWpx) wPx = minWpx
      if (hPx < minHpx) hPx = minHpx

      if (a && drag.type !== 'move') {
        const targetHpx = wPx / a
        const targetWpx = hPx * a
        if (Math.abs(targetHpx - hPx) <= Math.abs(targetWpx - wPx)) hPx = targetHpx
        else wPx = targetWpx

        if (wPx < minWpx) {
          wPx = minWpx
          hPx = wPx / a
        }
        if (hPx < minHpx) {
          hPx = minHpx
          wPx = hPx * a
        }

        const right = baseXpx + baseWpx
        const bottom = baseYpx + baseHpx

        if (drag.type === 'resize-tl') {
          xPx = right - wPx
          yPx = bottom - hPx
        } else if (drag.type === 'resize-tr') {
          xPx = baseXpx
          yPx = bottom - hPx
        } else if (drag.type === 'resize-bl') {
          xPx = right - wPx
          yPx = baseYpx
        }
      }

      if (drag.type === 'move') {
        xPx = Math.max(0, Math.min(rect.width - wPx, xPx))
        yPx = Math.max(0, Math.min(rect.height - hPx, yPx))
      } else {
        if (drag.type === 'resize-br') {
          const maxW = rect.width - baseXpx
          const maxH = rect.height - baseYpx
          if (wPx > maxW) wPx = maxW
          if (hPx > maxH) hPx = maxH
          if (a) {
            hPx = wPx / a
            if (hPx > maxH) {
              hPx = maxH
              wPx = hPx * a
            }
          }
          xPx = baseXpx
          yPx = baseYpx
        } else if (drag.type === 'resize-tl') {
          const maxW = baseXpx + baseWpx
          const maxH = baseYpx + baseHpx
          if (wPx > maxW) wPx = maxW
          if (hPx > maxH) hPx = maxH
          if (a) {
            hPx = wPx / a
            if (hPx > maxH) {
              hPx = maxH
              wPx = hPx * a
            }
          }
          xPx = maxW - wPx
          yPx = maxH - hPx
        } else if (drag.type === 'resize-tr') {
          const maxW = rect.width - baseXpx
          const maxH = baseYpx + baseHpx
          if (wPx > maxW) wPx = maxW
          if (hPx > maxH) hPx = maxH
          if (a) {
            hPx = wPx / a
            if (hPx > maxH) {
              hPx = maxH
              wPx = hPx * a
            }
          }
          xPx = baseXpx
          yPx = maxH - hPx
        } else if (drag.type === 'resize-bl') {
          const maxW = baseXpx + baseWpx
          const maxH = rect.height - baseYpx
          if (wPx > maxW) wPx = maxW
          if (hPx > maxH) hPx = maxH
          if (a) {
            hPx = wPx / a
            if (hPx > maxH) {
              hPx = maxH
              wPx = hPx * a
            }
          }
          xPx = maxW - wPx
          yPx = baseYpx
        }
      }

      const next = {
        x: (xPx / rect.width) * 100,
        y: (yPx / rect.height) * 100,
        width: (wPx / rect.width) * 100,
        height: (hPx / rect.height) * 100,
      }

      const bounded = this.ensureCropInBounds(next, rect)
      this.setData({
        cropConfig: { ...bounded, enabled: true },
        cropPreviewConfig: { x: bounded.x, y: bounded.y, width: bounded.width, height: bounded.height },
      }, () => this.markOutputDirty())
    }

    if (drag.rect) {
      apply(drag.rect)
      return
    }

    const q = wx.createSelectorQuery()
    q.select('#gifStage').boundingClientRect((rect) => {
      if (!this._cropDrag || !rect) return
      this._cropDrag.rect = rect
      apply(rect)
    }).exec()
  },

  onCropDragEnd() {
    if (this.data.processing) return
    this._cropDrag = null
    this.setData({ cropDragging: false })
  },

  onTextTabChange(e) {
    if (this.data.processing) return
    const tab = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'keyboard'
    this.setData({ textActiveTab: tab })
  },

  updateTextStyles() {
    const c = this.data.textConfig || {}
    const fillColor = String(c.color || '#ffffff')

    const scalePct = Math.max(50, Math.min(300, Number(c.textScalePct) || 150))
    const fontRpx = Math.max(18, Math.min(140, Math.round(34 * (scalePct / 100))))
    const textAlpha = (100 - (Number(c.textOpacity) || 0)) / 100
    const _fontStyle = `font-size: ${fontRpx}rpx; opacity: ${Math.max(0, Math.min(1, textAlpha))};`

    const strokeColor = String(c.strokeColor || (fillColor === '#000000' ? '#ffffff' : '#000000'))
    const strokeWidthPx = Math.max(0, Math.round((Number(c.strokeWidth) || 0) / 50 * 4 * 10) / 10)
    const strokeOpacity = (100 - (Number(c.strokeOpacity) || 0)) / 100
    const _strokeStyle = toStrokeStyle(this.data.textStrokeEnabled && strokeWidthPx > 0, strokeColor, strokeWidthPx || 2, strokeOpacity)

    const bgColor = String(c.bgColor || '#000000')
    const bgOpacity = (100 - (Number(c.bgOpacity) || 0)) / 100
    const _bgStyle = toBgStyle(this.data.textBgEnabled, bgColor, bgOpacity)

    let shadowX = Number(c.shadowX) || 0
    let shadowY = Number(c.shadowY) || 0
    let _shadowStyle = 'none'
    if (this.data.textShadowEnabled) {
      const sc = String(c.shadowColor || '')
      const dist = Math.max(0, Number(c.shadowDistance) || 0)
      if (sc && dist > 0) {
        const angle = Number(c.shadowAngle) || 0
        const o = calcShadowOffset(dist, angle)
        shadowX = Number(o.shadowX) || 0
        shadowY = Number(o.shadowY) || 0
        const blur = Math.max(0, (Number(c.shadowBlur) || 0) / 10)
        const a = (100 - (Number(c.shadowOpacity) || 0)) / 100
        const rgba = sc.startsWith('#') && sc.length === 7 ? hexToRgba(sc, Math.max(0, Math.min(1, a))) : sc
        _shadowStyle = `${shadowX * 0.5}px ${shadowY * 0.5}px ${blur}px ${rgba}`
      }
    }

    let _animStyle = ''
    const anim = String(c.animation || '')
    if (anim) {
      const speed = Math.max(0.5, Math.min(2, Number(c.animationSpeed || 1)))
      const durationS = (2 / speed).toFixed(2)
      const name = `text${anim.charAt(0).toUpperCase()}${anim.slice(1)}`
      _animStyle = `animation-name: ${name}; animation-duration: ${durationS}s; animation-timing-function: ease-in-out; animation-iteration-count: infinite;`
    }

    this.setData({
      textConfig: { ...c, _fontStyle, _strokeStyle, _shadowStyle, _bgStyle, _animStyle, shadowX, shadowY },
      textPreviewLines: splitTextLinesNoWrap(c.text, 10),
    })
  },

  onTextInput(e) {
    if (this.data.processing) return
    const value = String((e && e.detail && e.detail.value) || '')
    const nextText = filterEmoji(value)
    const c = this.data.textConfig || {}
    this.setData({ textConfig: { ...c, text: nextText }, textInputCount: nextText.length }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onTextScaleChange(e) {
    if (this.data.processing) return
    const v = Math.max(50, Math.min(300, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    this.setData({ textConfig: { ...c, textScalePct: v } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onTextInputFocus(e) {
    if (this.data.processing) return
    const keyboardHeight = Math.max(0, Number((e && e.detail && e.detail.height) || 0))
    this.setData({ textKeyboardHeightPx: keyboardHeight })
  },

  onTextInputBlur() {
    if (this.data.processing) return
    this.setData({ textKeyboardHeightPx: 0 })
  },

  onTextSizeChange(e) {
    if (this.data.processing) return
    const size = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.size) || 'M'
    this.setData({ textSizeMode: size }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onTextColorChange(e) {
    if (this.data.processing) return
    const color = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.color) || '#ffffff'
    const c = this.data.textConfig || {}
    this.setData({ textConfig: { ...c, color } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onTextOpacityChange(e) {
    if (this.data.processing) return
    const v = Math.max(0, Math.min(100, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    this.setData({ textConfig: { ...c, textOpacity: v } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onTextStrokeToggle(e) {
    if (this.data.processing) return
    const checked = !!(e.detail && e.detail.value)
    this.setData({ textStrokeEnabled: checked }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onStrokeColorChange(e) {
    if (this.data.processing) return
    const color = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.color) || ''
    const c = this.data.textConfig || {}
    this.setData({ textStrokeEnabled: !!color, textConfig: { ...c, strokeColor: color } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onStrokeWidthChange(e) {
    if (this.data.processing) return
    const v = Math.max(0, Math.min(50, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    let strokeColor = String(c.strokeColor || '')
    let strokeEnabled = !!this.data.textStrokeEnabled
    if (!strokeEnabled) {
      const fillColor = String(c.color || '#ffffff')
      strokeColor = strokeColor || (fillColor === '#000000' ? '#ffffff' : '#000000')
      strokeEnabled = true
    }
    this.setData({ textStrokeEnabled: strokeEnabled, textConfig: { ...c, strokeWidth: v, strokeColor } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onStrokeOpacityChange(e) {
    if (this.data.processing) return
    const v = Math.max(0, Math.min(100, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    let strokeColor = String(c.strokeColor || '')
    let strokeEnabled = !!this.data.textStrokeEnabled
    if (!strokeEnabled) {
      const fillColor = String(c.color || '#ffffff')
      strokeColor = strokeColor || (fillColor === '#000000' ? '#ffffff' : '#000000')
      strokeEnabled = true
    }
    this.setData({ textStrokeEnabled: strokeEnabled, textConfig: { ...c, strokeOpacity: v, strokeColor } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onShadowColorChange(e) {
    if (this.data.processing) return
    const color = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.color) || ''
    const c = this.data.textConfig || {}
    this.setData({ textShadowEnabled: !!color, textConfig: { ...c, shadowColor: color } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onShadowBlurChange(e) {
    if (this.data.processing) return
    const v = Math.max(0, Math.min(100, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    let shadowColor = String(c.shadowColor || '')
    let shadowEnabled = !!this.data.textShadowEnabled
    if (!shadowEnabled) {
      shadowColor = shadowColor || '#000000'
      shadowEnabled = true
    }
    this.setData({ textShadowEnabled: shadowEnabled, textConfig: { ...c, shadowBlur: v, shadowColor } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onShadowDistanceChange(e) {
    if (this.data.processing) return
    const v = Math.max(0, Math.min(100, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    let shadowColor = String(c.shadowColor || '')
    let shadowEnabled = !!this.data.textShadowEnabled
    if (!shadowEnabled) {
      shadowColor = shadowColor || '#000000'
      shadowEnabled = true
    }
    this.setData({ textShadowEnabled: shadowEnabled, textConfig: { ...c, shadowDistance: v, shadowColor } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onShadowAngleChange(e) {
    if (this.data.processing) return
    const v = Math.max(0, Math.min(360, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    let shadowColor = String(c.shadowColor || '')
    let shadowEnabled = !!this.data.textShadowEnabled
    if (!shadowEnabled) {
      shadowColor = shadowColor || '#000000'
      shadowEnabled = true
    }
    this.setData({ textShadowEnabled: shadowEnabled, textConfig: { ...c, shadowAngle: v, shadowColor } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onShadowOpacityChange(e) {
    if (this.data.processing) return
    const v = Math.max(0, Math.min(100, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    let shadowColor = String(c.shadowColor || '')
    let shadowEnabled = !!this.data.textShadowEnabled
    if (!shadowEnabled) {
      shadowColor = shadowColor || '#000000'
      shadowEnabled = true
    }
    this.setData({ textShadowEnabled: shadowEnabled, textConfig: { ...c, shadowOpacity: v, shadowColor } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onBgColorChange(e) {
    if (this.data.processing) return
    const color = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.color) || ''
    const c = this.data.textConfig || {}
    this.setData({ textBgEnabled: !!color, textConfig: { ...c, bgColor: color } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onBgOpacityChange(e) {
    if (this.data.processing) return
    const v = Math.max(0, Math.min(100, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    let bgColor = String(c.bgColor || '')
    let bgEnabled = !!this.data.textBgEnabled
    if (!bgEnabled) {
      bgColor = bgColor || '#000000'
      bgEnabled = true
    }
    this.setData({ textBgEnabled: bgEnabled, textConfig: { ...c, bgOpacity: v, bgColor } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onAnimationChange(e) {
    if (this.data.processing) return
    let animation = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.animation)
    if (animation === 'none') animation = ''
    const c = this.data.textConfig || {}
    this.setData({ textConfig: { ...c, animation: animation || '' } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onAnimationSpeedChange(e) {
    if (this.data.processing) return
    const speed = Math.max(0.5, Math.min(2, Number(e && e.detail && e.detail.value)))
    const c = this.data.textConfig || {}
    this.setData({ textConfig: { ...c, animationSpeed: speed } }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onTextDelete() {
    if (this.data.processing) return
    this._textDrag = null
    const c = this.data.textConfig || {}
    this.setData({ textConfig: { ...c, text: '' }, textInputCount: 0, textDragging: false }, () => {
      this.markOutputDirty()
      this.updateTextStyles()
    })
  },

  onTextDragStart(e) {
    if (this.data.processing) return
    const c = this.data.textConfig || {}
    const touches = (e && e.touches) || []
    if (touches.length >= 2) {
      const t0 = touches[0]
      const t1 = touches[1]
      const dx = (t1.clientX - t0.clientX)
      const dy = (t1.clientY - t0.clientY)
      const dist = Math.sqrt(dx * dx + dy * dy)
      const scalePct = Math.max(50, Math.min(300, Number(c.textScalePct) || 150))
      this._textDrag = { mode: 'pinch', startDist: dist, startScalePct: scalePct }
      this.setData({ textDragging: true })
      return
    }

    const touch = touches[0] || null
    if (!touch) return
    const drag = { mode: 'drag', startX: touch.clientX, startY: touch.clientY, originX: Number(c.xPct) || 50, originY: Number(c.yPct) || 50, rect: null }
    this._textDrag = drag
    this.setData({ textDragging: true })
    const q = wx.createSelectorQuery()
    q.select('#gifContainer').boundingClientRect((rect) => {
      if (!this._textDrag || this._textDrag !== drag) return
      if (!rect) return
      drag.rect = rect
    }).exec()
  },

  onTextDragMove(e) {
    if (this.data.processing) return
    const drag = this._textDrag
    const touches = (e && e.touches) || []
    if (!drag) return

    if (touches.length >= 2) {
      const t0 = touches[0]
      const t1 = touches[1]
      if (!t0 || !t1) return
      const dx = (t1.clientX - t0.clientX)
      const dy = (t1.clientY - t0.clientY)
      const dist = Math.sqrt(dx * dx + dy * dy)
      const baseDist = Math.max(1, Number(drag.startDist) || 1)
      const ratio = dist / baseDist
      const startScalePct = Math.max(50, Math.min(300, Number(drag.startScalePct) || 150))
      const nextScalePct = Math.max(50, Math.min(300, Math.round(startScalePct * ratio)))
      const c = this.data.textConfig || {}
      if (Number(c.textScalePct) !== nextScalePct) {
        this.setData({ textConfig: { ...c, textScalePct: nextScalePct } }, () => {
          this.markOutputDirty()
          this.updateTextStyles()
        })
      }
      return
    }

    if (drag.mode !== 'drag') return
    const touch = touches[0] || null
    if (!touch) return

    const apply = (rect) => {
      if (!rect || !rect.width || !rect.height) return
      const dx = ((touch.clientX - drag.startX) / rect.width) * 100
      const dy = ((touch.clientY - drag.startY) / rect.height) * 100
      const x = clampPct(drag.originX + dx)
      const y = clampPct(drag.originY + dy)
      const c = this.data.textConfig || {}
      this.setData({ textConfig: { ...c, xPct: x, yPct: y } }, () => this.markOutputDirty())
    }

    if (drag.rect) {
      apply(drag.rect)
      return
    }

    const q = wx.createSelectorQuery()
    q.select('#gifContainer').boundingClientRect((rect) => {
      if (!this._textDrag || this._textDrag !== drag) return
      if (!rect) return
      drag.rect = rect
      apply(rect)
    }).exec()
  },

  onTextDragEnd() {
    if (this.data.processing) return
    this._textDrag = null
    this.setData({ textDragging: false })
  },

  onFrameStepPick(e) {
    if (this.data.processing) return
    const idx = Number(e.detail && e.detail.value) || 0
    this.setData({ frameStepIndex: idx }, () => this.markOutputDirty())
  },

  onQualityChange(e) {
    if (this.data.processing) return
    const checked = !!(e && e.detail && e.detail.value)
    const mode = checked ? QUALITY_MODE.HIGH : QUALITY_MODE.STANDARD
    this.setData({ qualityMode: mode }, () => {
      this.updateCompressMetaText()
      this.markOutputDirty()
    })
  },

  async onGenerate() {
    if (this.data.processing) return
    if (!this.data.inputPath) {
      this.onChooseSource()
      return
    }
    if (this.data.outPath && !this.data.outputDirty) {
      this.openPreviewSingle({ src: this.data.outPath, title: '预览' })
      return
    }
    if (!this.canvas || !this.ctx) {
      wx.showToast({ title: '画布未就绪，请稍后重试', icon: 'none' })
      return
    }

    const maxSideOpt = MAX_SIDE_OPTIONS[this.data.maxSideIndex]
    const maxSidePx = maxSideOpt ? maxSideOpt : Math.max(Number(this.data.inputW) || 0, Number(this.data.inputH) || 0)
    const frameStep = FRAME_STEP_OPTIONS[this.data.frameStepIndex] || 1
    const dither = this.data.qualityMode === QUALITY_MODE.HIGH

    const cropEnabled = this.data.cropAspect !== 'none'
    const cropConfig = cropEnabled ? { ...this.data.cropConfig, enabled: true } : { enabled: false }

    const deletedFrames = Object.keys(this.data.trimDeleted || {}).map((k) => Number(k)).filter((n) => Number.isFinite(n))
    const trimConfig = { startFrame: 0, endFrame: this.data.maxFrameIndex, deletedFrames }

    const resizeConfig = { enabled: true, scalePct: this.data.resizeScalePct }

    const t = this.data.textConfig || {}
    const text = String(t.text || '').trim()
    const strokeColor = String(t.strokeColor || (t.color === '#000000' ? '#ffffff' : '#000000'))
    const bgColor = String(t.bgColor || '#000000')
    const shadowColor = String(t.shadowColor || '')
    const textConfig = text ? {
      text,
      xPct: t.xPct,
      yPct: t.yPct,
      sizeMode: 'M',
      color: t.color,
      textOpacity: Number(t.textOpacity) || 0,
      textScalePct: Math.max(50, Math.min(300, Number(t.textScalePct) || 150)),

      stroke: !!this.data.textStrokeEnabled,
      strokeColor,
      strokeWidth: Number(t.strokeWidth) || 30,
      strokeOpacity: Number(t.strokeOpacity) || 0,

      shadow: !!this.data.textShadowEnabled,
      shadowColor,
      shadowBlur: Number(t.shadowBlur) || 0,
      shadowDistance: Number(t.shadowDistance) || 0,
      shadowAngle: Number(t.shadowAngle) || 0,
      shadowOpacity: Number(t.shadowOpacity) || 0,

      bg: !!this.data.textBgEnabled,
      bgColor,
      bgOpacity: Number(t.bgOpacity) || 0,

      animation: String(t.animation || ''),
      animationSpeed: Number(t.animationSpeed || 1),
    } : null

    this.updateTextStyles()

    this.setData({ processing: true, progressText: '准备中…', progressPercent: 0 })
    wx.showLoading({ title: '处理中…', mask: true })
    try {
      const res = await editGif({
        inputPath: this.data.inputPath,
        canvas: this.canvas,
        ctx: this.ctx,
        maxSidePx,
        frameStep,
        dither,
        cropConfig,
        trimConfig,
        textConfig,
        resizeConfig,
        onProgress: ({ step, index, total }) => {
          const i = Number(index) || 0
          const t2 = Number(total) || 0
          let pct = 0
          if (t2 > 0) {
            const r = Math.max(0, Math.min(1, i / t2))
            if (step === '解码') pct = Math.round(r * 50)
            else if (step === '裁剪') pct = 50 + Math.round(r * 8)
            else if (step === '旋转') pct = 58 + Math.round(r * 6)
            else if (step === '缩放') pct = 64 + Math.round(r * 8)
            else if (step === '文字') pct = 72 + Math.round(r * 6)
            else if (step === '量化') pct = 78 + Math.round(r * 14)
            else if (step === '编码') pct = 92 + Math.round(r * 7)
            else if (step === '写入文件') pct = 99
            else if (step === '读取文件') pct = 3
            else pct = Math.round(r * 95)
          }
          const nextPct = Math.max(this.data.progressPercent || 0, Math.min(99, pct))
          this.setData({ progressText: `${step} ${nextPct}%`, progressPercent: nextPct })
        },
      })
      wx.hideLoading()
      const outFps = Number(res.fps) || 0
      const outSizeText = outFps > 0
        ? `输出：${res.width}×${res.height}px · ${res.frames}帧 · ${outFps.toFixed(1)}FPS · ${formatBytes(res.size)}`
        : `输出：${res.width}×${res.height}px · ${res.frames}帧 · ${formatBytes(res.size)}`
      this.setData({
        outPath: res.outPath,
        outSizeText,
        outputDirty: false,
        processing: false,
        progressText: '',
        progressPercent: 100,
      }, () => this.updatePrimaryActionText())
      wx.showToast({ title: '已生成', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      this.setData({ processing: false, progressText: '', progressPercent: 0 })
      wx.showModal({ title: '生成失败', content: (e && e.message) ? e.message : '生成失败，请重试', showCancel: false })
    }
  },

  async onSave() {
    const filePath = this.data.outPath
    if (!filePath) return
    try {
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })
      })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      wx.showModal({ title: '保存失败', content: '请检查相册权限后重试', showCancel: false })
    }
  },

  onPreviewImage(e) {
    const src = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.src) || ''
    if (!src) return
    this.openPreviewSingle({ src, title: '预览' })
  },

  onClosePreviewModal() {
    this.stopPreviewAutoplay()
    this._previewMode = 'single'
    this._previewFrameIndices = null
    this._previewFrameCursor = 0
    this._previewTouch = null
    this._previewDragging = false
    this._previewIgnoreTap = false
    this.setData({ previewModalVisible: false, previewModalSrc: '', previewModalNavVisible: false })
    if (this._gifWasPlaying) this.setGifPlaying(true)
    this._gifWasPlaying = false
  },
})
