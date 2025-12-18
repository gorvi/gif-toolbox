// pages/index/index.js

const TOOLS = [
  {
    key: 'VIDEO_TO_GIF',
    title: '视频转GIF',
    desc: '截取≤20秒 · 低帧率更稳',
    url: '/pages/video-to-gif/index',
    tag: '推荐',
  },
  {
    key: 'IMAGES_TO_GIF',
    title: '图片转GIF',
    desc: '多图合成 · 可设帧时长',
    url: '/pages/images-to-gif/index',
    tag: '可用',
  },
  {
    key: 'GIF_COMPRESS',
    title: 'GIF压缩',
    desc: '降分辨率/抽帧减小体积',
    url: '',
    tag: '待做',
  },
  {
    key: 'GIF_ADD_TEXT',
    title: 'GIF加字',
    desc: '文字样式 · 位置可调',
    url: '',
    tag: '待做',
  },
  {
    key: 'GIF_ROTATE',
    title: 'GIF旋转',
    desc: '90/180/270 一键旋转',
    url: '',
    tag: '待做',
  },
  {
    key: 'GIF_CROP',
    title: 'GIF裁剪',
    desc: '裁剪区域 · 保留关键内容',
    url: '',
    tag: '待做',
  },
  {
    key: 'GIF_RESIZE',
    title: 'GIF缩放',
    desc: '按比例缩放 · 保持清晰',
    url: '',
    tag: '待做',
  },
]

Page({
  data: {
    tools: TOOLS,
  },

  async onTapTool(e) {
    const { url, key } = e.currentTarget.dataset
    if (!url) {
      wx.showToast({
        title: '功能待完善',
        icon: 'none',
      })
      return
    }
    
    // 如果是视频转GIF，先选择视频
    if (key === 'VIDEO_TO_GIF') {
      try {
        const { chooseSingleVideo } = require('../../utils/media')
        wx.showLoading({ title: '选择视频中...', mask: true })
        const res = await chooseSingleVideo()
        wx.hideLoading()
        
        // 将视频路径保存到全局数据
        const app = getApp()
        if (!app.globalData) {
          app.globalData = {}
        }
        app.globalData.selectedVideoPath = res.tempFilePath
        app.globalData.selectedVideoWidth = res.width
        app.globalData.selectedVideoHeight = res.height
        app.globalData.selectedVideoDuration = res.duration
        
        // 跳转到视频转GIF页面
        wx.navigateTo({ url })
      } catch (err) {
        wx.hideLoading()
        if (err.errMsg && !err.errMsg.includes('cancel')) {
          wx.showToast({
            title: err.errMsg || '选择视频失败',
            icon: 'none',
          })
        }
      }
    } else {
      wx.navigateTo({ url })
    }
  },

  onTapLogs() {
    wx.navigateTo({ url: '/pages/logs/logs' })
  },
})
