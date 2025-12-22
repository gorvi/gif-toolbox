// pages/index/index.js

const TOOLS = [
  {
    key: 'VIDEO_TO_GIF',
    title: '视频转GIF',
    desc: '截取≤10秒 · 低帧率更稳',
    url: '/pages/video-to-gif/index?autoChoose=1',
    tag: '推荐',
  },
  {
    key: 'IMAGES_TO_GIF',
    title: '图片转GIF',
    desc: '多图合成 · 可设帧时长',
    url: '/pages/images-to-gif/index?autoChoose=1',
    tag: '可用',
  },
  {
    key: 'GIF_COMPRESS',
    title: 'GIF压缩',
    desc: '降分辨率/抽帧减小体积',
    url: '/pages/gif-compress/index?autoChoose=1',
    tag: '可用',
  },
  {
    key: 'GIF_ADD_TEXT',
    title: 'GIF加字',
    desc: '文字样式 · 位置可调',
    url: '/pages/gif-add-text/index?autoChoose=1',
    tag: '可用',
  },
  {
    key: 'GIF_EDIT',
    title: 'GIF编辑',
    desc: '裁剪/剪切/文字/压缩',
    url: '/pages/gif-edit/index?autoChoose=1',
    tag: '可用',
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
    const { url, key, title, disabled } = e.currentTarget.dataset
    if (disabled || !url) {
      wx.showToast({
        title: `${title || '该功能'}待完善，后续更新上线`,
        icon: 'none',
      })
      return
    }

    wx.navigateTo({ url })
  },

  onTapLogs() {
    wx.navigateTo({ url: '/pages/logs/logs' })
  },
})
