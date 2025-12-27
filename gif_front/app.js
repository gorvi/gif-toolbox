// app.js
App({
  onLaunch() {
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 登录
    wx.login({
      success: res => {
        // 发送 res.code 到后台换取 openId, sessionKey, unionId
      }
    })
  },
  onPageNotFound(res) {
    // 处理页面未找到的情况
    const path = res?.path || ''
    const rawPath = res?.rawPath || ''
    
    // 忽略空路径和 .html 路径（这些是开发工具的内部错误）
    if (!path || path === '' || rawPath === '.html' || rawPath === '') {
      console.warn('忽略空路径页面未找到错误:', res)
      return
    }
    
    console.warn('页面未找到:', res)
    
    // 避免循环重定向：如果已经在首页，就不重定向
    const pages = getCurrentPages()
    if (pages && pages.length > 0) {
      const currentPage = pages[pages.length - 1]
      if (currentPage && currentPage.route === 'pages/index/index') {
        console.warn('已在首页，跳过重定向')
        return
      }
    }
    
    // 重定向到首页
    try {
      wx.reLaunch({
        url: '/pages/index/index',
        fail: (err) => {
          console.error('重定向到首页失败:', err)
        }
      })
    } catch (e) {
      console.error('重定向异常:', e)
    }
  },
  globalData: {
    userInfo: null,
    selectedVideoPath: null,
    selectedVideoDuration: null,
    selectedVideoWidth: null,
    selectedVideoHeight: null
  }
})
