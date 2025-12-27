const { compressGif, getGifMeta } = require('../../services/gif-compress')

const MAX_SIDE_OPTIONS = [320, 480, 720]
const FRAME_STEP_OPTIONS = [1, 2, 3, 4]

const QUALITY_MODE = {
  STANDARD: 'STANDARD',
  HIGH: 'HIGH',
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

function formatSavePercent(inputBytes, outputBytes) {
  const inB = Number(inputBytes) || 0
  const outB = Number(outputBytes) || 0
  if (inB <= 0 || outB <= 0) return ''
  const saved = Math.max(0, inB - outB)
  const pct = Math.round((saved / inB) * 100)
  return `节省约 ${pct}%`
}

function calcScaledSize(srcW, srcH, maxSidePx) {
  const w = Number(srcW) || 0
  const h = Number(srcH) || 0
  const maxSide = Number(maxSidePx) || 0
  if (!w || !h || !maxSide) return { outW: 0, outH: 0 }
  const maxDim0 = Math.max(w, h)
  const baseLongEdge = Math.min(maxSide, maxDim0)
  const scale = baseLongEdge / maxDim0
  return {
    outW: Math.max(1, Math.round(w * scale)),
    outH: Math.max(1, Math.round(h * scale)),
  }
}

Page({
  data: {
    inputPath: '',
    inputInfoText: '',
    inputSizeText: '',
    inputBytes: 0,
    inputW: 0,
    inputH: 0,
    inputFrames: 0,
    largeHintText: '',
    estimateText: '',

    maxSideIndex: Math.max(0, MAX_SIDE_OPTIONS.indexOf(480)),
    maxSideLabels: MAX_SIDE_OPTIONS.map((v) => `${v}px`),

    frameStepIndex: Math.max(0, FRAME_STEP_OPTIONS.indexOf(2)),
    frameStepLabels: ['不抽帧', '每2帧取1帧', '每3帧取1帧', '每4帧取1帧'],

    qualityMode: QUALITY_MODE.HIGH,

    processing: false,
    progressText: '',
    progressPercent: 0,

    outPath: '',
    outSizeText: '',
    outBytes: 0,
    outputDirty: false,
    primaryActionText: '开始压缩',

    previewModalVisible: false,
    previewModalSrc: '',
    previewModalIndex: 1,
    previewModalTotal: 1,
    previewModalTitle: '预览',
    previewModalNavVisible: false,
    previewModalCanPrev: false,
    previewModalCanNext: false,
    previewControlsVisible: true,
  },

  computePrimaryActionText() {
    if (!this.data.inputPath) return '选择GIF'
    if (!this.data.outPath) return '开始压缩'
    if (this.data.outputDirty) return '重新压缩'
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
    if (!autoChoose) return
    setTimeout(() => {
      if (!this.data.inputPath && !this.data.processing) {
        this.onChooseSource()
      }
    }, 0)
  },

  async loadInputGif(path) {
    if (!path) return

    wx.showLoading({ title: '读取中…', mask: true })
    try {
      const fs = wx.getFileSystemManager()
      let size = 0
      try {
        const stat = fs.statSync(path)
        size = stat.size || 0
      } catch (e) {}

      const meta = await getGifMeta(path)
      const inputInfoText = `${meta.width}×${meta.height}px · ${meta.frames}帧`
      const inputSizeText = `大小：${formatBytes(size)}`
      const inputW = Number(meta.width) || 0
      const inputH = Number(meta.height) || 0
      const inputFrames = Number(meta.frames) || 0

      const isLarge = (size >= 8 * 1024 * 1024) || (inputFrames >= 200)
      const largeHintText = isLarge ? '文件较大，建议先抽帧/降分辨率以避免等待过久' : ''

      this.setData({
        inputPath: path,
        inputInfoText,
        inputSizeText,
        inputBytes: size,
        inputW,
        inputH,
        inputFrames,
        largeHintText,
        outPath: '',
        outSizeText: '',
        outBytes: 0,
        outputDirty: false,
        progressText: '',
        progressPercent: 0,
      }, () => this.updatePrimaryActionText())
      this.updateEstimate()
    } finally {
      wx.hideLoading()
    }
  },

  onChooseSource() {
    if (this.data.processing) return

    wx.showActionSheet({
      itemList: ['相册选择（GIF）', '聊天图片（GIF）', '聊天文件（GIF）'],
      success: async (res) => {
        const tapIndex = Number(res && res.tapIndex)
        try {
          if (tapIndex === 0) {
            const path = await chooseGifFromAlbum()
            await this.loadInputGif(path)
            return
          }
          if (tapIndex === 1) {
            const path = await chooseGifFromChatImage()
            await this.loadInputGif(path)
            return
          }
          if (tapIndex === 2) {
            const path = await chooseGifFromChat()
            await this.loadInputGif(path)
          }
        } catch (e) {
          if (isCancelError(e)) return
          wx.hideLoading()
          wx.showModal({
            title: '读取失败',
            content: (e && e.message) ? e.message : '读取失败，请重试',
            showCancel: false,
          })
        }
      },
      fail: (e) => {
        if (isCancelError(e)) return
      },
    })
  },

  updateEstimate() {
    const w = Number(this.data.inputW) || 0
    const h = Number(this.data.inputH) || 0
    const frames = Number(this.data.inputFrames) || 0
    const maxSidePx = MAX_SIDE_OPTIONS[this.data.maxSideIndex] || 0
    const frameStep = FRAME_STEP_OPTIONS[this.data.frameStepIndex] || 1

    if (!w || !h || !frames || !maxSidePx) {
      this.setData({ estimateText: '' })
      return
    }

    const scaled = calcScaledSize(w, h, maxSidePx)
    const outFrames = Math.max(1, Math.ceil(frames / Math.max(1, frameStep)))
    const estimateText = `预估输出：${scaled.outW}×${scaled.outH}px · ${outFrames}帧`
    if (estimateText !== this.data.estimateText) {
      this.setData({ estimateText })
    }
  },

  async onChooseGif() {
    if (this.data.processing) return
    try {
      const path = await chooseGifFromAlbum()
      await this.loadInputGif(path)
    } catch (e) {
      if (isCancelError(e)) return
      wx.hideLoading()
      wx.showModal({
        title: '读取失败',
        content: (e && e.message) ? e.message : '读取失败，请重试',
        showCancel: false,
      })
    }
  },

  async onChooseGifFromChat() {
    if (this.data.processing) return
    try {
      const path = await chooseGifFromChat()
      await this.loadInputGif(path)
    } catch (e) {
      if (isCancelError(e)) return
      wx.hideLoading()
      wx.showModal({
        title: '读取失败',
        content: (e && e.message) ? e.message : '读取失败，请重试',
        showCancel: false,
      })
    }
  },

  onClear() {
    if (this.data.processing) return
    this.setData({
      inputPath: '',
      inputInfoText: '',
      inputSizeText: '',
      inputBytes: 0,
      inputW: 0,
      inputH: 0,
      inputFrames: 0,
      largeHintText: '',
      estimateText: '',
      outPath: '',
      outSizeText: '',
      outBytes: 0,
      outputDirty: false,
      progressText: '',
      progressPercent: 0,
    }, () => this.updatePrimaryActionText())
  },

  onMaxSidePick(e) {
    if (this.data.processing) return
    const idx = Number(e.detail && e.detail.value) || 0
    this.setData({ maxSideIndex: idx }, () => {
      this.markOutputDirty()
      this.updateEstimate()
    })
  },

  onFrameStepPick(e) {
    if (this.data.processing) return
    const idx = Number(e.detail && e.detail.value) || 0
    this.setData({ frameStepIndex: idx }, () => {
      this.markOutputDirty()
      this.updateEstimate()
    })
  },

  onQualityChange(e) {
    if (this.data.processing) return
    const checked = !!(e.detail && e.detail.value)
    this.setData({ qualityMode: checked ? QUALITY_MODE.HIGH : QUALITY_MODE.STANDARD }, () => this.markOutputDirty())
  },

  async onCompress() {
    if (this.data.processing) return
    if (!this.data.inputPath) return
    if (this.data.outPath && !this.data.outputDirty) {
      const urls = [this.data.inputPath, this.data.outPath].filter(Boolean)
      this.openPreviewGallery({ urls, cursor: urls.indexOf(this.data.outPath), title: '预览' })
      return
    }

    const maxSidePx = MAX_SIDE_OPTIONS[this.data.maxSideIndex] || 480
    const frameStep = FRAME_STEP_OPTIONS[this.data.frameStepIndex] || 2
    const dither = this.data.qualityMode === QUALITY_MODE.HIGH

    this.setData({ processing: true, progressText: '准备中…', progressPercent: 0 })
    wx.showLoading({ title: '压缩中…', mask: true })
    try {
      const res = await compressGif({
        inputPath: this.data.inputPath,
        maxSidePx,
        frameStep,
        dither,
        onProgress: ({ step, index, total }) => {
          const i = Number(index) || 0
          const t = Number(total) || 0
          let pct = 0
          if (t > 0) {
            const r = Math.max(0, Math.min(1, i / t))
            if (step === '解码') pct = Math.round(r * 65)
            else if (step === '缩放') pct = 65 + Math.round(r * 8)
            else if (step === '量化') pct = 73 + Math.round(r * 14)
            else if (step === '编码') pct = 87 + Math.round(r * 10)
            else if (step === '写入文件') pct = 99
            else if (step === '读取文件') pct = 3
            else pct = Math.round(r * 95)
          }
          const nextPct = Math.max(this.data.progressPercent || 0, Math.min(99, pct))
          this.setData({ progressText: `${step} ${nextPct}%`, progressPercent: nextPct })
        },
      })
      wx.hideLoading()

      const saveText = formatSavePercent(this.data.inputBytes, res.size)
      const outSizeText = `输出：${res.width}×${res.height}px · ${res.frames}帧 · ${formatBytes(res.size)}${saveText ? ` · ${saveText}` : ''}`
      this.setData({
        outPath: res.outPath,
        outSizeText,
        outBytes: res.size || 0,
        outputDirty: false,
        processing: false,
        progressText: '',
        progressPercent: 100,
      }, () => this.updatePrimaryActionText())
      wx.showToast({ title: '压缩完成', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      this.setData({ processing: false, progressText: '', progressPercent: 0 })
      wx.showModal({
        title: '压缩失败',
        content: (e && e.message) ? e.message : '压缩失败，请重试',
        showCancel: false,
      })
    }
  },

  async onSave() {
    const filePath = this.data.outPath
    if (!filePath) return
    try {
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: resolve,
          fail: reject,
        })
      })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      wx.showModal({
        title: '保存失败',
        content: '请检查相册权限后重试',
        showCancel: false,
      })
    }
  },

  onPreviewImage(e) {
    const src = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.src) || ''
    if (!src) return
    const urls = [this.data.inputPath, this.data.outPath].filter(Boolean)
    const idx0 = urls.indexOf(src)
    const idx = idx0 >= 0 ? idx0 : 0
    this.openPreviewGallery({ urls, cursor: idx, title: '预览' })
  },

  onPreviewCardTap() {},

  openPreviewGallery({ urls, cursor, title }) {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : []
    const total = list.length || 1
    const c = Math.max(0, Math.min(total - 1, Number(cursor) || 0))
    this._previewMode = 'gallery'
    this._previewUrls = list
    this._previewCursor = c
    this._previewTouch = null
    this._previewIgnoreTap = false

    this.setData({
      previewModalVisible: true,
      previewModalTitle: String(title || '预览'),
      previewModalSrc: list[c] || '',
      previewModalIndex: c + 1,
      previewModalTotal: total,
      previewModalNavVisible: total > 1,
      previewModalCanPrev: c > 0,
      previewModalCanNext: c < total - 1,
      previewControlsVisible: true,
    })
  },

  onTogglePreviewControls() {
    if (!this.data.previewControlsVisible) this.setData({ previewControlsVisible: true })
  },

  onPreviewPrev() {
    if (this._previewMode !== 'gallery') return
    const list = this._previewUrls || []
    const c = Number(this._previewCursor) || 0
    if (c <= 0) return
    const next = c - 1
    this._previewCursor = next
    this.setData({
      previewModalSrc: list[next] || '',
      previewModalIndex: next + 1,
      previewModalCanPrev: next > 0,
      previewModalCanNext: next < list.length - 1,
    })
  },

  onPreviewNext() {
    if (this._previewMode !== 'gallery') return
    const list = this._previewUrls || []
    const c = Number(this._previewCursor) || 0
    if (c >= list.length - 1) return
    const next = c + 1
    this._previewCursor = next
    this.setData({
      previewModalSrc: list[next] || '',
      previewModalIndex: next + 1,
      previewModalCanPrev: next > 0,
      previewModalCanNext: next < list.length - 1,
    })
  },

  onPreviewTouchStart(e) {
    const t = (e && e.touches && e.touches[0]) || null
    if (!t) return
    this._previewTouch = { x: t.clientX, y: t.clientY }
  },

  onPreviewTouchMove() {},

  onPreviewTouchEnd(e) {
    if (this._previewMode !== 'gallery') return
    const start = this._previewTouch
    this._previewTouch = null
    const t = (e && e.changedTouches && e.changedTouches[0]) || null
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 32 || Math.abs(dx) < Math.abs(dy)) return
    this._previewIgnoreTap = true
    if (dx > 0) this.onPreviewPrev()
    else this.onPreviewNext()
  },

  onClosePreviewModal() {
    this._previewMode = 'single'
    this._previewUrls = null
    this._previewCursor = 0
    this._previewTouch = null
    this._previewIgnoreTap = false
    this.setData({ previewModalVisible: false, previewModalSrc: '' })
  },
})
