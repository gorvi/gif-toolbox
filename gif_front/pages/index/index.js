// pages/index/index.js

const THUMB_VIDEO_TO_GIF = '../../imgs/demo4.gif'
const THUMB_IMAGES_TO_GIF = '../../imgs/demo1.gif'
const THUMB_GIF_EDIT = '../../imgs/demo3.gif'
const THUMB_VIDEO_TO_LIVE = '../../imgs/demo2.gif'

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
        key: 'VIDEO_TO_LIVE',
        title: '视频转Live',
        desc: '敬请期待',
        pill: '新',
        icon: '▤',
        btnLabel: '敬请期待',
        btnClass: 'banner-btn-orange',
        url: '',  // 空URL，点击时显示"待定"提示
        bg: THUMB_VIDEO_TO_LIVE,
        themeClass: 'banner-theme-orange',
        thumb: THUMB_VIDEO_TO_LIVE,
        thumbClass: 'banner-side-left',
        layoutClass: 'banner-layout-left',
      },
    ],
  },

  onTapQuick(e) {
    const url = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url) || ''
    const title = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.title) || ''
    
    // 严格验证 URL：不能为空字符串，必须以 /pages/ 开头
    if (!url || url.trim() === '' || !url.startsWith('/pages/')) {
      wx.showToast({
        title: `${title || '该功能'}待定，后续更新上线`,
        icon: 'none',
        duration: 2000
      })
      return
    }
    
    // 验证 URL 格式
    const cleanUrl = url.trim()
    if (cleanUrl === '' || cleanUrl === '/pages/' || !cleanUrl.match(/^\/pages\/[^/]+\/[^/]+/)) {
      wx.showToast({
        title: '页面路径无效',
        icon: 'none',
        duration: 2000
      })
      return
    }
    
    wx.navigateTo({ 
      url: cleanUrl,
      fail: (err) => {
        console.error('导航失败:', err)
        // 不显示错误提示，让 onPageNotFound 处理
      }
    })
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
