const { formatHms } = require('../../utils/time')
const { isVideoToLiveSupported, convertVideoToLive } = require('../../services/video-to-live')

const RESOLUTION_OPTIONS = [360, 480, 720, 1080]
const MIN_LIVE_DURATION_S = 0.5
const MAX_LIVE_DURATION_S = 3

function isCancelError(e) {
  const msg = String((e && (e.errMsg || e.message)) || '')
  return msg.includes('cancel') || msg.includes('fail cancel')
}

function pad2(n) {
  const s = String(Math.floor(Math.max(0, n)))
  return s.length >= 2 ? s : `0${s}`
}

function formatClock(totalSeconds, totalDurationSeconds) {
  const t = Math.max(0, Number(totalSeconds || 0))
  const sec = Math.floor(t)
  const d = Math.floor((t - sec) * 10 + 1e-6)

  if (Number(totalDurationSeconds || 0) >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${d}`
  }

  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${pad2(m)}:${pad2(s)}.${d}`
}

function chooseVideoFromChat() {
  return new Promise((resolve, reject) => {
    if (!wx.chooseMessageFile) {
      reject(new Error('当前微信版本不支持从聊天选择'))
      return
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'video',
      success: (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || null
        resolve(file ? file.path : '')
      },
      fail: reject,
    })
  })
}

function chooseSingleVideoFromSource(sourceType) {
  return new Promise((resolve, reject) => {
    const src = Array.isArray(sourceType) && sourceType.length ? sourceType : ['album', 'camera']
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['video'],
        sourceType: src,
        maxDuration: 60,
        success: (res) => {
          const file = (res.tempFiles && res.tempFiles[0]) || null
          if (!file) {
            reject(new Error('未选择视频'))
            return
          }
          resolve({
            tempFilePath: file.tempFilePath,
            duration: file.duration || 0,
            size: file.size || 0,
            width: file.width || 0,
            height: file.height || 0,
          })
        },
        fail: reject,
      })
      return
    }

    wx.chooseVideo({
      sourceType: src,
      maxDuration: 60,
      compressed: true,
      success: (res) => {
        resolve({
          tempFilePath: res.tempFilePath,
          duration: res.duration || 0,
          size: res.size || 0,
          width: res.width || 0,
          height: res.height || 0,
        })
      },
      fail: reject,
    })
  })
}

