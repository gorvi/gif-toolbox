const { MAX_CLIP_DURATION_S, DEFAULT_VIDEO_FPS, DEFAULT_VIDEO_RESOLUTION_P } = require('../../constants/config')
const { formatHms } = require('../../utils/time')
const { isVideoToGifSupported, convertVideoToGif } = require('../../services/video-to-gif')
const { getGifMeta } = require('../../services/gif-compress')

// 导入工具函数 / 模块
const { clamp, toFixed1, filterEmoji, formatHms1, formatClock, buildTicks, getDistance } = require('./utils')
const { createTimelineHandler, MIN_RANGE_S } = require('./timeline-handler')
const { createVideoController } = require('./video-control')
const { createTextEditor } = require('./text-editor')
const { createCropHandler } = require('./crop-handler')
const { createMainTimeline } = require('./main-timeline')

const RESOLUTION_OPTIONS = [160, 240, 320, 480, 600, 720]
const FPS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

function isCancelError(e) {
  const msg = String((e && (e.errMsg || e.message)) || '')
  return msg.includes('cancel') || msg.includes('fail cancel')
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function getFileSizeBytes(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve(0)
      return
    }
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    if (fs && typeof fs.statSync === 'function') {
      try {
        const stat = fs.statSync(filePath)
        resolve(Number(stat && stat.size) || 0)
        return
      } catch (e) {}
    }
    if (typeof wx.getFileInfo !== 'function') {
      resolve(0)
      return
    }
    wx.getFileInfo({
      filePath,
      success: (res) => resolve(Number(res && res.size) || 0),
      fail: () => resolve(0),
    })
  })
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
    videoWidth: 0,  // 视频原始宽度
    videoHeight: 0, // 视频原始高度
    mainVideoDisplayWpx: 0,
    mainVideoDisplayHpx: 0,
    mainVideoDisplayXpx: 0,
    mainVideoDisplayYpx: 0,
    letterboxTopPx: 0,
    letterboxBottomPx: 0,
    letterboxLeftPx: 0,
    letterboxRightPx: 0,
    showLetterboxOverlays: false,
    durationS: 0,
    startS: 0,
    endS: 0,
    windowStartS: 0,
    windowDurationS: 0,
    currentS: 0,
    ticks: [],

    // 片段播放状态
    segmentPlaying: false,
    segmentEndS: 0,
    videoPlaying: false,

    resolutionIndex: Math.max(0, RESOLUTION_OPTIONS.indexOf(DEFAULT_VIDEO_RESOLUTION_P)),
    fpsIndex: Math.max(0, FPS_OPTIONS.indexOf(DEFAULT_VIDEO_FPS)),
    resolutionLabels: RESOLUTION_OPTIONS.map((p) => `${p}p`),
    fpsLabels: FPS_OPTIONS.map((f) => `${f} FPS`),

    durationText: '00:00:00',
    currentText: '00:00:00/00:00:00',
    // 左下角时间 HUD（当前 / 总时长，支持 mm:ss.d 或 hh:mm:ss.d）
    clockText: '00:00.0 / 00:00.0',

    supportTip: '',
    processing: false,
    progressText: '',
    outPath: '',
    lastConvertSignature: '',
    showGifPreview: false,  // 是否显示GIF预览弹框
    gifMeta: null,
    gifMetaLoading: false,
    gifMetaError: '',
    showFullscreenPreview: false,  // 是否显示全屏预览

    // 文字编辑面板（改为首页直接编辑）
    textActiveTab: 'none',  // 'none'表示不显示编辑组件，其他值表示显示对应tab
    textInputFocus: false,
    textDragging: false,
    colorOptions: [
      '#FFFFFF',
      '#000000',
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFFF00',
      '#FF00FF',
      '#00FFFF',
      '#FF8800',
      '#880000',
      '#888888',
      '#FFB3C1',
      '#FFD6A5',
      '#FDFFB6',
      '#CAFFBF',
      '#9BF6FF',
      '#A0C4FF',
      '#BDB2FF',
      '#FFC6FF',
      '#BDE0FE',
      '#CDB4DB',
    ],
    
    // 裁剪面板
    cropConfig: {
      x: 0,              // 裁剪区域X位置（百分比 0-100）
      y: 0,              // 裁剪区域Y位置（百分比 0-100）
      width: 100,        // 裁剪区域宽度（百分比 0-100）
      height: 100,       // 裁剪区域高度（百分比 0-100）
      aspectRatio: 'none', // 裁剪比例：'none', 'free', '1:1', '4:3', '3:4', '16:9', '9:16'
    },
    cropPreviewConfig: null, // 主页预览用的裁剪配置（已转换为主页坐标系统）
    cropDragging: false,
    cropDragType: '',    // 'move', 'resize-tl', 'resize-tr', 'resize-bl', 'resize-br', 'resize-t', 'resize-b', 'resize-l', 'resize-r'
    cropAspectRatios: [
      { label: '不剪裁', value: 'none' },
      { label: '自由', value: 'free' },
      { label: '1:1', value: '1:1' },
      { label: '4:3', value: '4:3' },
      { label: '3:4', value: '3:4' },
      { label: '16:9', value: '16:9' },
      { label: '9:16', value: '9:16' },
    ],
    textConfig: {
      content: '',
      fontSizeNum: 32,         // 字号数值（12-72）
      color: '#FFFFFF',
      textOpacity: 0,          // 透明度 0=不透明, 100=全透明
      x: 50,                   // 文字位置X（百分比）
      y: 50,                   // 文字位置Y（百分比）
      strokeColor: '',         // 描边颜色，空表示无
      strokeWidth: 30,
      strokeOpacity: 0,        // 描边透明度 0=不透明
      shadowColor: '',         // 阴影颜色，空表示无
      shadowBlur: 30,
      shadowDistance: 30,
      shadowAngle: 45,         // 角度默认45度
      shadowOpacity: 0,        // 阴影透明度 0=不透明
      shadowX: 2,              // 计算后的阴影X偏移
      shadowY: 2,              // 计算后的阴影Y偏移
      _shadowStyle: '',        // 计算后的阴影CSS样式（主预览，缩小）
      _shadowStyleFull: '',    // 计算后的阴影CSS样式（弹窗，全尺寸）
      bgColor: '',             // 背景颜色，空表示无
      bgOpacity: 0,            // 背景透明度 0=不透明
      _bgStyle: '',            // 计算后的背景CSS样式
      animation: '',           // 动画类型：'', 'fade', 'slide', 'bounce', 'pulse', 'shake', 'zoom'
      animationSpeed: 1,       // 动画速度：0.5-2.0
      _animStyle: '',          // 动画速度样式（animation-duration）
    },
    animationOptions: [
      { label: '无', value: '' },
      { label: '淡入', value: 'fade' },
      { label: '滑入', value: 'slide' },
      { label: '弹跳', value: 'bounce' },
      { label: '脉冲', value: 'pulse' },
      { label: '摇晃', value: 'shake' },
      { label: '缩放', value: 'zoom' },
    ],
    textPreviewConfig: null, // 主页预览用的文字配置（已转换为主页坐标系统）

    keyboardHeightPx: 0,
    drawerHeightVh: 48,
    drawerHeightVhBeforeKeyboard: 48,
    drawerTopPx: 0,
  },

  onLoad(query) {
    const support = isVideoToGifSupported()
    if (!support.supported) {
      this.setData({ supportTip: support.reason })
    }
    this._videoCtx = null
    this._drag = { active: false }
    this._edgeTouch = { startX: 0, startY: 0, startTime: 0 }
    
    // 初始化模块
    this._timelineHandler = createTimelineHandler(this)
    this._videoController = createVideoController(this)
    this._textEditor = createTextEditor(this)
    this._cropHandler = createCropHandler(this)
    this._mainTimeline = createMainTimeline(this)
    // 主时间线是否跟随播放进度自动滚动
    this._mainTimelineFollow = true
    
    this.updateUiByRange()
    // 测试后端连接
    this.testBackendConnection()
    
    // 检查是否有从首页传递过来的视频
    const app = getApp()
    if (app.globalData && app.globalData.selectedVideoPath) {
      // 使用传递过来的视频
      const videoPath = app.globalData.selectedVideoPath
      const videoWidth = app.globalData.selectedVideoWidth || 0
      const videoHeight = app.globalData.selectedVideoHeight || 0
      const duration = app.globalData.selectedVideoDuration || 0
      
      // 清除全局数据
      app.globalData.selectedVideoPath = null
      app.globalData.selectedVideoWidth = null
      app.globalData.selectedVideoHeight = null
      app.globalData.selectedVideoDuration = null
      
      // 设置视频数据
      this.setVideoData(videoPath, videoWidth, videoHeight, duration)
      return
    }

    const autoChoose = query && (query.autoChoose === '1' || query.autoChoose === 1)
    if (autoChoose) {
      setTimeout(() => {
        if (!this.data.videoPath && !this.data.processing) {
          this.onChooseVideo()
        }
      }, 0)
    }
  },
  
  // 设置视频数据的公共方法
  setVideoData(videoPath, videoWidth, videoHeight, duration) {
    const durationS = toFixed1(duration || 0)
    const safeDurationS = Math.max(0, durationS)
    const startS = 0
    // 默认截取时长 5 秒（不足 5 秒则取整段），但不超过最大截取时长
    const defaultClip = 5
    const endS = Math.min(safeDurationS, defaultClip, MAX_CLIP_DURATION_S)
    const windowDurationS = Math.min(safeDurationS, MAX_CLIP_DURATION_S)
    const windowStartS = 0

    this.setData({
      videoPath,
      videoWidth,
      videoHeight,
      durationS: safeDurationS,
      startS,
      endS,
      windowStartS,
      windowDurationS,
      currentS: 0,
      segmentPlaying: false,
      ticks: buildTicks(windowStartS, windowDurationS),
    })
    
    // 更新UI
    this.updateUiByRange()
    // 初始化左下角时间 HUD
    this.updateClockText()

    // 同步主时间线截取高亮区域
    if (this._mainTimeline && this._mainTimeline.updateRangeFromPage) {
      this._mainTimeline.updateRangeFromPage()
    }

    // 初始化主时间线
    if (this._mainTimeline) {
      this._mainTimeline.init(safeDurationS)
    }
    
    // 延迟获取视频上下文，确保视频组件已渲染
    setTimeout(() => {
      this._videoCtx = wx.createVideoContext('videoPlayer', this)
      if (this._videoCtx) {
        // 跳转到开始位置
        this._videoCtx.seek(startS)
      }
    }, 100)
  },

  onReady() {
  },

  testBackendConnection() {
    const { request } = require('../../utils/request')
    const { API_BASE_URL } = require('../../constants/config')
    console.log('[后端连接测试] 尝试连接:', API_BASE_URL)
    console.log('[后端连接测试] 完整URL:', `${API_BASE_URL}/healthz`)
    
    // 先尝试 /healthz，如果不存在则尝试根路径
    request({ url: '/healthz' })
      .then((data) => {
        console.log('[后端连接] ✅ 正常', data)
      })
      .catch((err) => {
        console.error('[后端连接] /healthz 失败:', err.message)
        console.error('[后端连接] 错误详情:', err)
        
        // 显示详细的错误提示
        const tips = [
          `后端地址: ${API_BASE_URL}`,
          '请检查：',
          '1. 开发者工具 -> 设置 -> 项目设置 -> 勾选"不校验合法域名"',
          '2. 浏览器访问测试: ' + API_BASE_URL + '/healthz',
          '3. 确认后端服务正在运行',
        ]
        console.warn('[后端连接] 诊断信息:', tips.join('\n'))
        
        // 如果 /healthz 不存在，尝试根路径
        request({ url: '/' })
          .then(() => {
            console.log('[后端连接] ✅ 根路径可访问')
          })
          .catch((err2) => {
            console.error('[后端连接] ❌ 完全失败:', err2.message)
            // 不显示 toast，避免干扰用户
          })
      })
  },

  /**
   * 跳转到指定时间点
   */
  seekTo(second) {
    this._videoController.seekTo(second)
  },

  async onChooseVideo() {
    wx.showActionSheet({
      itemList: ['从相册选择', '聊天视频', '拍摄'],
      success: async (res) => {
        const tapIndex = Number(res && res.tapIndex)
        try {
          let picked = null
          if (tapIndex === 0) {
            picked = await chooseSingleVideoFromSource(['album'])
          } else if (tapIndex === 1) {
            const path = await chooseVideoFromChat()
            if (!path) return
            this.setVideoData(path, 0, 0, 0)
            return
          } else if (tapIndex === 2) {
            picked = await chooseSingleVideoFromSource(['camera'])
          }

          if (!picked) return
          this.setVideoData(picked.tempFilePath, picked.width || 0, picked.height || 0, picked.duration || 0)
        } catch (e) {
          if (isCancelError(e)) return
          wx.showToast({ title: '未选择视频', icon: 'none' })
        }
      },
      fail: (e) => {
        if (isCancelError(e)) return
      },
    })
  },

  // 视频时间更新（用于片段播放检测终点）
  onTimeUpdate(e) {
    const currentTime = e?.detail?.currentTime
    const currentS = toFixed1(Number(currentTime || 0))
    
    // 主时间线联动：仅在跟随模式下才自动滚动，避免用户手动拖动后“弹回去”
    if (this._mainTimelineFollow && this._mainTimeline && this._mainTimeline.onVideoTimeUpdate) {
      this._mainTimeline.onVideoTimeUpdate(currentS)
    }
    
    // 片段播放：到达终点时停止
    if (this.data.segmentPlaying) {
      const endS = this.data.segmentEndS || 0
      if (currentS >= endS - 0.1) {
        this.stopSegmentPlayback(endS)
        return
      }
    }

    const prevS = Number(this.data.currentS || 0)
    const now = Date.now()
    const dt = now - (this._lastTimeUiSyncTs || 0)
    if (Math.abs(prevS - currentS) < 0.05 && dt < 200) return

    const durationS = Number(this.data.durationS || 0)
    const clockText = `${formatClock(currentS, durationS)} / ${formatClock(durationS, durationS)}`
    const currentText = `${formatHms1(currentS)}/${formatHms1(durationS)}`

    this._lastTimeUiSyncTs = now
    this.setData({ currentS, clockText, currentText })
  },

  stopSegmentPlayback(endS) {
    const durationS = Number(this.data.durationS || 0)
    const t = toFixed1(Math.max(0, Number(endS || 0)))

    if (this._segmentStopTimer) {
      clearTimeout(this._segmentStopTimer)
      this._segmentStopTimer = null
    }

    if (this._videoCtx) {
      this._videoCtx.pause()
      this._videoCtx.seek(t)
    }

    if (this._mainTimelineFollow && this._mainTimeline && typeof this._mainTimeline.onVideoTimeUpdate === 'function') {
      this._mainTimeline.onVideoTimeUpdate(t)
    }

    const clockText = `${formatClock(t, durationS)} / ${formatClock(durationS, durationS)}`
    const currentText = `${formatHms1(t)}/${formatHms1(durationS)}`
    this.setData({ segmentPlaying: false, segmentEndS: 0, currentS: t, clockText, currentText })
  },

  onVideoPlay() {
    if (!this.data.videoPlaying) this.setData({ videoPlaying: true })
  },

  onVideoPause() {
    if (this.data.videoPlaying) this.setData({ videoPlaying: false })
  },

  onVideoEnded() {
    const durationS = Number(this.data.durationS || 0)
    const t = toFixed1(Math.max(0, durationS))

    if (typeof this._mainTimelineFollow !== 'undefined') {
      this._mainTimelineFollow = true
    }
    if (this._mainTimeline && typeof this._mainTimeline.resumeAutoFollow === 'function') {
      this._mainTimeline.resumeAutoFollow()
    }
    if (this._mainTimeline && typeof this._mainTimeline.onVideoTimeUpdate === 'function') {
      this._mainTimeline.onVideoTimeUpdate(t)
    }

    const clockText = `${formatClock(t, durationS)} / ${formatClock(durationS, durationS)}`
    const currentText = `${formatHms1(t)}/${formatHms1(durationS)}`

    this.setData({
      videoPlaying: false,
      segmentPlaying: false,
      segmentEndS: 0,
      currentS: t,
      clockText,
      currentText,
    })
    if (this._segmentStopTimer) {
      clearTimeout(this._segmentStopTimer)
      this._segmentStopTimer = null
    }
  },

  // 视频错误处理
  onVideoError(e) {
    console.error('[视频] 错误', e?.detail)
    wx.showToast({ title: '视频加载失败', icon: 'none' })
  },

  // 视频加载完成，获取视频尺寸 & 补充时长（兜底）
  onVideoLoaded(e) {
    // 如果 durationS 还是 0，尝试从事件中兜底获取一次时长
    const metaDuration = Number(e?.detail?.duration || 0)
    if (!this.data.durationS && metaDuration > 0) {
      const durationS = toFixed1(metaDuration)
      const safeDurationS = Math.max(0, durationS)
      const defaultClip = 5
      const endS = Math.min(safeDurationS, defaultClip, MAX_CLIP_DURATION_S)
      const windowDurationS = Math.min(safeDurationS, MAX_CLIP_DURATION_S)

      this.setData({
        durationS: safeDurationS,
        endS,
        windowDurationS,
        ticks: buildTicks(0, windowDurationS),
      })

      // 更新主时间线时长
      if (this._mainTimeline) {
        this._mainTimeline.updateDuration(safeDurationS)
      }
    }

    const metaWidth = Number(e?.detail?.width || 0)
    const metaHeight = Number(e?.detail?.height || 0)
    if ((!this.data.videoWidth || !this.data.videoHeight) && metaWidth > 0 && metaHeight > 0) {
      this.setData({
        videoWidth: this.data.videoWidth || metaWidth,
        videoHeight: this.data.videoHeight || metaHeight,
      }, () => {
        this.updateMainVideoRect()
        setTimeout(() => this.updateMainVideoRect(), 200)
      })
    } else {
      this.updateMainVideoRect()
      setTimeout(() => this.updateMainVideoRect(), 200)
    }
    // 首次加载时同步一次 HUD 时间
    this.updateClockText()
  },

  /**
   * 更新左下角时间 HUD（当前 / 总时长）
   */
  updateClockText() {
    const durationS = this.data.durationS || 0
    const currentS = this.data.currentS || 0
    const cur = formatClock(currentS, durationS)
    const total = formatClock(durationS, durationS)
    this.setData({
      clockText: `${cur} / ${total}`,
    })
  },

  // 播放全篇视频
  onToggleFullPlay() {
    this._videoController.toggleFull()
  },

  /**
   * 播放选中片段（startS -> endS）
   */
  onToggleSegmentPlay() {
    this._videoController.playSegment()
  },


  // ========== 文字编辑功能 ==========
  onClickTextTool() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }
    // 如果当前已经是文字编辑模式，切换tab；否则打开键盘tab
    const newTab = this.data.textActiveTab === 'none' || this.data.textActiveTab === 'crop' ? 'keyboard' : this.data.textActiveTab
    // 初始化文字位置（如果还没有设置）
    if (!this.data.textConfig.x && this.data.textConfig.x !== 0) {
      this.setData({
        'textConfig.x': 50,
      })
    }
    if (!this.data.textConfig.y && this.data.textConfig.y !== 0) {
      this.setData({
        'textConfig.y': 50,
      })
    }
    // 初始化阴影偏移量
    const { shadowDistance, shadowAngle } = this.data.textConfig
    const { shadowX, shadowY } = this._textEditor.calcShadowOffset(shadowDistance, shadowAngle)
    this.setData({ 
      textActiveTab: newTab,
      textInputFocus: newTab === 'keyboard',
      'textConfig.shadowX': shadowX,
      'textConfig.shadowY': shadowY,
    }, () => {
      this._textEditor.updateShadowStyle()
      this._textEditor.updateBgStyle()
    })
    // 延迟获取预览区域尺寸
    setTimeout(() => {
      this.updateMainVideoRect()
    }, 300)
  },

  // 关闭编辑组件（点击其他功能或空白区域时调用）
  onCloseEditComponent(eOrCb) {
    const cb = typeof eOrCb === 'function' ? eOrCb : null
    this.setData({ 
      textActiveTab: 'none',
      textInputFocus: false,
      textDragging: false,
    }, () => {
      if (typeof cb === 'function') cb()
    })
    if (this._textDrag) this._textDrag.active = false
    if (this._pinch) this._pinch.active = false
    // 更新主页预览配置
    setTimeout(() => {
      this.updateMainVideoRect()
      this.updateTextPreviewConfig()
      if (this.data.cropConfig && (this.data.cropConfig.x !== 0 || this.data.cropConfig.y !== 0 || this.data.cropConfig.width !== 100 || this.data.cropConfig.height !== 100)) {
        this.updateCropPreviewConfig()
      }
    }, 200)
  },

  onDrawerMaskTap() {
    this.onCloseEditComponent()
  },

  onTextInputFocus(e) {
    const keyboardHeight = Math.max(0, Number((e && e.detail && e.detail.height) || 0))
    const before = this.data.drawerHeightVh || 48
    const nextHeightVh = 22
    this.setData({
      keyboardHeightPx: keyboardHeight,
      drawerHeightVhBeforeKeyboard: before,
      drawerHeightVh: nextHeightVh,
    })
  },

  onTextInputBlur() {
    const restore = this.data.drawerHeightVhBeforeKeyboard || 48
    this.setData({
      keyboardHeightPx: 0,
      drawerHeightVh: restore,
    }, () => {
      this.updateMainVideoRect()
    })
  },

  onTextTabChange(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ 
      textActiveTab: tab,
      textInputFocus: tab === 'keyboard'
    })
  },
  
  onAnimationChange(e) {
    let animation = e.currentTarget.dataset.animation
    // 如果传递的是 'none'，表示空字符串
    if (animation === 'none') {
      animation = ''
    }
    console.log('[动画选择]', animation)
    this.setData({ 'textConfig.animation': animation || '' })
  },

  onAnimationSpeedChange(e) {
    const speed = Math.max(0.5, Math.min(2, Number(e.detail.value || 1)))
    const durationS = (2 / speed).toFixed(2)
    this.setData({ 
      'textConfig.animationSpeed': speed,
      'textConfig._animStyle': `animation-duration: ${durationS}s;`,
    }, () => {
      this.updateTextPreviewConfig()
    })
  },

  onTextInput(e) {
    // 过滤掉emoji字符
    const filteredValue = this._textEditor.filterEmoji(e.detail.value)
    this.setData({ 'textConfig.content': filteredValue })
    // 如果过滤掉了字符，提示用户
    if (filteredValue !== e.detail.value) {
      wx.showToast({ title: '已过滤表情符号', icon: 'none', duration: 1500 })
    }
  },

  onTextConfirm() {
    // 回车确认输入
  },

  onTextColorChange(e) {
    const color = e.currentTarget.dataset.color
    this.setData({ 'textConfig.color': color })
  },

  onTextOpacityChange(e) {
    this.setData({ 'textConfig.textOpacity': e.detail.value })
  },

  // 文字拖拽相关
  onTextDragStart(e) {
    const targetRole = e && e.target && e.target.dataset && e.target.dataset.role
    if (targetRole === 'delete') return

    const touches = e.touches
    
    if (touches.length >= 2) return
    
    // 单指拖动
    const touch = touches[0]
    
    // 先获取容器尺寸（同步获取，避免拖动时异步查询导致卡顿）
    const query = wx.createSelectorQuery().in(this)
    query.select('#mainVideoContainer').boundingClientRect()
    query.exec((res) => {
      if (res && res[0]) {
        const container = res[0]
        this._textDrag = {
          active: true,
          startX: touch.clientX,
          startY: touch.clientY,
          baseX: this.data.textConfig.x || 50,
          baseY: this.data.textConfig.y || 50,
          containerWidth: container.width,
          containerHeight: container.height,
        }
        this._pinch = { active: false }
        this.setData({ textDragging: true })
      } else {
        // 如果获取失败，使用默认值
        this._textDrag = {
          active: true,
          startX: touch.clientX,
          startY: touch.clientY,
          baseX: this.data.textConfig.x || 50,
          baseY: this.data.textConfig.y || 50,
        }
        this._pinch = { active: false }
        this.setData({ textDragging: true })
      }
    })
    
    // 获取主视频区域尺寸
    if (!this._mainVideoOffsetX) {
      this.updateMainVideoRect()
    }
  },

  onTextDragMove(e) {
    const touches = e.touches
    
    if (touches.length >= 2) return
    
    // 单指拖动
    if (!this._textDrag || !this._textDrag.active) return
    if (!this._textDrag.containerWidth || !this._textDrag.containerHeight) {
      // 如果容器尺寸还没获取到，等待一下
      return
    }

    const touch = touches[0]
    const deltaX = touch.clientX - this._textDrag.startX
    const deltaY = touch.clientY - this._textDrag.startY

    // 使用已保存的容器尺寸（避免每次拖动都异步查询）
    const containerWidth = this._textDrag.containerWidth
    const containerHeight = this._textDrag.containerHeight
    
    // 转换为相对于容器的百分比
    const deltaXPct = (deltaX / containerWidth) * 100
    const deltaYPct = (deltaY / containerHeight) * 100

    let newX = this._textDrag.baseX + deltaXPct
    let newY = this._textDrag.baseY + deltaYPct

    // 限制范围在视频实际显示区域内（考虑偏移）
    if (this._mainVideoOffsetX !== undefined && this._mainVideoOffsetX !== null) {
      const minX = this._mainVideoOffsetX
      const minY = this._mainVideoOffsetY
      const maxX = this._mainVideoOffsetX + this._mainVideoWidthPct
      const maxY = this._mainVideoOffsetY + this._mainVideoHeightPct
      
      newX = Math.max(minX + 2, Math.min(maxX - 2, newX))
      newY = Math.max(minY + 2, Math.min(maxY - 2, newY))
    } else {
      // 回退方案：限制范围 5% - 95%
      newX = Math.max(5, Math.min(95, newX))
      newY = Math.max(5, Math.min(95, newY))
    }

    this.setData({
      'textConfig.x': Math.round(newX * 10) / 10,
      'textConfig.y': Math.round(newY * 10) / 10,
    })
  },

  onTextDragEnd() {
    if (this._textDrag) {
      this._textDrag.active = false
    }
    if (this._pinch) {
      this._pinch.active = false
    }
    this.setData({ textDragging: false })
    // 拖动结束后更新主页预览配置
    this.updateTextPreviewConfig()
  },

  onTextGestureStart(e) {
    const touches = e && e.touches
    if (!touches || touches.length < 2) return
    if (this.data.textActiveTab === 'none' || this.data.textActiveTab === 'crop') return
    if (!this.data.textConfig || !this.data.textConfig.content) return
    if (this._pinch && this._pinch.active) return

    const dist = getDistance(touches[0], touches[1])
    this._pinch = {
      active: true,
      startDist: dist,
      baseFontSize: this.data.textConfig.fontSizeNum,
    }
    if (this._textDrag) this._textDrag.active = false
    this.setData({ textDragging: true })
  },

  onTextGestureMove(e) {
    const touches = e && e.touches
    if (!touches || touches.length < 2) return
    if (!this._pinch || !this._pinch.active) return

    const dist = getDistance(touches[0], touches[1])
    const scale = dist / this._pinch.startDist
    let newSize = Math.round(this._pinch.baseFontSize * scale)
    newSize = Math.max(12, Math.min(120, newSize))
    this.setData({ 'textConfig.fontSizeNum': newSize })
  },

  onTextGestureEnd() {
    if (this._pinch) this._pinch.active = false
    this.setData({ textDragging: false })
    this.updateTextPreviewConfig()
  },

  // 计算两点之间的距离（使用工具函数）
  getTouchDistance(touch1, touch2) {
    return getDistance(touch1, touch2)
  },

  onTextDelete() {
    this.setData({ 
      'textConfig.content': '',
      textActiveTab: 'none',
      textInputFocus: false,
      textDragging: false,
    }, () => {
      this.updateTextPreviewConfig()
    })
  },

  // 获取主视频预览区域尺寸（用于显示文字和裁剪预览）
  updateMainVideoRect(done) {
    const query = wx.createSelectorQuery().in(this)
    query.select('#mainVideoContainer').boundingClientRect()
    query.select('#videoPlayer').boundingClientRect()
    query.exec((res) => {
      if (res && res[0] && res[1]) {
        const container = res[0]
        const video = res[1]
        this._mainVideoContainerRect = container
        this._mainVideoRect = video

        const containerBottom = Number(container.bottom || (container.top + container.height) || 0)
        if (this.data.textActiveTab && this.data.textActiveTab !== 'none' && (this.data.keyboardHeightPx || 0) <= 0) {
          this.setData({ drawerTopPx: Math.max(0, Math.round(containerBottom)) })
        }
        
        // 计算视频在容器中的实际显示区域（考虑 object-fit: contain）
        if (this.data.videoWidth && this.data.videoHeight && container.width && container.height) {
          const videoAspect = this.data.videoWidth / this.data.videoHeight
          const containerAspect = container.width / container.height
          
          let displayWidth, displayHeight, displayX, displayY
          let letterboxTopPx = 0
          let letterboxBottomPx = 0
          let letterboxLeftPx = 0
          let letterboxRightPx = 0
          
          if (videoAspect > containerAspect) {
            // 视频更宽，以宽度为准
            displayWidth = container.width
            displayHeight = container.width / videoAspect
            displayX = 0
            displayY = (container.height - displayHeight) / 2
            letterboxTopPx = Math.max(0, Math.round(displayY))
            letterboxBottomPx = Math.max(0, Math.round(container.height - (displayY + displayHeight)))
          } else {
            // 视频更高，以高度为准
            displayWidth = container.height * videoAspect
            displayHeight = container.height
            displayX = (container.width - displayWidth) / 2
            displayY = 0
            letterboxLeftPx = Math.max(0, Math.round(displayX))
            letterboxRightPx = Math.max(0, Math.round(container.width - (displayX + displayWidth)))
          }

          const displayWpx = Math.max(1, Math.round(displayWidth))
          const displayHpx = Math.max(1, Math.round(displayHeight))
          const displayXpx = Math.max(0, Math.round(displayX))
          const displayYpx = Math.max(0, Math.round(displayY))
          const showLetterboxOverlays =
            letterboxTopPx > 0 || letterboxBottomPx > 0 || letterboxLeftPx > 0 || letterboxRightPx > 0
          const next = {}
          if (displayWpx !== (this.data.mainVideoDisplayWpx || 0)) next.mainVideoDisplayWpx = displayWpx
          if (displayHpx !== (this.data.mainVideoDisplayHpx || 0)) next.mainVideoDisplayHpx = displayHpx
          if (displayXpx !== (this.data.mainVideoDisplayXpx || 0)) next.mainVideoDisplayXpx = displayXpx
          if (displayYpx !== (this.data.mainVideoDisplayYpx || 0)) next.mainVideoDisplayYpx = displayYpx
          if (letterboxTopPx !== (this.data.letterboxTopPx || 0)) next.letterboxTopPx = letterboxTopPx
          if (letterboxBottomPx !== (this.data.letterboxBottomPx || 0)) next.letterboxBottomPx = letterboxBottomPx
          if (letterboxLeftPx !== (this.data.letterboxLeftPx || 0)) next.letterboxLeftPx = letterboxLeftPx
          if (letterboxRightPx !== (this.data.letterboxRightPx || 0)) next.letterboxRightPx = letterboxRightPx
          if (showLetterboxOverlays !== !!this.data.showLetterboxOverlays) next.showLetterboxOverlays = showLetterboxOverlays
          if (Object.keys(next).length) this.setData(next)
          
          this._mainVideoDisplayX = displayX
          this._mainVideoDisplayY = displayY
          // 保存为相对于容器的百分比
          this._mainVideoOffsetX = (displayX / container.width) * 100
          this._mainVideoOffsetY = (displayY / container.height) * 100
          this._mainVideoWidthPct = (displayWidth / container.width) * 100
          this._mainVideoHeightPct = (displayHeight / container.height) * 100
          
          // 保存实际像素尺寸，用于字号计算
          this._mainVideoDisplayWidth = displayWidth
          this._mainVideoDisplayHeight = displayHeight
          
          // 更新裁剪预览配置和文字预览配置
          this.updateCropPreviewConfig()
          this.updateTextPreviewConfig()
        }
      }
      if (typeof done === 'function') done()
    })
  },
  
  // 更新文字预览配置（首页直接编辑，预览与编辑同坐标系）
  updateTextPreviewConfig() {
    const text = this.data.textConfig
    if (!text || !text.content) {
      this.setData({ textPreviewConfig: null })
      return
    }

    this.setData({
      textPreviewConfig: {
        x: text.x,
        y: text.y,
        fontSize: text.fontSizeNum,
        content: text.content,
        color: text.color,
        textOpacity: text.textOpacity,
        strokeColor: text.strokeColor,
        strokeWidth: text.strokeWidth,
        _shadowStyle: text._shadowStyle,
        _bgStyle: text._bgStyle,
        _animStyle: text._animStyle,
      },
    })
  },
  
  // 更新裁剪预览配置（将裁剪页面的坐标转换为主页预览的坐标）
  updateCropPreviewConfig() {
    const crop = this.data.cropConfig
    if (!crop) {
      this.setData({ cropPreviewConfig: null })
      return
    }

    if (crop.aspectRatio === 'none') {
      this.setData({ cropPreviewConfig: null })
      return
    }
    
    const isEditing = this.data.textActiveTab === 'crop'
    const hasVideoArea = this._mainVideoOffsetX !== undefined && this._mainVideoOffsetX !== null

    if (hasVideoArea) {
      const full = {
        x: this._mainVideoOffsetX,
        y: this._mainVideoOffsetY,
        width: this._mainVideoWidthPct,
        height: this._mainVideoHeightPct,
      }
      const eps = 0.2
      const isFull =
        Math.abs((crop.x || 0) - full.x) < eps &&
        Math.abs((crop.y || 0) - full.y) < eps &&
        Math.abs((crop.width || 0) - full.width) < eps &&
        Math.abs((crop.height || 0) - full.height) < eps

      if (!isEditing && isFull) {
        this.setData({ cropPreviewConfig: null })
        return
      }
    }

    this.setData({
      cropPreviewConfig: {
        x: Math.max(0, Math.min(100, crop.x)),
        y: Math.max(0, Math.min(100, crop.y)),
        width: Math.max(0, Math.min(100, crop.width)),
        height: Math.max(0, Math.min(100, crop.height)),
        aspectRatio: crop.aspectRatio,
      },
    })
  },

  onFontSizeSliderChange(e) {
    this.setData({ 'textConfig.fontSizeNum': e.detail.value })
  },

  onStrokeColorChange(e) {
    const color = e.currentTarget.dataset.color
    this.setData({ 'textConfig.strokeColor': color })
  },

  onStrokeWidthChange(e) {
    this.setData({ 'textConfig.strokeWidth': e.detail.value })
  },

  onStrokeOpacityChange(e) {
    this.setData({ 'textConfig.strokeOpacity': e.detail.value })
  },

  onShadowColorChange(e) {
    const color = e.currentTarget.dataset.color
    this.setData({ 'textConfig.shadowColor': color }, () => {
      this.updateShadowStyle()
    })
  },

  onShadowBlurChange(e) {
    this.setData({ 'textConfig.shadowBlur': e.detail.value }, () => {
      this.updateShadowStyle()
    })
  },

  onShadowDistanceChange(e) {
    const distance = e.detail.value
    const { shadowAngle } = this.data.textConfig
    const { shadowX, shadowY } = this._textEditor.calcShadowOffset(distance, shadowAngle)
    this.setData({ 
      'textConfig.shadowDistance': distance,
      'textConfig.shadowX': shadowX,
      'textConfig.shadowY': shadowY,
    }, () => {
      this._textEditor.updateShadowStyle()
    })
  },

  onShadowAngleChange(e) {
    const angle = e.detail.value
    const { shadowDistance } = this.data.textConfig
    const { shadowX, shadowY } = this._textEditor.calcShadowOffset(shadowDistance, angle)
    this.setData({ 
      'textConfig.shadowAngle': angle,
      'textConfig.shadowX': shadowX,
      'textConfig.shadowY': shadowY,
    }, () => {
      this._textEditor.updateShadowStyle()
    })
  },

  onShadowOpacityChange(e) {
    this.setData({ 'textConfig.shadowOpacity': e.detail.value }, () => {
      this._textEditor.updateShadowStyle()
    })
  },

  // 计算阴影偏移量
  calcShadowOffset(distance, angle) {
    return this._textEditor.calcShadowOffset(distance, angle)
  },

  // 更新阴影CSS样式
  updateShadowStyle() {
    this._textEditor.updateShadowStyle()
  },

  // 更新背景CSS样式
  updateBgStyle() {
    this._textEditor.updateBgStyle()
  },

  // 将 hex 颜色转换为 rgba
  hexToRgba(hex, alpha) {
    return this._textEditor.hexToRgba(hex, alpha)
  },

  onBgColorChange(e) {
    const color = e.currentTarget.dataset.color
    this.setData({ 'textConfig.bgColor': color }, () => {
      this._textEditor.updateBgStyle()
    })
  },

  onBgOpacityChange(e) {
    this.setData({ 'textConfig.bgOpacity': e.detail.value }, () => {
      this._textEditor.updateBgStyle()
    })
  },

  onClickCropTool() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }
    // 切换到裁剪tab（首页直接编辑）
    const newTab = this.data.textActiveTab === 'crop' ? 'none' : 'crop'
    this.setData({ textActiveTab: newTab }, () => {
      if (newTab === 'crop') this.updateCropPreviewConfig()
    })
    if (newTab === 'crop') {
      setTimeout(() => this.updateMainVideoRect(), 300)
    }
  },

  // 全屏预览功能
  onFullscreenPreview() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }
    const wasPlaying = !!this.data.videoPlaying || !!this.data.segmentPlaying

    if (this._videoCtx) {
      this._videoCtx.pause()
    }
    if (this._segmentStopTimer) {
      clearTimeout(this._segmentStopTimer)
      this._segmentStopTimer = null
    }
    if (this.data.segmentPlaying) {
      this.setData({ segmentPlaying: false, segmentEndS: 0 })
    }

    this._fullscreenWasPlaying = wasPlaying
    this.setData({ showFullscreenPreview: true }, () => {
      wx.nextTick(() => {
        if (!this.data.showFullscreenPreview) return
        if (!this._fullscreenVideoCtx) {
          this._fullscreenVideoCtx = wx.createVideoContext('fullscreenVideoPlayer', this)
        }
        const t = toFixed1(Math.max(0, Number(this.data.currentS || 0)))
        if (this._fullscreenVideoCtx) {
          this._fullscreenVideoCtx.seek(t)
          if (this._fullscreenWasPlaying) {
            setTimeout(() => {
              this._fullscreenVideoCtx && this._fullscreenVideoCtx.play()
            }, 150)
          }
        }
      })
    })
  },

  onCloseFullscreenPreview() {
    if (this._fullscreenVideoCtx) {
      this._fullscreenVideoCtx.pause()
    }
    this._fullscreenWasPlaying = false
    this.setData({ showFullscreenPreview: false, videoPlaying: false })
  },

  // 确保裁剪框在边界内（基于视频的实际显示区域）
  ensureCropInBounds() {
    this._cropHandler.ensureCropInBounds()
  },

  // 选择裁剪比例
  onCropAspectRatioChange(e) {
    const ratio = e.currentTarget.dataset.ratio
    if (!this._mainVideoContainerRect || this._mainVideoOffsetX === undefined || this._mainVideoOffsetX === null) {
      this.updateMainVideoRect()
      setTimeout(() => this.onCropAspectRatioChange(e), 80)
      return
    }

    const container = this._mainVideoContainerRect
    const videoXpx = (this._mainVideoOffsetX / 100) * container.width
    const videoYpx = (this._mainVideoOffsetY / 100) * container.height
    const videoWpx = (this._mainVideoWidthPct / 100) * container.width
    const videoHpx = (this._mainVideoHeightPct / 100) * container.height

    const config = { ...this.data.cropConfig, aspectRatio: ratio }

    if (ratio === 'none') {
      config.x = 0
      config.y = 0
      config.width = 100
      config.height = 100
      this.setData({ cropConfig: config, cropPreviewConfig: null })
      return
    }

    if (ratio === 'free') {
      config.x = this._mainVideoOffsetX
      config.y = this._mainVideoOffsetY
      config.width = this._mainVideoWidthPct
      config.height = this._mainVideoHeightPct
    } else {
      const [w, h] = ratio.split(':').map(Number)
      const targetAspect = w / h
      const videoAspect = videoWpx / videoHpx

      let cropWpx, cropHpx
      if (videoAspect >= targetAspect) {
        cropHpx = videoHpx
        cropWpx = cropHpx * targetAspect
      } else {
        cropWpx = videoWpx
        cropHpx = cropWpx / targetAspect
      }

      const cropXpx = videoXpx + (videoWpx - cropWpx) / 2
      const cropYpx = videoYpx + (videoHpx - cropHpx) / 2

      config.x = (cropXpx / container.width) * 100
      config.y = (cropYpx / container.height) * 100
      config.width = (cropWpx / container.width) * 100
      config.height = (cropHpx / container.height) * 100
    }

    this.setData({ cropConfig: config }, () => {
      this.ensureCropInBounds()
      this.updateCropPreviewConfig()
    })
  },

  // 裁剪框拖动开始
  onCropDragStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const type = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || 'move'

    if (!this._mainVideoContainerRect) {
      this.updateMainVideoRect()
      return
    }

    this._cropDrag = {
      active: true,
      type,
      startX: touch.clientX,
      startY: touch.clientY,
      baseX: this.data.cropConfig.x,
      baseY: this.data.cropConfig.y,
      baseWidth: this.data.cropConfig.width,
      baseHeight: this.data.cropConfig.height,
      containerWidth: this._mainVideoContainerRect.width,
      containerHeight: this._mainVideoContainerRect.height,
    }
    this.setData({ cropDragging: true, cropDragType: type })
  },

  // 裁剪框拖动中（节流优化）
  onCropDragMove(e) {
    if (!this._cropDrag || !this._cropDrag.active) return

    const containerWidth = this._cropDrag.containerWidth || (this._mainVideoContainerRect && this._mainVideoContainerRect.width)
    const containerHeight = this._cropDrag.containerHeight || (this._mainVideoContainerRect && this._mainVideoContainerRect.height)
    if (!containerWidth || !containerHeight) return

    // 节流：每16ms更新一次（约60fps）
    const now = Date.now()
    if (this._cropDragLastUpdate && now - this._cropDragLastUpdate < 16) {
      return
    }
    this._cropDragLastUpdate = now

    const touch = e.touches && e.touches[0]
    if (!touch) return
    const deltaX = touch.clientX - this._cropDrag.startX
    const deltaY = touch.clientY - this._cropDrag.startY

    // 转换为百分比
    const deltaXPct = (deltaX / containerWidth) * 100
    const deltaYPct = (deltaY / containerHeight) * 100

    const { type, baseX, baseY, baseWidth, baseHeight } = this._cropDrag
    const { aspectRatio } = this.data.cropConfig
    const isFixedRatio = aspectRatio !== 'free'
    const [w, h] = aspectRatio !== 'free' ? aspectRatio.split(':').map(Number) : [1, 1]
    const ratio = w / h

    const baseRight = baseX + baseWidth
    const baseBottom = baseY + baseHeight
    const baseCenterX = baseX + baseWidth / 2
    const baseCenterY = baseY + baseHeight / 2

    let minX = 0, minY = 0, maxX = 100, maxY = 100
    if (this._mainVideoOffsetX !== undefined && this._mainVideoOffsetX !== null) {
      minX = this._mainVideoOffsetX
      minY = this._mainVideoOffsetY
      maxX = this._mainVideoOffsetX + this._mainVideoWidthPct
      maxY = this._mainVideoOffsetY + this._mainVideoHeightPct
    }

    const minSize = 10
    const wrapperAspect = containerHeight > 0 ? (containerWidth / containerHeight) : 1
    const ratioPct = isFixedRatio ? (ratio / wrapperAspect) : 0

    let newX = baseX
    let newY = baseY
    let newWidth = baseWidth
    let newHeight = baseHeight

    if (type === 'move') {
      newX = clamp(baseX + deltaXPct, minX, maxX - baseWidth)
      newY = clamp(baseY + deltaYPct, minY, maxY - baseHeight)
      newWidth = baseWidth
      newHeight = baseHeight
    } else if (type.startsWith('resize-')) {
      const hasL = type.includes('l')
      const hasR = type.includes('r')
      const hasT = type.includes('t')
      const hasB = type.includes('b')
      const isCorner = (hasL || hasR) && (hasT || hasB)

      if (!isFixedRatio) {
        let left = baseX
        let right = baseRight
        let top = baseY
        let bottom = baseBottom

        if (hasL) left = baseX + deltaXPct
        if (hasR) right = baseRight + deltaXPct
        if (hasT) top = baseY + deltaYPct
        if (hasB) bottom = baseBottom + deltaYPct

        left = clamp(left, minX, maxX - minSize)
        right = clamp(right, left + minSize, maxX)
        top = clamp(top, minY, maxY - minSize)
        bottom = clamp(bottom, top + minSize, maxY)

        newX = left
        newY = top
        newWidth = right - left
        newHeight = bottom - top
      } else {
        const safeRatioPct = ratioPct > 0 ? ratioPct : 1

        const applyMinFixedByWidth = (w0) => {
          let w1 = w0
          if (!Number.isFinite(w1)) w1 = 0
          w1 = Math.max(0, w1)
          let h1 = w1 / safeRatioPct
          if (w1 < minSize) {
            w1 = minSize
            h1 = w1 / safeRatioPct
          }
          if (h1 < minSize) {
            h1 = minSize
            w1 = h1 * safeRatioPct
          }
          return { w: w1, h: h1 }
        }

        const applyMinFixedByHeight = (h0) => {
          let h1 = h0
          if (!Number.isFinite(h1)) h1 = 0
          h1 = Math.max(0, h1)
          let w1 = h1 * safeRatioPct
          if (h1 < minSize) {
            h1 = minSize
            w1 = h1 * safeRatioPct
          }
          if (w1 < minSize) {
            w1 = minSize
            h1 = w1 / safeRatioPct
          }
          return { w: w1, h: h1 }
        }

        const maxHCentered = Math.max(0, 2 * Math.min(baseCenterY - minY, maxY - baseCenterY))
        const maxWCentered = Math.max(0, 2 * Math.min(baseCenterX - minX, maxX - baseCenterX))

        if (isCorner) {
          let ax = baseX
          let ay = baseY
          let wMax = 0
          if (hasL && hasT) {
            ax = baseRight
            ay = baseBottom
            wMax = Math.min(ax - minX, (ay - minY) * safeRatioPct)
          } else if (hasR && hasT) {
            ax = baseX
            ay = baseBottom
            wMax = Math.min(maxX - ax, (ay - minY) * safeRatioPct)
          } else if (hasL && hasB) {
            ax = baseRight
            ay = baseY
            wMax = Math.min(ax - minX, (maxY - ay) * safeRatioPct)
          } else if (hasR && hasB) {
            ax = baseX
            ay = baseY
            wMax = Math.min(maxX - ax, (maxY - ay) * safeRatioPct)
          }
          wMax = Math.max(0, wMax)

          const wFromX = hasL ? (baseWidth - deltaXPct) : (baseWidth + deltaXPct)
          const hFromY = hasT ? (baseHeight - deltaYPct) : (baseHeight + deltaYPct)
          const preferX = Math.abs(deltaX) >= Math.abs(deltaY)
          const size = preferX ? applyMinFixedByWidth(wFromX) : applyMinFixedByHeight(hFromY)
          const wNew = clamp(size.w, 0, wMax)
          const hNew = wNew / safeRatioPct
          newWidth = wNew
          newHeight = hNew

          if (hasL && hasT) {
            newX = ax - wNew
            newY = ay - hNew
          } else if (hasR && hasT) {
            newX = ax
            newY = ay - hNew
          } else if (hasL && hasB) {
            newX = ax - wNew
            newY = ay
          } else if (hasR && hasB) {
            newX = ax
            newY = ay
          }
        } else if (hasL || hasR) {
          const wFromX = hasL ? (baseWidth - deltaXPct) : (baseWidth + deltaXPct)
          const wMaxByX = hasL ? (baseRight - minX) : (maxX - baseX)
          const wMaxByH = maxHCentered * safeRatioPct
          const wMax = Math.max(0, Math.min(wMaxByX, wMaxByH))
          const size = applyMinFixedByWidth(wFromX)
          const wNew = clamp(size.w, 0, wMax)
          const hNew = wNew / safeRatioPct
          newWidth = wNew
          newHeight = hNew
          newX = hasL ? (baseRight - wNew) : baseX
          newY = baseCenterY - hNew / 2
        } else if (hasT || hasB) {
          const hFromY = hasT ? (baseHeight - deltaYPct) : (baseHeight + deltaYPct)
          const hMaxByY = hasT ? (baseBottom - minY) : (maxY - baseY)
          const hMaxByW = safeRatioPct > 0 ? (maxWCentered / safeRatioPct) : 0
          const hMax = Math.max(0, Math.min(hMaxByY, hMaxByW))
          const size = applyMinFixedByHeight(hFromY)
          const hNew = clamp(size.h, 0, hMax)
          const wNew = hNew * safeRatioPct
          newWidth = wNew
          newHeight = hNew
          newY = hasT ? (baseBottom - hNew) : baseY
          newX = baseCenterX - wNew / 2
        }

        newX = clamp(newX, minX, maxX - newWidth)
        newY = clamp(newY, minY, maxY - newHeight)
      }
    }

    this.setData({
      cropConfig: {
        ...this.data.cropConfig,
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
        width: Math.round(newWidth * 10) / 10,
        height: Math.round(newHeight * 10) / 10,
      },
      cropPreviewConfig: {
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
        width: Math.round(newWidth * 10) / 10,
        height: Math.round(newHeight * 10) / 10,
        aspectRatio: this.data.cropConfig.aspectRatio,
      },
    })
  },

  // 裁剪框拖动结束
  onCropDragEnd() {
    if (this._cropDrag) {
      this._cropDrag.active = false
    }
    this._cropDragLastUpdate = 0
    this.setData({ cropDragging: false, cropDragType: '' })
    this.ensureCropInBounds()
    this.updateCropPreviewConfig()
  },

  onStartChange(e) {
    const durationS = this.data.durationS || 0
    let startS = toFixed1(Number(e.detail.value || 0))
    startS = clamp(startS, 0, durationS)

    let endS = this.data.endS
    if (endS < startS) endS = startS
    if (endS - startS > MAX_CLIP_DURATION_S) endS = toFixed1(startS + MAX_CLIP_DURATION_S)
    endS = clamp(endS, 0, durationS)

    this.setData({ startS, endS })
    this.updateUiByRange()
  },

  onEndChange(e) {
    const durationS = this.data.durationS || 0
    let endS = toFixed1(Number(e.detail.value || 0))
    endS = clamp(endS, 0, durationS)

    let startS = this.data.startS
    if (startS > endS) startS = endS
    if (endS - startS > MAX_CLIP_DURATION_S) startS = toFixed1(endS - MAX_CLIP_DURATION_S)
    startS = clamp(startS, 0, durationS)

    this.setData({ startS, endS })
    this.updateUiByRange()

    // 同步主时间线截取高亮区域
    if (this._mainTimeline && this._mainTimeline.updateRangeFromPage) {
      this._mainTimeline.updateRangeFromPage()
    }
  },

  shiftRangeByDelta(deltaS) {
    return this._timelineHandler.shiftRangeByDelta(deltaS)
  },

  onScrubStart(e) {
    // 底部旧尺子已删除，此函数不再使用，保留空实现避免事件残留
  },

  onScrubMove(e) {
    // 底部旧尺子已删除，此函数不再使用，保留空实现避免事件残留
  },

  onScrubEnd() {
    // 底部旧尺子已删除，此函数不再使用，保留空实现避免事件残留
  },

  onResolutionPick(e) {
    this.setData({ resolutionIndex: Number(e.detail.value || 0) })
  },

  onFpsPick(e) {
    this.setData({ fpsIndex: Number(e.detail.value || 0) })
  },
  
  // 导出功能（就是转换功能）
  onExport() {
    if (this.data.processing) return
    const doExport = () => {
      const currentSignature = this.getCurrentConvertSignature()
      if (this.data.outPath && this.data.lastConvertSignature === currentSignature) {
        this.openGifPreview(this.data.outPath)
        return
      }
      this.onConvert()
    }

    if (this.data.textActiveTab && this.data.textActiveTab !== 'none') {
      wx.hideKeyboard()
      this.onCloseEditComponent(() => {
        setTimeout(doExport, 0)
      })
      return
    }

    doExport()
  },

  getCurrentConvertSignature() {
    const resolutionP = RESOLUTION_OPTIONS[this.data.resolutionIndex] || DEFAULT_VIDEO_RESOLUTION_P
    const fps = FPS_OPTIONS[this.data.fpsIndex] || DEFAULT_VIDEO_FPS
    const startS = toFixed1(Number(this.data.startS || 0))
    const endS = toFixed1(Number(this.data.endS || 0))

    const crop = this.data.cropConfig || {}
    const norm1 = (n) => Math.round(Number(n || 0) * 10) / 10
    const cropSig = {
      aspectRatio: crop.aspectRatio || 'none',
      x: norm1(crop.x),
      y: norm1(crop.y),
      width: norm1(crop.width),
      height: norm1(crop.height),
    }

    const tc = this.data.textConfig || {}
    const textSig = tc.content ? {
      content: tc.content,
      fontSizeNum: Number(tc.fontSizeNum || 0),
      color: tc.color || '',
      textOpacity: Number(tc.textOpacity || 0),
      x: norm1(tc.x),
      y: norm1(tc.y),
      strokeColor: tc.strokeColor || '',
      strokeWidth: Number(tc.strokeWidth || 0),
      strokeOpacity: Number(tc.strokeOpacity || 0),
      shadowColor: tc.shadowColor || '',
      shadowBlur: Number(tc.shadowBlur || 0),
      shadowDistance: Number(tc.shadowDistance || 0),
      shadowAngle: Number(tc.shadowAngle || 0),
      shadowOpacity: Number(tc.shadowOpacity || 0),
      bgColor: tc.bgColor || '',
      bgOpacity: Number(tc.bgOpacity || 0),
      animation: tc.animation || '',
      animationSpeed: Number(tc.animationSpeed || 0),
    } : null

    return JSON.stringify({
      videoPath: this.data.videoPath || '',
      startS,
      endS,
      resolutionP,
      fps,
      crop: cropSig,
      text: textSig,
    })
  },

  updateUiByRange() {
    const durationS = this.data.durationS || 0
    const startS = this.data.startS || 0
    const endS = this.data.endS || 0
    const currentS = this.data.currentS || 0
    const windowStartS = this.data.windowStartS || 0
    const windowDurationS = this.data.windowDurationS || Math.min(durationS, MAX_CLIP_DURATION_S)

    const leftPct = windowDurationS > 0 ? ((startS - windowStartS) / windowDurationS) * 100 : 0
    const widthPct = windowDurationS > 0 ? ((endS - startS) / windowDurationS) * 100 : 0
    const safeLeftPct = clamp(leftPct, 0, 100)
    const safeWidthPct = clamp(widthPct, 0, 100)
    const rightPct = clamp(safeLeftPct + safeWidthPct, 0, 100)

    this.setData({
      durationText: formatHms1(durationS),
      currentText: `${formatHms1(currentS)}/${formatHms1(durationS)}`,
      startText: formatHms1(startS),
      endText: formatHms1(endS),
      rangeLeftPct: safeLeftPct,
      rangeWidthPct: safeWidthPct,
      handleLeftPct: safeLeftPct,
      handleRightPct: rightPct,
    })
  },

  async onConvert() {
    const support = isVideoToGifSupported()
    if (!support.supported) {
      wx.showModal({
        title: '暂不支持',
        content: support.reason,
        showCancel: false,
      })
      return
    }

    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }

    const clipLen = (this.data.endS || 0) - (this.data.startS || 0)
    if (clipLen <= 0) {
      wx.showToast({ title: '截取范围不合法', icon: 'none' })
      return
    }
    if (clipLen > MAX_CLIP_DURATION_S) {
      wx.showToast({ title: `最多截取${MAX_CLIP_DURATION_S}秒`, icon: 'none' })
      return
    }

    const resolutionP = RESOLUTION_OPTIONS[this.data.resolutionIndex] || DEFAULT_VIDEO_RESOLUTION_P
    const fps = FPS_OPTIONS[this.data.fpsIndex] || DEFAULT_VIDEO_FPS
    const convertSignature = this.getCurrentConvertSignature()

    this.setData({ processing: true, progressText: '准备中…', outPath: '' })
    wx.showLoading({ title: '转换中…', mask: true })

    try {
      await new Promise((resolve) => this.updateMainVideoRect(resolve))
      // 构建文字配置（只有设置了内容时才传递，过滤掉内部字段）
      let textConfig = null
      let sourceTextConfig = null
      if (this.data.textConfig.content) {
        const tc = this.data.textConfig
        sourceTextConfig = tc

        textConfig = {
          content: tc.content,
          fontSizeNum: tc.fontSizeNum,
          color: tc.color,
          textOpacity: tc.textOpacity,
          x: tc.x,
          y: tc.y,
          strokeColor: tc.strokeColor,
          strokeWidth: tc.strokeWidth,
          strokeOpacity: tc.strokeOpacity,
          shadowColor: tc.shadowColor,
          shadowBlur: tc.shadowBlur,
          shadowDistance: tc.shadowDistance,
          shadowAngle: tc.shadowAngle,
          shadowOpacity: tc.shadowOpacity,
          bgColor: tc.bgColor,
          bgOpacity: tc.bgOpacity,
          animation: tc.animation || '', // 动画类型
          animationSpeed: tc.animationSpeed || 1,
        }
      }

      // 构建裁剪配置（如果设置了裁剪）
      let cropConfig = null
      const crop = this.data.cropConfig
      const hasVideoArea = this._mainVideoOffsetX !== undefined && this._mainVideoOffsetX !== null
      const hasCrop =
        crop &&
        (crop.x !== 0 || crop.y !== 0 || crop.width !== 100 || crop.height !== 100)

      if (hasCrop && hasVideoArea && this._mainVideoWidthPct > 0 && this._mainVideoHeightPct > 0) {
        const videoX = this._mainVideoOffsetX
        const videoY = this._mainVideoOffsetY
        const videoW = this._mainVideoWidthPct
        const videoH = this._mainVideoHeightPct

        const relativeX = (crop.x - videoX) / videoW
        const relativeY = (crop.y - videoY) / videoH
        const relativeWidth = crop.width / videoW
        const relativeHeight = crop.height / videoH
        const clamp01 = (n) => Math.max(0, Math.min(1, n))

        const nx = clamp01(relativeX)
        const ny = clamp01(relativeY)
        let nw = clamp01(relativeWidth)
        let nh = clamp01(relativeHeight)
        nw = Math.min(nw, 1 - nx)
        nh = Math.min(nh, 1 - ny)
        const exportCrop = { x: nx, y: ny, width: nw, height: nh }

        const minSize = 1e-4
        if (exportCrop.width < minSize || exportCrop.height < minSize) {
          cropConfig = null
        } else {
          const eps = 0.002
          const isFull =
            Math.abs(exportCrop.x - 0) < eps &&
            Math.abs(exportCrop.y - 0) < eps &&
            Math.abs(exportCrop.width - 1) < eps &&
            Math.abs(exportCrop.height - 1) < eps

          cropConfig = isFull ? null : exportCrop
        }
      } else if (hasCrop) {
        const clamp01 = (n) => Math.max(0, Math.min(1, n))
        const nx = clamp01(Number(crop.x || 0) / 100)
        const ny = clamp01(Number(crop.y || 0) / 100)
        let nw = clamp01(Number(crop.width || 0) / 100)
        let nh = clamp01(Number(crop.height || 0) / 100)
        nw = Math.min(nw, 1 - nx)
        nh = Math.min(nh, 1 - ny)
        const minSize = 1e-4
        cropConfig = nw < minSize || nh < minSize ? null : { x: nx, y: ny, width: nw, height: nh }
      }

      if (textConfig) {
        if (hasVideoArea && this._mainVideoWidthPct > 0 && this._mainVideoHeightPct > 0) {
          const videoX = this._mainVideoOffsetX
          const videoY = this._mainVideoOffsetY
          const videoW = this._mainVideoWidthPct
          const videoH = this._mainVideoHeightPct

          const textXVideo = Math.max(0, Math.min(100, ((textConfig.x - videoX) / videoW) * 100))
          const textYVideo = Math.max(0, Math.min(100, ((textConfig.y - videoY) / videoH) * 100))

          if (cropConfig && cropConfig.width > 0.001 && cropConfig.height > 0.001) {
            const clamp01 = (n) => Math.max(0, Math.min(1, n))
            const nx = clamp01((textXVideo / 100 - cropConfig.x) / cropConfig.width)
            const ny = clamp01((textYVideo / 100 - cropConfig.y) / cropConfig.height)
            textConfig.x = nx * 100
            textConfig.y = ny * 100
          } else {
            textConfig.x = textXVideo
            textConfig.y = textYVideo
          }

          if (sourceTextConfig && this._mainVideoDisplayWidth) {
            const normalizedCropW = cropConfig ? Math.max(0.001, Math.min(1, cropConfig.width)) : 1
            const displayWidthPx = this._mainVideoDisplayWidth * normalizedCropW
            const outputTextWidthPx = resolutionP * normalizedCropW
            if (displayWidthPx > 0 && outputTextWidthPx > 0) {
              const scaleFactor = outputTextWidthPx / displayWidthPx
              textConfig.fontSizeNum = Math.max(
                1,
                Math.round((sourceTextConfig.fontSizeNum * outputTextWidthPx) / displayWidthPx)
              )
              if (scaleFactor > 0 && Number.isFinite(scaleFactor)) {
                if (typeof sourceTextConfig.strokeWidth === 'number') {
                  textConfig.strokeWidth = Math.max(0, Math.round(sourceTextConfig.strokeWidth * scaleFactor))
                }
                if (typeof sourceTextConfig.shadowDistance === 'number') {
                  textConfig.shadowDistance = Math.max(0, Math.round(sourceTextConfig.shadowDistance * scaleFactor))
                }
                if (typeof sourceTextConfig.shadowBlur === 'number') {
                  textConfig.shadowBlur = Math.max(0, Math.round(sourceTextConfig.shadowBlur * scaleFactor))
                }
              }
            }
          }
        }
      }

      const { outPath } = await convertVideoToGif({
        videoPath: this.data.videoPath,
        startS: this.data.startS,
        endS: this.data.endS,
        resolutionP,
        fps,
        textConfig,
        cropConfig,
        onProgress: (progress, status) => {
          this.setData({ progressText: `${status} ${Math.round(progress)}%` })
        },
      })
      wx.hideLoading()
      this.setData({
        outPath,
        lastConvertSignature: convertSignature,
        processing: false,
        progressText: '',
      })
      await this.openGifPreview(outPath)
    } catch (e) {
      wx.hideLoading()
      this.setData({ processing: false, progressText: '' })
      wx.showModal({
        title: '转换失败',
        content: (e && e.message) ? e.message : '转换失败，请重试',
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

  // 关闭GIF预览弹框
  onCloseGifPreview() {
    this.setData({ showGifPreview: false })
  },

  noop() {},

  async openGifPreview(outPath) {
    if (!outPath) return
    this.setData({ showGifPreview: true, gifMetaLoading: true, gifMetaError: '', gifMeta: null })
    try {
      const [meta, sizeBytes] = await Promise.all([getGifMeta(outPath), getFileSizeBytes(outPath)])
      const durationS = Math.max(0, Number(meta && meta.durationCs) || 0) / 100
      const gifMeta = {
        resolution: `${meta.width}×${meta.height}`,
        frames: Number(meta.frames) || 0,
        duration: formatClock(durationS, durationS),
        size: formatBytes(sizeBytes),
        fps: (Number(meta.fps) || 0).toFixed(1),
      }
      this.setData({ gifMeta, gifMetaLoading: false })
    } catch (e) {
      this.setData({ gifMetaLoading: false, gifMetaError: '参数读取失败' })
    }
  },

  /**
   * 主时间线触摸事件封装到模块中
   */
  onMainTimelineTouchStart(e) {
    if (this._mainTimeline && this._mainTimeline.onTouchStart) {
      this._mainTimeline.onTouchStart(e)
    }
  },

  onMainTimelineTouchMove(e) {
    if (this._mainTimeline && this._mainTimeline.onTouchMove) {
      this._mainTimeline.onTouchMove(e)
    }
  },

  onMainTimelineTouchEnd() {
    if (this._mainTimeline && this._mainTimeline.onTouchEnd) {
      this._mainTimeline.onTouchEnd()
    }
  },

  // 主时间线上截取高亮区域整体平移截取范围
  onMainRangeTouchStart(e) {
    if (!this.data.videoPath || !(this.data.durationS > 0)) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._mainRangeDrag = {
      active: true,
      startX: touch.clientX,
      baseStartS: this.data.startS || 0,
      baseEndS: this.data.endS || 0,
    }
  },

  onMainRangeTouchMove(e) {
    if (!this._mainRangeDrag || !this._mainRangeDrag.active) return
    const touch = e.touches && e.touches[0]
    if (!touch) return

    const pps = (this.data.mainTimeline && this.data.mainTimeline.pixelsPerSecond) || 1
    const dx = touch.clientX - this._mainRangeDrag.startX
    const deltaS = toFixed1(dx / pps)

    const durationS = this.data.durationS || 0
    const baseStart = this._mainRangeDrag.baseStartS
    const baseEnd = this._mainRangeDrag.baseEndS
    const len = toFixed1(baseEnd - baseStart)

    let newStart = toFixed1(baseStart + deltaS)
    let newEnd = toFixed1(baseEnd + deltaS)

    if (newStart < 0) {
      newStart = 0
      newEnd = toFixed1(newStart + len)
    }
    if (newEnd > durationS) {
      newEnd = durationS
      newStart = toFixed1(newEnd - len)
    }

    const normalized = this._timelineHandler.normalizeRange(newStart, newEnd)
    this.setData({ startS: normalized.startS, endS: normalized.endS })
    this._timelineHandler.updateWindowByRange(normalized.startS, normalized.endS)
    this.updateUiByRange()

    // 同步主时间线截取高亮区域
    if (this._mainTimeline && this._mainTimeline.updateRangeFromPage) {
      this._mainTimeline.updateRangeFromPage()
    }
  },

  onMainRangeTouchEnd() {
    if (this._mainRangeDrag) {
      this._mainRangeDrag.active = false
    }
  },

  // 主时间线左右手柄：调整截取范围的起止时间
  onMainHandleTouchStart(e) {
    if (!this.data.videoPath || !(this.data.durationS > 0)) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const type = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || 'left'
    this._mainHandleDrag = {
      active: true,
      type,
      startX: touch.clientX,
      baseStartS: this.data.startS || 0,
      baseEndS: this.data.endS || 0,
      lastNormalized: null,
      lastLabelSyncTs: 0,
    }
    // 拖动时暂停视频、停止片段播放
    if (this._videoCtx) {
      this._videoCtx.pause()
    }
    if (this.data.segmentPlaying) {
      if (this._segmentStopTimer) {
        clearTimeout(this._segmentStopTimer)
        this._segmentStopTimer = null
      }
      this.setData({ segmentPlaying: false, segmentEndS: 0 })
    }
  },

  onMainHandleTouchMove(e) {
    if (!this._mainHandleDrag || !this._mainHandleDrag.active) return
    const touch = e.touches && e.touches[0]
    if (!touch) return

    const pps = (this.data.mainTimeline && this.data.mainTimeline.pixelsPerSecond) || 1
    const dx = touch.clientX - this._mainHandleDrag.startX
    const deltaS = toFixed1(dx / pps)

    const durationS = this.data.durationS || 0
    const baseStart = this._mainHandleDrag.baseStartS
    const baseEnd = this._mainHandleDrag.baseEndS
    let newStart = baseStart
    let newEnd = baseEnd

    if (this._mainHandleDrag.type === 'left') {
      newStart = toFixed1(baseStart + deltaS)
      // 左手柄拖动：右侧保持基准 end，交给 normalizeRange 做约束
    } else if (this._mainHandleDrag.type === 'right') {
      newEnd = toFixed1(baseEnd + deltaS)
      // 右手柄拖动：左侧保持基准 start
    }

    // 基本边界保证
    newStart = clamp(newStart, 0, durationS)
    newEnd = clamp(newEnd, 0, durationS)

    const normalized = this._timelineHandler.normalizeRange(newStart, newEnd)
    this._mainHandleDrag.lastNormalized = normalized

    if (this._mainTimeline && typeof this._mainTimeline.updateRange === 'function') {
      this._mainTimeline.updateRange(normalized.startS, normalized.endS)
    }

    const now = Date.now()
    const dt = now - (this._mainHandleDrag.lastLabelSyncTs || 0)
    if (dt >= 50) {
      this._mainHandleDrag.lastLabelSyncTs = now
      this.setData({
        startText: formatHms1(normalized.startS),
        endText: formatHms1(normalized.endS),
      })
    }
  },

  onMainHandleTouchEnd() {
    if (!this._mainHandleDrag) return
    this._mainHandleDrag.active = false

    const normalized = this._mainHandleDrag.lastNormalized
    if (!normalized) return

    this.setData({ startS: normalized.startS, endS: normalized.endS })
    this._timelineHandler.updateWindowByRange(normalized.startS, normalized.endS)
    this.updateUiByRange()

    if (this._mainTimeline && typeof this._mainTimeline.updateRange === 'function') {
      this._mainTimeline.updateRange(normalized.startS, normalized.endS)
    }
  },

  // 左侧边缘触摸拦截（防止华为手机系统返回手势误触）
  onEdgeTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (touch) {
      this._edgeTouch = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
      }
    }
  },

  onEdgeTouchMove(e) {
    // 阻止默认行为，防止系统返回手势
    const touch = e.touches && e.touches[0]
    if (touch && this._edgeTouch.startX !== undefined) {
      const deltaX = touch.clientX - this._edgeTouch.startX
      const deltaY = Math.abs(touch.clientY - this._edgeTouch.startY)
      
      // 如果是明显的向右滑动（返回手势），且垂直移动不大，则阻止
      if (deltaX > 10 && deltaY < 50) {
        // 阻止事件传播
        e.stopPropagation()
      }
    }
  },

  onEdgeTouchEnd(e) {
    // 重置触摸状态
    this._edgeTouch = { startX: 0, startY: 0, startTime: 0 }
  },
})
