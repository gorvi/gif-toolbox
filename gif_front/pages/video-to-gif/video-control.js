/**
 * 视频播放控制模块
 * 处理视频播放、暂停、跳转等操作
 */

const { toFixed1 } = require('./utils')

/**
 * 创建视频控制器
 * @param {Object} page - 页面实例
 * @returns {Object} 视频控制方法
 */
function createVideoController(page) {
  return {
    /**
     * 跳转到指定时间点
     */
    seekTo(second) {
      if (!page.data.videoPath) return
      if (!page._videoCtx) {
        page._videoCtx = wx.createVideoContext('videoPlayer', page)
      }
      
      const t = toFixed1(Math.max(0, Number(second || 0)))
      page.setData({ currentS: t })
      if (page._videoCtx) {
        page._videoCtx.seek(t)
      }
    },

    /**
     * 预览指定时间点（用于拖动时预览）
     */
    previewAt(second) {
      if (!page.data.videoPath) return
      if (!page._videoCtx) {
        page._videoCtx = wx.createVideoContext('videoPlayer', page)
      }
      
      const t = toFixed1(Math.max(0, Number(second || 0)))
      // 预览：只暂停并跳转，不自动播放，避免“来回拉扯”感
      if (page._videoCtx) {
        page._videoCtx.pause()
        page._videoCtx.seek(t)
      }
      page.setData({ currentS: t, segmentPlaying: false })
    },

    /**
     * 播放全篇视频
     */
    playFull() {
      if (!page.data.videoPath) {
        wx.showToast({ title: '请先选择视频', icon: 'none' })
        return
      }
      
      // 停止片段播放状态
      if (page.data.segmentPlaying) {
        page.setData({ segmentPlaying: false })
      }

      // 恢复主时间线跟随播放
      if (typeof page._mainTimelineFollow !== 'undefined') {
        page._mainTimelineFollow = true
        if (page._mainTimeline && typeof page._mainTimeline.resumeAutoFollow === 'function') {
          page._mainTimeline.resumeAutoFollow()
        }
      }
      
      if (!page._videoCtx) {
        page._videoCtx = wx.createVideoContext('videoPlayer', page)
      }
      if (page._videoCtx) {
        // 如果有 currentS（包括主时间线拖动设置的值），先跳转到该时间点再播放
        const t = toFixed1(Math.max(0, Number(page.data.currentS || 0)))
        if (t > 0) {
          page._videoCtx.seek(t)
          setTimeout(() => {
            page._videoCtx && page._videoCtx.play()
          }, 150)
        } else {
          page._videoCtx.play()
        }
      }
    },

    /**
     * 播放选中片段
     */
    playSegment() {
      if (!page.data.videoPath) {
        wx.showToast({ title: '请先选择视频', icon: 'none' })
        return
      }

      const startS = page.data.startS || 0
      const endS = page.data.endS || 0
      const MIN_RANGE_S = 0.1
      
      if (endS - startS < MIN_RANGE_S) {
        wx.showToast({ title: '截取范围过短', icon: 'none' })
        return
      }

      // 如果正在播放片段，停止
      if (page.data.segmentPlaying) {
        if (page._videoCtx) {
          page._videoCtx.pause()
        }
        page.setData({ segmentPlaying: false })
        return
      }

      console.log('[片段播放] 准备播放', startS, '->', endS)

      if (!page._videoCtx) {
        page._videoCtx = wx.createVideoContext('videoPlayer', page)
      }

      // 设置片段播放状态
      page.setData({
        segmentPlaying: true,
        segmentEndS: endS,
        currentS: startS,
      })

      // 播放片段时也让主时间线重新跟随
      if (typeof page._mainTimelineFollow !== 'undefined') {
        page._mainTimelineFollow = true
        if (page._mainTimeline && typeof page._mainTimeline.resumeAutoFollow === 'function') {
          page._mainTimeline.resumeAutoFollow()
        }
      }

      // seek 到起点，然后播放
      if (page._videoCtx) {
        page._videoCtx.seek(startS)
        setTimeout(() => {
          if (page._videoCtx && page.data.segmentPlaying) {
            page._videoCtx.play()
          }
        }, 200)
      }
    },
  }
}

module.exports = {
  createVideoController,
}