Page({
  data: {
    videoPath: '',
    durationS: 0,
    currentS: 0,
    startS: 0,
    clipLenS: 1.5,
    endS: 0,
    imagePath: null,  // Live Photo 静态图片路径

    resolutionIndex: Math.max(0, RESOLUTION_OPTIONS.indexOf(720)),
    resolutionLabels: RESOLUTION_OPTIONS.map((p) => `${p}p`),

    keepAudio: true,
    qualityMode: 'HIGH',

    processing: false,
    progressText: '',
    progressPercent: 0,

    outPath: '',

    topInfoText: '请选择一个视频',
    startText: '00:00.0',
    lenText: '00:01.5',
    maxStartS: 0,
    maxLenS: MAX_LIVE_DURATION_S,
    primaryActionText: '生成Live',

    minLiveDurationS: MIN_LIVE_DURATION_S,
    maxLiveDurationS: MAX_LIVE_DURATION_S,

    segmentPlaying: false,
    segmentEndS: 0,
  },

  onLoad(query) {
    const support = isVideoToLiveSupported()
    if (!support.supported) {
      wx.showModal({
        title: '暂不支持',
        content: support.reason || '当前环境暂不支持视频转Live',
        showCancel: false,
      })
      return
    }

    const app = getApp()
    if (app.globalData && app.globalData.selectedVideoPath) {
      const videoPath = app.globalData.selectedVideoPath
      const duration = app.globalData.selectedVideoDuration || 0
      app.globalData.selectedVideoPath = null
      app.globalData.selectedVideoWidth = null
      app.globalData.selectedVideoHeight = null
      app.globalData.selectedVideoDuration = null
      this.setVideoData(videoPath, duration)
      return
    }

    const autoChoose = query && (query.autoChoose === '1' || query.autoChoose === 1)
    if (autoChoose) {
      setTimeout(() => {
        if (!this.data.videoPath && !this.data.processing) this.onChooseVideo()
      }, 0)
    }
  },

  onUnload() {
    this.clearSegmentTimer()
  },

  clearSegmentTimer() {
    if (this._segmentStopTimer) {
      clearTimeout(this._segmentStopTimer)
      this._segmentStopTimer = null
    }
  },

  ensureVideoCtx() {
    if (!this._videoCtx) this._videoCtx = wx.createVideoContext('videoPlayer', this)
    return this._videoCtx
  },

  setVideoData(videoPath, duration) {
    const durationS = Math.max(0, Number(duration || 0))
    const clipLenS = Math.min(MAX_LIVE_DURATION_S, Math.max(MIN_LIVE_DURATION_S, 1.5))
    const startS = 0
    const endS = Math.min(durationS, startS + clipLenS)
    const maxStartS = Math.max(0, Math.round((durationS - clipLenS) * 10) / 10)
    const maxLenS = Math.min(MAX_LIVE_DURATION_S, durationS || MAX_LIVE_DURATION_S)

    this.setData({
      videoPath,
      durationS,
      currentS: 0,
      startS,
      clipLenS: Math.min(clipLenS, maxLenS),
      endS,
      outPath: '',
      maxStartS,
      maxLenS,
    })
    this.updateTexts()
  },

  updateTexts() {
    const durationS = this.data.durationS || 0
    const startS = this.data.startS || 0
    const clipLenS = this.data.clipLenS || 0
    const endS = Math.min(durationS, startS + clipLenS)
    const startText = formatClock(startS, durationS)
    const endText = formatClock(endS, durationS)
    const lenText = formatClock(clipLenS, clipLenS)

    const topInfoText = this.data.videoPath
      ? `片段 ${startText}–${endText} / 总长 ${formatHms(durationS)}`
      : '请选择一个视频'

    this.setData({
      endS,
      startText,
      lenText,
      topInfoText,
    })
  },

  async onChooseVideo() {
    if (this.data.processing) return

    try {
      const res = await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: ['拍摄', '从相册选择', '聊天视频'],
          success: resolve,
          fail: reject,
        })
      })

      const idx = Number(res && res.tapIndex)
      if (idx === 2) {
        const path = await chooseVideoFromChat()
        if (!path) throw new Error('未选择视频')
        this.setVideoData(path, 0)
        return
      }

      const sourceType = idx === 0 ? ['camera'] : ['album']
      const picked = await chooseSingleVideoFromSource(sourceType)
      this.setVideoData(picked.tempFilePath, picked.duration)
    } catch (e) {
      if (isCancelError(e)) return
      wx.showToast({ title: e.message || '选择失败', icon: 'none' })
    }
  },

  onVideoLoaded(e) {
    const duration = Number((e && e.detail && e.detail.duration) || 0)
    if (duration > 0) {
      const currentDuration = this.data.durationS || 0
      if (!currentDuration || Math.abs(duration - currentDuration) > 0.05) {
        this.setVideoData(this.data.videoPath, duration)
      }
    }
  },

  onTimeUpdate(e) {
    const t = Number((e && e.detail && e.detail.currentTime) || 0)
    this.setData({ currentS: t })
    if (this.data.segmentPlaying && t >= (this.data.segmentEndS || 0) - 0.05) {
      this.onPlaySegment()
    }
  },

  onResolutionPick(e) {
    if (this.data.processing) return
    const idx = Number(e && e.detail && e.detail.value)
    if (!Number.isFinite(idx)) return
    this.setData({ resolutionIndex: idx, outPath: '' })
  },

  onStartSliderChange(e) {
    if (this.data.processing) return
    const durationS = this.data.durationS || 0
    const clipLenS = this.data.clipLenS || 0
    const maxStartS = Math.max(0, Math.round((durationS - clipLenS) * 10) / 10)
    const s = Math.max(0, Math.min(maxStartS, Number(e && e.detail && e.detail.value) || 0))
    this.setData({ startS: Math.round(s * 10) / 10 })
    this.updateTexts()
  },

  onLenSliderChange(e) {
    if (this.data.processing) return
    const durationS = this.data.durationS || 0
    const v = Number(e && e.detail && e.detail.value)
    const maxLenS = Math.min(MAX_LIVE_DURATION_S, durationS || MAX_LIVE_DURATION_S)
    const len = Math.max(MIN_LIVE_DURATION_S, Math.min(maxLenS, Number.isFinite(v) ? v : MIN_LIVE_DURATION_S))
    let startS = this.data.startS || 0
    const maxStartS = Math.max(0, Math.round((durationS - len) * 10) / 10)
    if (startS > maxStartS) startS = maxStartS
    this.setData({
      clipLenS: Math.round(len * 10) / 10,
      startS: Math.round(startS * 10) / 10,
      maxStartS,
      maxLenS,
      outPath: '',
    })
    this.updateTexts()
  },

  onKeepAudioChange(e) {
    if (this.data.processing) return
    this.setData({ keepAudio: !!(e && e.detail && e.detail.value), outPath: '' })
  },

  onQualityChange(e) {
    if (this.data.processing) return
    this.setData({ qualityMode: (e && e.detail && e.detail.value) ? 'HIGH' : 'STANDARD', outPath: '' })
  },

  onPlaySegment() {
    if (!this.data.videoPath) return
    const ctx = this.ensureVideoCtx()
    const startS = this.data.startS || 0
    const endS = this.data.endS || 0

    this.clearSegmentTimer()

    if (this.data.segmentPlaying) {
      ctx.pause()
      this.setData({ segmentPlaying: false })
      return
    }

    ctx.seek(startS)
    setTimeout(() => ctx.play(), 60)
    const ms = Math.max(60, Math.round((endS - startS) * 1000))
    this._segmentStopTimer = setTimeout(() => {
      ctx.pause()
      this.setData({ segmentPlaying: false })
    }, ms)

    this.setData({ segmentPlaying: true, segmentEndS: endS })
  },

  async onConvert() {
    if (this.data.processing) return
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }

    const durationS = this.data.durationS || 0
    const startS = Number(this.data.startS || 0)
    const endS = Number(this.data.endS || 0)
    const clipLenS = endS - startS
    if (clipLenS < MIN_LIVE_DURATION_S - 1e-6) {
      wx.showToast({ title: '片段太短', icon: 'none' })
      return
    }
    if (clipLenS > MAX_LIVE_DURATION_S + 1e-6) {
      wx.showToast({ title: `最多截取${MAX_LIVE_DURATION_S}秒`, icon: 'none' })
      return
    }
    if (durationS > 0 && endS > durationS + 1e-6) {
      wx.showToast({ title: '截取范围不合法', icon: 'none' })
      return
    }

    const resolutionP = RESOLUTION_OPTIONS[this.data.resolutionIndex] || 720
    const keepAudio = !!this.data.keepAudio
    const qualityMode = this.data.qualityMode === 'STANDARD' ? 'STANDARD' : 'HIGH'

    this.setData({
      processing: true,
      progressText: '准备中',
      progressPercent: 0,
      primaryActionText: '生成中…',
    })

    wx.showLoading({ title: '处理中', mask: true })

    try {
      const result = await convertVideoToLive({
        videoPath: this.data.videoPath,
        startS,
        endS,
        resolutionP,
        keepAudio,
        qualityMode,
        onProgress: (p, text) => {
          const percent = Math.max(0, Math.min(100, Math.round(Number(p || 0))))
          this.setData({ progressPercent: percent, progressText: text || '' })
        },
      })

      this.setData({ 
        outPath: result.outPath || result.videoPath,
        imagePath: result.imagePath || null,
      })
      wx.showToast({ title: '已生成', icon: 'success' })
    } catch (e) {
      wx.showModal({
        title: '生成失败',
        content: e.message || '请稍后重试',
        showCancel: false,
      })
    } finally {
      wx.hideLoading()
      this.setData({
        processing: false,
        primaryActionText: '生成Live',
      })
    }
  },

  async onSave() {
    const filePath = this.data.outPath
    const imagePath = this.data.imagePath  // 如果有图片路径
    if (!filePath) return
    
    // 提示用户关于 Live Photo 的说明
    if (imagePath) {
      const res = await new Promise((resolve) => {
        wx.showModal({
          title: '保存 Live Photo',
          content: '微信小程序无法直接保存真正的 Live Photo。\n\n已生成图片和视频文件，它们已包含 Live Photo 元数据。\n\n在 iOS 设备上：\n1. 通过 AirDrop 传输两个文件到 iPhone\n2. 确保文件名匹配（如 IMG_1234.jpg 和 IMG_1234.mov）\n3. 使用 Live Photos 应用或快捷指令组合成 Live Photo\n\n是否继续保存到相册？',
          confirmText: '继续保存',
          cancelText: '取消',
          success: (r) => resolve(r.confirm),
          fail: () => resolve(false),
        })
      })
      if (!res) return
    }
    
    try {
      // 先保存图片（如果存在）
      if (imagePath) {
        try {
          await new Promise((resolve, reject) => {
            wx.saveImageToPhotosAlbum({
              filePath: imagePath,
              success: resolve,
              fail: reject,
            })
          })
        } catch (e) {
          console.warn('保存图片失败:', e)
        }
      }
      
      // 保存视频
      await new Promise((resolve, reject) => {
        if (typeof wx.saveVideoToPhotosAlbum !== 'function') {
          reject(new Error('当前微信版本不支持保存视频'))
          return
        }
        wx.saveVideoToPhotosAlbum({
          filePath,
          success: resolve,
          fail: reject,
        })
      })
      
      wx.showToast({ 
        title: imagePath ? '已保存（图片+视频）' : '已保存到相册', 
        icon: 'success',
        duration: 3000
      })
    } catch (e) {
      wx.showModal({
        title: '保存失败',
        content: '请检查相册权限后重试',
        showCancel: false,
      })
    }
  },
})

