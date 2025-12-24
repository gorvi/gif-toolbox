// pages/text-to-gif/index.js

Page({
  data: {
    textLines: [],
    activeTextIndex: 0,
    inputText: '',
    keyboardVisible: false,
    fontList: ['默认', '黑体', '宋体', '楷体', '微软雅黑'],
    fontIndex: 0,
    textColor: '#000000',
    bgColor: '#ffffff',
    fontSize: 48,
    animationList: ['无', '淡入', '淡出', '缩放', '旋转'],
    animationIndex: 0,
    frameDelayMs: 500,
    fps: 10,
    outPath: '',
    processing: false,
    progressText: '',
  },

  onLoad() {
    // 页面加载时的初始化
  },

  onShowKeyboard() {
    this.setData({
      keyboardVisible: true,
    })
  },

  onHideKeyboard() {
    this.setData({
      keyboardVisible: false,
    })
  },

  onInputText(e) {
    const value = e.detail.value || ''
    this.setData({
      inputText: value,
    })
  },

  onAddText() {
    const inputText = this.data.inputText.trim()
    if (!inputText) {
      wx.showToast({
        title: '请输入文字',
        icon: 'none',
      })
      return
    }

    const lines = inputText.split('\n').filter(line => line.trim())
    const newTextLines = [...this.data.textLines, ...lines]

    this.setData({
      textLines: newTextLines,
      inputText: '',
      keyboardVisible: false,
    })
  },

  onSelectText(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    this.setData({
      activeTextIndex: index,
    })
  },

  onRemoveText(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const newTextLines = [...this.data.textLines]
    newTextLines.splice(index, 1)

    this.setData({
      textLines: newTextLines,
    })
  },

  onClearText() {
    this.setData({
      textLines: [],
      activeTextIndex: 0,
    })
  },

  onFontChange(e) {
    const index = parseInt(e.detail.value)
    this.setData({
      fontIndex: index,
    })
  },

  onColorPicker() {
    wx.showActionSheet({
      itemList: ['黑色', '白色', '红色', '绿色', '蓝色', '黄色', '橙色', '紫色', '自定义'],
      success: (res) => {
        const colorMap = {
          0: '#000000',
          1: '#ffffff',
          2: '#ff0000',
          3: '#00ff00',
          4: '#0000ff',
          5: '#ffff00',
          6: '#ff9900',
          7: '#9900ff',
        }
        const color = colorMap[res.tapIndex] || '#000000'
        this.setData({
          textColor: color,
        })
      },
    })
  },

  onBgColorPicker() {
    wx.showActionSheet({
      itemList: ['白色', '黑色', '红色', '绿色', '蓝色', '黄色', '橙色', '紫色', '自定义'],
      success: (res) => {
        const colorMap = {
          0: '#ffffff',
          1: '#000000',
          2: '#ff0000',
          3: '#00ff00',
          4: '#0000ff',
          5: '#ffff00',
          6: '#ff9900',
          7: '#9900ff',
        }
        const color = colorMap[res.tapIndex] || '#ffffff'
        this.setData({
          bgColor: color,
        })
      },
    })
  },

  onFontSizeChange(e) {
    const value = parseInt(e.detail.value)
    this.setData({
      fontSize: value,
    })
  },

  onAnimationChange(e) {
    const index = parseInt(e.detail.value)
    this.setData({
      animationIndex: index,
    })
  },

  onDelayChange(e) {
    const value = parseInt(e.detail.value)
    this.setData({
      frameDelayMs: value,
    })
  },

  onFpsChange(e) {
    const value = parseInt(e.detail.value)
    this.setData({
      fps: value,
    })
  },

  onGenerate() {
    const { textLines } = this.data
    if (!textLines.length) {
      wx.showToast({
        title: '请先输入文字',
        icon: 'none',
      })
      return
    }

    this.setData({
      processing: true,
      progressText: '正在生成GIF...',
    })

    // 这里需要实现文字转GIF的核心功能
    // 由于微信小程序的限制，可能需要使用canvas绘制每一帧
    // 然后将canvas保存为图片，再合成GIF

    // 暂时使用模拟生成
    setTimeout(() => {
      this.setData({
        processing: false,
        progressText: '',
        outPath: '../../imgs/demo2.gif', // 暂时使用示例图片
      })
    }, 2000)
  },

  onSave() {
    const { outPath } = this.data
    if (!outPath) {
      wx.showToast({
        title: '请先生成GIF',
        icon: 'none',
      })
      return
    }

    wx.saveImageToPhotosAlbum({
      filePath: outPath,
      success: () => {
        wx.showToast({
          title: '保存成功',
          icon: 'success',
        })
      },
      fail: (err) => {
        wx.showToast({
          title: '保存失败',
          icon: 'none',
        })
        console.error('保存失败', err)
      },
    })
  },
})