// pages/index/index.js

const THUMB_VIDEO_TO_GIF = '../../imgs/demo4.gif'
const THUMB_IMAGES_TO_GIF = '../../imgs/demo1.gif'
const THUMB_GIF_EDIT = '../../imgs/demo3.gif'
const THUMB_TEXT_TO_GIF = '../../imgs/demo2.gif'

Page({
  data: {
    bannerCards: [
      {
        key: 'VIDEO_TO_GIF',
        title: '视频转GIF',
        desc: '将视频制作成动态GIF动图，简单好用',
        pill: '热门',
        icon: '▣',
        btnLabel: '视频转GIF',
        btnClass: 'banner-btn-green',
        url: '/pages/video-to-gif/index?autoChoose=1',
        bg: THUMB_VIDEO_TO_GIF,
        themeClass: 'banner-theme-green',
        thumb: THUMB_VIDEO_TO_GIF,
        thumbClass: 'banner-side-right',
        layoutClass: 'banner-layout-right',
      },
      {
        key: 'IMAGES_TO_GIF',
        title: '图片转GIF',
        desc: '多图合成GIF，可设帧时长与顺序',
        pill: '常用',
        icon: '▦',
        btnLabel: '图片转GIF',
        btnClass: 'banner-btn-purple',
        url: '/pages/images-to-gif/index?autoChoose=1',
        bg: THUMB_IMAGES_TO_GIF,
        themeClass: 'banner-theme-purple',
        thumb: THUMB_IMAGES_TO_GIF,
        thumbClass: 'banner-side-left',
        layoutClass: 'banner-layout-left',
      },
      {
        key: 'GIF_EDIT',
        title: 'GIF编辑',
        desc: '裁剪/删帧/加字/压缩，一页完成',
        pill: '必备',
        icon: '✦',
        btnLabel: '打开编辑',
        btnClass: 'banner-btn-blue',
        url: '/pages/gif-edit/index?autoChoose=1',
        bg: THUMB_GIF_EDIT,
        themeClass: 'banner-theme-blue',
        thumb: THUMB_GIF_EDIT,
        thumbClass: 'banner-side-right',
        layoutClass: 'banner-layout-right',
      },
      {
        key: 'TEXT_TO_GIF',
        title: '文字转GIF',
        desc: '输入文字生成动图，可设置字体颜色字号',
        pill: '新功能',
        icon: 'T',
        btnLabel: '文字转GIF',
        btnClass: 'banner-btn-purple',
        url: '/pages/text-to-gif/index',
        bg: THUMB_TEXT_TO_GIF,
        themeClass: 'banner-theme-purple',
        thumb: THUMB_TEXT_TO_GIF,
        thumbClass: 'banner-side-left',
        layoutClass: 'banner-layout-left',
      },
    ],
  },

  onTapQuick(e) {
    const url = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url) || ''
    const title = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.title) || ''
    if (!url) {
      wx.showToast({
        title: `${title || '该功能'}待定，后续更新上线`,
        icon: 'none',
      })
      return
    }
    wx.navigateTo({ url })
  },

  onTapTip() {
    wx.showModal({
      title: '提示',
      content: '视频截取最长10秒；建议 480p + 5FPS。\n遇到导出失败可尝试：降低分辨率/帧率或减少帧数。',
      showCancel: false,
      confirmText: '知道了',
    })
  },
})
