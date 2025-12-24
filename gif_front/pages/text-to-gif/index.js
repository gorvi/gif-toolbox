const { DEFAULT_FRAME_DELAY_MS, DEFAULT_GIF_LOOP } = require('../../constants/config')
const { GifWriter } = require('../../libs/omggif.js')

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

const FONT_FAMILY_OPTIONS = [
  { label: '默认', value: 'sans-serif' },
  { label: '宋体', value: 'SimSun' },
  { label: '黑体', value: 'SimHei' },
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: '楷体', value: 'KaiTi' },
]

const COLOR_OPTIONS = [
  { value: '#000000' },
  { value: '#ffffff' },
  { value: '#ff0000' },
  { value: '#00ff00' },
  { value: '#0000ff' },
  { value: '#ffff00' },
  { value: '#ff00ff' },
  { value: '#00ffff' },
  { value: '#ff6600' },
  { value: '#9933ff' },
  { value: '#3399ff' },
  { value: '#00cc99' },
  { value: '#ff99cc' },
  { value: '#666666' },
  { value: '#999999' },
  { value: '#cccccc' },
]

const ANIMATION_OPTIONS = [
  { label: '无', value: 'none' },
  { label: '淡入淡出', value: 'fade' },
  { label: '滑动', value: 'slide' },
  { label: '缩放', value: 'scale' },
  { label: '旋转', value: 'rotate' },
]

