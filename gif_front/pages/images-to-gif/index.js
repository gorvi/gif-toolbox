const {
  MAX_IMAGE_COUNT,
  DEFAULT_FRAME_DELAY_MS,
  DEFAULT_GIF_LOOP,
  DEFAULT_GIF_MAX_SIDE_PX,
} = require('../../constants/config')

const { convertImagesToGif } = require('../../services/images-to-gif')

const MAX_SIDE_OPTIONS = [320, 480, 720]
const LOOP_OPTIONS = [
  { label: '无限循环', value: 0 },
  { label: '循环 1 次', value: 1 },
  { label: '循环 3 次', value: 3 },
]

const QUALITY_MODE = {
  STANDARD: 'STANDARD',
  HIGH: 'HIGH',
}

function chooseImages(count) {
  return new Promise((resolve, reject) => {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const files = (res.tempFiles || []).map((f) => ({ path: f.tempFilePath }))
          resolve(files)
        },
        fail: reject,
      })
      return
    }
    wx.chooseImage({
      count,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFilePaths || []).map((p) => ({ path: p }))
        resolve(files)
      },
      fail: reject,
    })
  })
}

Page({
  data: {
    images: [],
    frameDelayMs: DEFAULT_FRAME_DELAY_MS,
    maxSideIndex: Math.max(0, MAX_SIDE_OPTIONS.indexOf(DEFAULT_GIF_MAX_SIDE_PX)),
    maxSideLabels: MAX_SIDE_OPTIONS.map((v) => `${v}px`),
    loopIndex: Math.max(0, LOOP_OPTIONS.findIndex((x) => x.value === DEFAULT_GIF_LOOP)),
    loopLabels: LOOP_OPTIONS.map((x) => x.label),
    qualityMode: QUALITY_MODE.HIGH,

    processing: false,
    progressText: '',
    outPath: '',
  },

  onReady() {
    const query = wx.createSelectorQuery()
    query.select('#workCanvas').fields({ node: true, size: true }).exec((res) => {
      const node = res && res[0] && res[0].node
      if (!node) return
      this.canvas = node
      this.ctx = node.getContext('2d')
    })
  },

  async onChooseImages() {
    if (this.data.processing) return
    const remain = MAX_IMAGE_COUNT - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: `最多选择${MAX_IMAGE_COUNT}张`, icon: 'none' })
      return
    }

    try {
      const files = await chooseImages(Math.min(20, remain))
      if (!files.length) {
        wx.showToast({ title: '未选择图片', icon: 'none' })
        return
      }
      this.setData({
        images: this.data.images.concat(files).slice(0, MAX_IMAGE_COUNT),
        outPath: '',
      })
    } catch (e) {
      wx.showToast({ title: '选择图片失败', icon: 'none' })
    }
  },

  onRemoveImage(e) {
    if (this.data.processing) return
    const index = Number(e.currentTarget.dataset.index || 0)
    const next = this.data.images.slice()
    next.splice(index, 1)
    this.setData({ images: next, outPath: '' })
  },

  onClearImages() {
    if (this.data.processing) return
    this.setData({ images: [], outPath: '' })
  },

  onDelayChange(e) {
    this.setData({ frameDelayMs: Number(e.detail.value || DEFAULT_FRAME_DELAY_MS) })
  },

  onMaxSidePick(e) {
    this.setData({ maxSideIndex: Number(e.detail.value || 0) })
  },

  onLoopPick(e) {
    this.setData({ loopIndex: Number(e.detail.value || 0) })
  },

  onQualityChange(e) {
    const checked = !!(e && e.detail && e.detail.value)
    this.setData({ qualityMode: checked ? QUALITY_MODE.HIGH : QUALITY_MODE.STANDARD })
  },

  async onGenerate() {
    if (this.data.processing) return
    if (!this.data.images.length) {
      wx.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }
    if (!this.canvas || !this.ctx) {
      wx.showToast({ title: '画布未就绪，请稍后重试', icon: 'none' })
      return
    }

    const maxSidePx = MAX_SIDE_OPTIONS[this.data.maxSideIndex] || DEFAULT_GIF_MAX_SIDE_PX
    const loop = LOOP_OPTIONS[this.data.loopIndex] ? LOOP_OPTIONS[this.data.loopIndex].value : DEFAULT_GIF_LOOP

    this.setData({ processing: true, progressText: '准备中…', outPath: '' })
    wx.showLoading({ title: '生成中…', mask: true })
    try {
      const dither = this.data.qualityMode === QUALITY_MODE.HIGH
      const { outPath } = await convertImagesToGif({
        images: this.data.images,
        canvas: this.canvas,
        ctx: this.ctx,
        maxSidePx,
        frameDelayMs: this.data.frameDelayMs,
        loop,
        dither,
        onProgress: ({ step, index, total }) => {
          this.setData({ progressText: `${step} ${index}/${total}` })
        },
      })
      wx.hideLoading()
      this.setData({ outPath, processing: false, progressText: '' })
      wx.showToast({ title: '生成成功', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      this.setData({ processing: false, progressText: '' })
      wx.showModal({
        title: '生成失败',
        content: (e && e.message) ? e.message : '生成失败，请重试',
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
})