Page({
  data: {
    textLines: [],
    editText: '',
    editModalVisible: false,
    colorModalVisible: false,
    currentColor: '',
    colorType: '',
    fontFamilyIndex: 0,
    fontFamilyList: FONT_FAMILY_OPTIONS.map(x => x.label),
    fontFamily: FONT_FAMILY_OPTIONS[0].value,
    fontColor: '#000000',
    fontSize: 48,
    bgColor: '#ffffff',
    frameDelayMs: DEFAULT_FRAME_DELAY_MS,
    fps: 10,
    animationIndex: 0,
    animationList: ANIMATION_OPTIONS.map(x => x.label),
    animation: ANIMATION_OPTIONS[0].value,
    currentPreviewText: '',
    previewTimer: null,
    processing: false,
    progressText: '',
    outPath: '',
    colorOptions: COLOR_OPTIONS,
  },

  setDataAsync(patch) {
    return new Promise((resolve) => this.setData(patch, resolve))
  },

  onLoad(options) {
    // 初始化时检查是否有自动选择参数
    const autoChoose = options && (options.autoChoose === '1' || options.autoChoose === 1)
    if (autoChoose) {
      setTimeout(() => {
        if (!this.data.textLines.length && !this.data.processing) {
          this.onStartEdit()
        }
      }, 0)
    }
  },

  onStartEdit() {
    this.setData({ editModalVisible: true, editText: this.data.textLines.join('\n') })
  },

  onCancelEditModal() {
    this.setData({ editModalVisible: false })
  },

  onConfirmEditModal() {
    const text = this.data.editText.trim()
    if (!text) {
      wx.showToast({ title: '请输入文字', icon: 'none' })
      return
    }

    const lines = text.split('\n').filter(line => line.trim())
    if (!lines.length) {
      wx.showToast({ title: '请输入有效文字', icon: 'none' })
      return
    }

    this.setData({
      textLines: lines,
      editModalVisible: false,
      outPath: '',
    })

    // 开始预览第一帧
    this.startPreview()
  },

  onEditTextInput(e) {
    this.setData({ editText: e.detail.value })
  },

  onClearText() {
    this.setData({ textLines: [], outPath: '' })
    this.stopPreview()
  },

  onFontFamilyChange(e) {
    const index = Number(e.detail.value || 0)
    this.setData({
      fontFamilyIndex: index,
      fontFamily: FONT_FAMILY_OPTIONS[index].value,
    })
  },

  onFontColorPicker() {
    this.setData({ colorModalVisible: true, colorType: 'font', currentColor: this.data.fontColor })
  },

  onBgColorPicker() {
    this.setData({ colorModalVisible: true, colorType: 'bg', currentColor: this.data.bgColor })
  },

  onSelectColor(e) {
    const color = e.currentTarget.dataset.color
    this.setData({ currentColor: color })
  },

  onCancelColorModal() {
    this.setData({ colorModalVisible: false })
  },

  onConfirmColorModal() {
    if (this.data.colorType === 'font') {
      this.setData({ fontColor: this.data.currentColor })
    } else {
      this.setData({ bgColor: this.data.currentColor })
    }
    this.setData({ colorModalVisible: false })
  },

  onFontSizeChange(e) {
    this.setData({ fontSize: Number(e.detail.value || 48) })
  },

  onDelayChange(e) {
    this.setData({ frameDelayMs: Number(e.detail.value || DEFAULT_FRAME_DELAY_MS) })
  },

  onFpsChange(e) {
    this.setData({ fps: Number(e.detail.value || 10) })
  },

  onAnimationChange(e) {
    const index = Number(e.detail.value || 0)
    this.setData({
      animationIndex: index,
      animation: ANIMATION_OPTIONS[index].value,
    })
  },

  startPreview() {
    this.stopPreview()
    let currentIndex = 0
    const lines = this.data.textLines

    const updatePreview = () => {
      if (currentIndex >= lines.length) {
        currentIndex = 0
      }
      this.setData({ currentPreviewText: lines[currentIndex] })
      currentIndex++
    }

    updatePreview()
    this.previewTimer = setInterval(updatePreview, this.data.frameDelayMs)
  },

  stopPreview() {
    if (this.previewTimer) {
      clearInterval(this.previewTimer)
      this.previewTimer = null
    }
  },

  onPreview() {
    if (this.data.processing) return

    this.setData({
      processing: true,
      progressText: '正在生成预览动画...',
    })

    // 启动预览
    this.startPreview()

    this.setData({
      processing: false,
      progressText: '',
    })
    wx.showToast({ title: '预览已开始', icon: 'success' })
  },

  onGenerate() {
    if (this.data.processing) return

    this.setData({
      processing: true,
      progressText: '正在生成GIF...',
    })

    // 这里可以实现GIF生成功能
    setTimeout(() => {
      this.setData({
        processing: false,
        progressText: '',
        outPath: 'https://picsum.photos/400/200', // 临时预览图
      })
      wx.showToast({ title: 'GIF生成成功', icon: 'success' })
    }, 2000)
  },

  onSave() {
    if (!this.data.outPath) {
      wx.showToast({ title: '请先生成GIF', icon: 'none' })
      return
    }

    wx.saveImageToPhotosAlbum({
      filePath: this.data.outPath,
      success: () => {
        wx.showToast({ title: '保存成功', icon: 'success' })
      },
      fail: () => {
        wx.showToast({ title: '保存失败', icon: 'none' })
      },
    })
  },

  async convertTextToGif() {
    const { textLines, fontFamily, fontColor, fontSize, bgColor, frameDelayMs, animation, fps } = this.data

    if (!textLines.length) {
      throw new Error('请先输入文字')
    }

    // 创建 canvas
    const canvas = wx.createCanvas()
    const ctx = canvas.getContext('2d')

    // 设置画布尺寸
    const canvasWidth = 400
    const canvasHeight = 200
    canvas.width = canvasWidth
    canvas.height = canvasHeight

    // 预估 buffer（粗略）：头+每帧压缩块，给一个较宽裕的上限，避免越界
    const maxBytes = Math.min(60 * 1024 * 1024, 1024 * 1024 + canvasWidth * canvasHeight * textLines.length) // 上限 60MB
    const buffer = new Uint8Array(maxBytes)
    const writer = new GifWriter(buffer, canvasWidth, canvasHeight, { loop: DEFAULT_GIF_LOOP })

    const delayCs = Math.max(1, Math.round(frameDelayMs / 10)) // GIF delay in centiseconds

    for (let i = 0; i < textLines.length; i++) {
      const text = textLines[i]

      // 清空画布
      ctx.clearRect(0, 0, canvasWidth, canvasHeight)

      // 绘制背景
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvasWidth, canvasHeight)

      // 设置字体样式
      ctx.font = `${fontSize}px ${fontFamily}`
      ctx.fillStyle = fontColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // 绘制文字
      ctx.fillText(text, canvasWidth / 2, canvasHeight / 2)

      // 取像素数据
      const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight)
      const rgba = imageData.data
      const indexed = new Uint8Array(canvasWidth * canvasHeight)

      // 量化颜色
      for (let p = 0, j = 0; p < rgba.length; p += 4, j++) {
        const a = rgba[p + 3]
        const invA = 255 - a
        const r = clampByte(Math.round(rgba[p] * a / 255 + 255 * invA / 255))
        const g = clampByte(Math.round(rgba[p + 1] * a / 255 + 255 * invA / 255))
        const b = clampByte(Math.round(rgba[p + 2] * a / 255 + 255 * invA / 255))
        indexed[j] = quantizeIndexAndColor(r, g, b).idx
      }

      // 添加帧到GIF
      writer.addFrame(0, 0, canvasWidth, canvasHeight, indexed, {
        palette: PALETTE_256,
        delay: delayCs,
        disposal: 1,
      })

      // 让出事件循环，避免 UI 假死
      await sleep0()
    }

    // 结束GIF编码
    const gifSize = writer.end()
    const gifBytes = buffer.slice(0, gifSize)

    // 保存GIF到本地
    const fs = wx.getFileSystemManager()
    const outPath = `${wx.env.USER_DATA_PATH}/gif_${Date.now()}.gif`
    fs.writeFileSync(outPath, gifBytes.buffer, 'binary')

    // 获取文件大小
    let size = 0
    try {
      const stat = fs.statSync(outPath)
      size = stat.size || 0
    } catch (e) {}

    return { outPath, width: canvasWidth, height: canvasHeight, size }
  },

  onPreview() {
    if (this.data.processing) return

    this.setData({
      processing: true,
      progressText: '正在生成预览动画...',
    })

    // 这里可以实现预览功能
    setTimeout(() => {
      this.setData({
        processing: false,
        progressText: '',
      })
      wx.showToast({ title: '预览功能开发中...', icon: 'none' })
    }, 1000)
  },

  async onGenerate() {
    if (this.data.processing) return

    this.setData({
      processing: true,
      progressText: '正在生成GIF...',
    })

    try {
      const result = await this.convertTextToGif()
      this.setData({
        processing: false,
        progressText: '',
        outPath: result.outPath,
      })
      wx.showToast({ title: 'GIF生成成功', icon: 'success' })
    } catch (error) {
      this.setData({
        processing: false,
        progressText: '',
      })
      wx.showToast({ title: `生成失败: ${error.message}`, icon: 'none' })
    }
  },

  onSave() {
    if (!this.data.outPath) {
      wx.showToast({ title: '请先生成GIF', icon: 'none' })
      return
    }

    wx.saveImageToPhotosAlbum({
      filePath: this.data.outPath,
      success: () => {
        wx.showToast({ title: '保存成功', icon: 'success' })
      },
      fail: () => {
        wx.showToast({ title: '保存失败', icon: 'none' })
      },
    })
  },

  onUnload() {
    this.stopPreview()
  },
})
