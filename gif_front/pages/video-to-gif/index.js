const { MAX_CLIP_DURATION_S, DEFAULT_VIDEO_FPS, DEFAULT_VIDEO_RESOLUTION_P } = require('../../constants/config')
const { chooseSingleVideo } = require('../../utils/media')
const { formatHms } = require('../../utils/time')
const { isVideoToGifSupported, convertVideoToGif } = require('../../services/video-to-gif')

const RESOLUTION_OPTIONS = [160, 240, 320, 480, 600, 720]
const FPS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const MIN_RANGE_S = 0.1

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function toFixed1(n) {
  return Math.round(n * 10) / 10
}

// 过滤掉emoji字符
function filterEmoji(str) {
  if (!str) return str
  // 匹配常见emoji的Unicode范围（包括基本emoji、表情符号、符号等）
  // 使用更简洁的正则表达式覆盖主要emoji范围
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{200D}]|[\u{FE00}-\u{FE0F}]|[\u{203C}-\u{2049}]|[\u{2122}-\u{2139}]|[\u{2194}-\u{21AA}]|[\u{231A}-\u{23FA}]|[\u{24C2}]|[\u{25AA}-\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}-\u{3299}]/gu
  return str.replace(emojiRegex, '')
}

function pad2(n) {
  const s = String(Math.floor(Math.max(0, n)))
  return s.length >= 2 ? s : `0${s}`
}

function formatHms1(totalSeconds) {
  const t = Math.max(0, Number(totalSeconds || 0))
  const sec = Math.floor(t)
  const d = Math.floor((t - sec) * 10 + 1e-6)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${d}`
}

function formatMsLabel(totalSeconds) {
  const sec = Math.floor(Math.max(0, totalSeconds))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${pad2(m)}:${pad2(s)}`
}

/**
 * 生成刻度线（0.1 秒精度）
 * - 整数秒：big（最长刻度，显示标签）
 * - 0.5 秒：mid（中等长度）
 * - 其他 0.1 秒：small（最短）
 */
function buildTicks(windowStartS, windowDurationS) {
  const base = Math.max(0, Number(windowStartS || 0))
  const d = Math.max(0, Number(windowDurationS || 0))
  if (d <= 0) return []

  const ticks = []
  const stepS = 0.1 // 0.1 秒精度
  const maxT = Math.floor(d * 10) / 10 // 保持 0.1 精度

  for (let i = 0; i <= maxT * 10; i++) {
    const t = toFixed1(i * stepS)
    if (t > d) break

    // 判断刻度类型
    const isInteger = Math.abs(t - Math.round(t)) < 0.01
    const isHalf = Math.abs((t * 10) % 5) < 0.01 && !isInteger

    let kind = 'small'
    if (isInteger) {
      kind = 'big'
    } else if (isHalf) {
      kind = 'mid'
    }

    // 只在整数秒显示标签
    const showLabel = isInteger
    const absoluteTime = toFixed1(base + t)

    ticks.push({
      idx: i,
      kind,
      leftPct: (t / d) * 100,
      label: showLabel ? formatMsLabel(absoluteTime) : '',
    })
  }

  return ticks
}

Page({
  data: {
    videoPath: '',
    videoWidth: 0,  // 视频原始宽度
    videoHeight: 0, // 视频原始高度
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

    resolutionIndex: Math.max(0, RESOLUTION_OPTIONS.indexOf(DEFAULT_VIDEO_RESOLUTION_P)),
    fpsIndex: Math.max(0, FPS_OPTIONS.indexOf(DEFAULT_VIDEO_FPS)),
    resolutionLabels: RESOLUTION_OPTIONS.map((p) => `${p}p`),
    fpsLabels: FPS_OPTIONS.map((f) => `${f} FPS`),

    durationText: '00:00:00',
    currentText: '00:00:00/00:00:00',
    startText: '00:00:00',
    endText: '00:00:00',
    rangeLeftPct: 0,
    rangeWidthPct: 0,
    handleLeftPct: 0,
    handleRightPct: 0,
    timelineDragging: false,
    dragActiveType: '',

    supportTip: '',
    processing: false,
    progressText: '',
    outPath: '',

    // 文字编辑面板
    showTextPanel: false,
    textActiveTab: 'keyboard',
    textInputFocus: false,
    textDragging: false,
    colorOptions: ['#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FF8800', '#880000', '#888888'],
    
    // 裁剪面板
    showCropPanel: false,
    cropConfig: {
      x: 0,              // 裁剪区域X位置（百分比 0-100）
      y: 0,              // 裁剪区域Y位置（百分比 0-100）
      width: 100,        // 裁剪区域宽度（百分比 0-100）
      height: 100,       // 裁剪区域高度（百分比 0-100）
      aspectRatio: 'free', // 裁剪比例：'free', '1:1', '4:3', '3:4', '16:9', '9:16'
    },
    cropPreviewConfig: null, // 主页预览用的裁剪配置（已转换为主页坐标系统）
    cropDragging: false,
    cropDragType: '',    // 'move', 'resize-tl', 'resize-tr', 'resize-bl', 'resize-br', 'resize-t', 'resize-b', 'resize-l', 'resize-r'
    cropAspectRatios: [
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
    },
    textPreviewConfig: null, // 主页预览用的文字配置（已转换为主页坐标系统）
  },

  onLoad() {
    const support = isVideoToGifSupported()
    if (!support.supported) {
      this.setData({ supportTip: support.reason })
    }
    this._videoCtx = null
    this._rulerWidthPx = 0
    this._drag = { active: false }
    this.updateUiByRange()
    // 测试后端连接
    this.testBackendConnection()
  },

  onReady() {
    this.refreshRulerRect()
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
        wx.showToast({
          title: '后端连接正常',
          icon: 'success',
          duration: 2000,
        })
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

  refreshRulerRect() {
    const q = wx.createSelectorQuery().in(this)
    q.select('.ruler-inner').boundingClientRect()
    q.exec((res) => {
      const rect = res && res[0]
      if (rect && rect.width) {
        this._rulerWidthPx = rect.width
      }
    })
  },

  /**
   * 跳转到指定时间点
   */
  seekTo(second) {
    if (!this.data.videoPath) return
    if (!this._videoCtx) this._videoCtx = wx.createVideoContext('videoPlayer', this)
    
    const t = toFixed1(Math.max(0, Number(second || 0)))
    this.setData({ currentS: t })
    this._videoCtx.seek(t)
  },

  async onChooseVideo() {
    try {
      const res = await chooseSingleVideo()
      const durationS = toFixed1(res.duration || 0)
      const safeDurationS = Math.max(0, durationS)
      const startS = 0
      const endS = Math.min(safeDurationS, MAX_CLIP_DURATION_S)
      const windowDurationS = Math.min(safeDurationS, MAX_CLIP_DURATION_S)
      const windowStartS = 0

      this.setData({
        videoPath: res.tempFilePath,
        videoWidth: res.width || 0,
        videoHeight: res.height || 0,
        durationS: safeDurationS,
        startS,
        endS,
        windowStartS,
        windowDurationS,
        currentS: 0,
        segmentPlaying: false,
        ticks: buildTicks(windowStartS, windowDurationS),
      })
      this.updateUiByRange()
      
      // 获取视频上下文
      setTimeout(() => {
        this._videoCtx = wx.createVideoContext('videoPlayer', this)
        this.refreshRulerRect()
      }, 100)
    } catch (e) {
      wx.showToast({ title: '未选择视频', icon: 'none' })
    }
  },

  // 视频时间更新（用于片段播放检测终点）
  onTimeUpdate(e) {
    const currentTime = e?.detail?.currentTime
    const currentS = toFixed1(Number(currentTime || 0))
    
    // 更新时间显示
    if (Math.abs((this.data.currentS || 0) - currentS) >= 0.1) {
      this.setData({ currentS })
      this.updateUiByRange()
    }
    
    // 片段播放：到达终点时停止
    if (this.data.segmentPlaying) {
      const endS = this.data.segmentEndS || 0
      if (currentS >= endS - 0.1) {
        console.log('[片段播放] 到达终点', currentS, '>=', endS)
        if (this._videoCtx) this._videoCtx.pause()
        this.setData({ segmentPlaying: false })
      }
    }
  },

  // 视频错误处理
  onVideoError(e) {
    console.error('[视频] 错误', e?.detail)
    wx.showToast({ title: '视频加载失败', icon: 'none' })
  },

  // 视频加载完成，获取视频尺寸
  onVideoLoaded() {
    this.updateMainVideoRect()
    // 如果已有裁剪配置或文字配置，更新预览
    const hasCrop = this.data.cropConfig && (this.data.cropConfig.x !== 0 || this.data.cropConfig.y !== 0 || 
        this.data.cropConfig.width !== 100 || this.data.cropConfig.height !== 100)
    const hasText = this.data.textConfig && this.data.textConfig.content
    if (hasCrop || hasText) {
      setTimeout(() => {
        this.updateMainVideoRect()
      }, 200)
    }
  },

  // 播放全篇视频
  onToggleFullPlay() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }
    
    // 停止片段播放状态
    if (this.data.segmentPlaying) {
      this.setData({ segmentPlaying: false })
    }
    
    if (!this._videoCtx) this._videoCtx = wx.createVideoContext('videoPlayer', this)
    this._videoCtx.play()
  },

  /**
   * 播放选中片段（startS -> endS）
   * 方案：seek 到 startS，播放，在 timeupdate 中检测到达 endS 时暂停
   */
  onToggleSegmentPlay() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }

    const startS = this.data.startS || 0
    const endS = this.data.endS || 0
    if (endS - startS < MIN_RANGE_S) {
      wx.showToast({ title: '截取范围过短', icon: 'none' })
      return
    }

    // 如果正在播放片段，停止
    if (this.data.segmentPlaying) {
      if (this._videoCtx) this._videoCtx.pause()
      this.setData({ segmentPlaying: false })
      return
    }

    console.log('[片段播放] 准备播放', startS, '->', endS)

    if (!this._videoCtx) this._videoCtx = wx.createVideoContext('videoPlayer', this)

    // 设置片段播放状态
    this.setData({
      segmentPlaying: true,
      segmentEndS: endS,
      currentS: startS,
    })

    // seek 到起点，然后播放
    this._videoCtx.seek(startS)
    setTimeout(() => {
      if (this._videoCtx && this.data.segmentPlaying) {
        this._videoCtx.play()
      }
    }, 200)
  },


  // ========== 文字编辑功能 ==========
  onClickTextTool() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }
    // 初始化阴影偏移量
    const { shadowDistance, shadowAngle } = this.data.textConfig
    const { shadowX, shadowY } = this.calcShadowOffset(shadowDistance, shadowAngle)
    this.setData({ 
      showTextPanel: true,
      textActiveTab: 'keyboard',
      textInputFocus: true,
      'textConfig.shadowX': shadowX,
      'textConfig.shadowY': shadowY,
    }, () => {
      this.updateShadowStyle()
      this.updateBgStyle()
    })
    // 延迟获取预览区域尺寸
    setTimeout(() => {
      this.getTextPreviewRect()
    }, 300)
  },

  onTextPanelClose() {
    this.setData({ showTextPanel: false, textInputFocus: false })
    // 更新主页预览配置
    setTimeout(() => {
      this.updateMainVideoRect()
      // 确保文字预览配置也被更新
      if (this.data.textConfig && this.data.textConfig.content) {
        this.updateTextPreviewConfig()
      }
    }, 200)
  },

  onTextDone() {
    this.setData({ showTextPanel: false, textInputFocus: false })
    if (this.data.textConfig.content) {
      wx.showToast({ title: '文字已添加', icon: 'success' })
    }
    // 更新主页预览配置
    setTimeout(() => {
      this.updateMainVideoRect()
      // 确保文字预览配置也被更新
      if (this.data.textConfig && this.data.textConfig.content) {
        this.updateTextPreviewConfig()
      }
    }, 200)
  },

  onTextTabChange(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ 
      textActiveTab: tab,
      textInputFocus: tab === 'keyboard'
    })
  },

  onTextInput(e) {
    // 过滤掉emoji字符
    const filteredValue = filterEmoji(e.detail.value)
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
    const touches = e.touches
    
    // 双指捏合：记录初始距离和字号
    if (touches.length >= 2) {
      const dist = this.getTouchDistance(touches[0], touches[1])
      this._pinch = {
        active: true,
        startDist: dist,
        baseFontSize: this.data.textConfig.fontSizeNum,
      }
      this._textDrag = { active: false }
      this.setData({ textDragging: true })
      return
    }
    
    // 单指拖动
    const touch = touches[0]
    
    // 先获取容器尺寸（同步获取，避免拖动时异步查询导致卡顿）
    const query = wx.createSelectorQuery().in(this)
    query.select('#textVideoArea').boundingClientRect()
    query.exec((res) => {
      if (res && res[0]) {
        const container = res[0]
        this._textDrag = {
          active: true,
          startX: touch.clientX,
          startY: touch.clientY,
          baseX: this.data.textConfig.x,
          baseY: this.data.textConfig.y,
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
          baseX: this.data.textConfig.x,
          baseY: this.data.textConfig.y,
        }
        this._pinch = { active: false }
        this.setData({ textDragging: true })
      }
    })
    
    // 获取预览区域尺寸
    if (!this._textPreviewRect) {
      this.getTextPreviewRect()
    }
  },

  onTextDragMove(e) {
    const touches = e.touches
    
    // 双指捏合：缩放字号
    if (touches.length >= 2 && this._pinch && this._pinch.active) {
      const dist = this.getTouchDistance(touches[0], touches[1])
      const scale = dist / this._pinch.startDist
      let newSize = Math.round(this._pinch.baseFontSize * scale)
      // 限制字号范围 12-120
      newSize = Math.max(12, Math.min(120, newSize))
      this.setData({ 'textConfig.fontSizeNum': newSize })
      return
    }
    
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
    if (this._textVideoOffsetX !== undefined && this._textVideoOffsetX !== null) {
      const minX = this._textVideoOffsetX
      const minY = this._textVideoOffsetY
      const maxX = this._textVideoOffsetX + this._textVideoWidthPct
      const maxY = this._textVideoOffsetY + this._textVideoHeightPct
      
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

  // 计算两点之间的距离
  getTouchDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX
    const dy = touch1.clientY - touch2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  },

  onTextDelete() {
    this.setData({ 'textConfig.content': '' })
  },

  getTextPreviewRect() {
    const query = wx.createSelectorQuery().in(this)
    // 获取编辑面板中容器和视频元素的尺寸
    query.select('#textVideoArea').boundingClientRect()
    query.select('#textVideoPlayer').boundingClientRect()
    query.exec((res) => {
      if (res && res[0] && res[1]) {
        const container = res[0]
        const video = res[1]
        this._textPreviewRect = video
        
        // 计算视频在容器中的实际显示区域（考虑 object-fit: contain）
        if (this.data.videoWidth && this.data.videoHeight && container.width && container.height) {
          const videoAspect = this.data.videoWidth / this.data.videoHeight
          const containerAspect = container.width / container.height
          
          let displayWidth, displayHeight, displayX, displayY
          
          if (videoAspect > containerAspect) {
            // 视频更宽，以宽度为准
            displayWidth = container.width
            displayHeight = container.width / videoAspect
            displayX = 0
            displayY = (container.height - displayHeight) / 2
          } else {
            // 视频更高，以高度为准
            displayWidth = container.height * videoAspect
            displayHeight = container.height
            displayX = (container.width - displayWidth) / 2
            displayY = 0
          }
          
          // 保存为相对于容器的百分比
          this._textVideoOffsetX = (displayX / container.width) * 100
          this._textVideoOffsetY = (displayY / container.height) * 100
          this._textVideoWidthPct = (displayWidth / container.width) * 100
          this._textVideoHeightPct = (displayHeight / container.height) * 100
          
          // 保存实际像素尺寸，用于字号计算
          this._textVideoDisplayWidth = displayWidth
          this._textVideoDisplayHeight = displayHeight
        }
        
        // 同时保存主视频的尺寸，用于位置转换
        this._mainVideoRect = null
        this.updateMainVideoRect()
      }
    })
  },

  // 获取主视频预览区域尺寸（用于显示文字和裁剪预览）
  updateMainVideoRect() {
    const query = wx.createSelectorQuery().in(this)
    query.select('#mainVideoContainer').boundingClientRect()
    query.select('#videoPlayer').boundingClientRect()
    query.exec((res) => {
      if (res && res[0] && res[1]) {
        const container = res[0]
        const video = res[1]
        this._mainVideoRect = video
        
        // 计算视频在容器中的实际显示区域（考虑 object-fit: contain）
        if (this.data.videoWidth && this.data.videoHeight && container.width && container.height) {
          const videoAspect = this.data.videoWidth / this.data.videoHeight
          const containerAspect = container.width / container.height
          
          let displayWidth, displayHeight, displayX, displayY
          
          if (videoAspect > containerAspect) {
            // 视频更宽，以宽度为准
            displayWidth = container.width
            displayHeight = container.width / videoAspect
            displayX = 0
            displayY = (container.height - displayHeight) / 2
          } else {
            // 视频更高，以高度为准
            displayWidth = container.height * videoAspect
            displayHeight = container.height
            displayX = (container.width - displayWidth) / 2
            displayY = 0
          }
          
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
    })
  },
  
  // 更新文字预览配置（将编辑页面的坐标转换为主页预览的坐标）
  updateTextPreviewConfig() {
    const text = this.data.textConfig
    if (!text || !text.content) {
      this.setData({ textPreviewConfig: null })
      return
    }
    
    // 如果编辑页面和主页的视频显示区域都已计算
    if (this._textVideoOffsetX !== undefined && this._textVideoOffsetX !== null &&
        this._mainVideoOffsetX !== undefined && this._mainVideoOffsetX !== null) {
      
      // 编辑页面的 textConfig.x/y 是相对于 textVideoArea 的百分比
      // 需要先转换为相对于视频实际显示区域的百分比
      const textVideoX = this._textVideoOffsetX
      const textVideoY = this._textVideoOffsetY
      const textVideoWidth = this._textVideoWidthPct
      const textVideoHeight = this._textVideoHeightPct
      
      // 文字在视频实际显示区域内的相对位置（0-100%）
      const relativeX = ((text.x - textVideoX) / textVideoWidth) * 100
      const relativeY = ((text.y - textVideoY) / textVideoHeight) * 100
      
      // 再转换为相对于主页视频容器的百分比
      const mainVideoX = this._mainVideoOffsetX
      const mainVideoY = this._mainVideoOffsetY
      const mainVideoWidth = this._mainVideoWidthPct
      const mainVideoHeight = this._mainVideoHeightPct
      
      const previewX = mainVideoX + (relativeX / 100) * mainVideoWidth
      const previewY = mainVideoY + (relativeY / 100) * mainVideoHeight
      
      // 计算字号比例（基于实际像素尺寸）
      // 字号应该与视频显示区域的宽度或高度成比例，使用宽度作为基准更合理
      let fontSizeScale = 1
      if (this._textVideoDisplayWidth && this._mainVideoDisplayWidth) {
        // 使用宽度作为基准，因为文字通常是水平排列的
        fontSizeScale = this._mainVideoDisplayWidth / this._textVideoDisplayWidth
      } else if (this._textVideoDisplayHeight && this._mainVideoDisplayHeight) {
        // 如果没有宽度，使用高度作为基准
        fontSizeScale = this._mainVideoDisplayHeight / this._textVideoDisplayHeight
      }
      
      // 主页预览区域比编辑页面小，所以字号需要按比例缩小
      // 但不需要额外的 0.5 系数，因为比例已经通过 fontSizeScale 计算了
      const finalFontSize = text.fontSizeNum * fontSizeScale
      
      this.setData({
        textPreviewConfig: {
          x: Math.max(0, Math.min(100, previewX)),
          y: Math.max(0, Math.min(100, previewY)),
          fontSize: finalFontSize,
          content: text.content,
          color: text.color,
          textOpacity: text.textOpacity,
          strokeColor: text.strokeColor,
          strokeWidth: text.strokeWidth,
          _shadowStyle: text._shadowStyle,
          _bgStyle: text._bgStyle,
        }
      })
      
      console.log('[文字预览]', {
        textX: text.x, textY: text.y,
        textVideoX, textVideoY, textVideoWidth, textVideoHeight,
        relativeX, relativeY,
        mainVideoX, mainVideoY, mainVideoWidth, mainVideoHeight,
        previewX, previewY,
        textVideoDisplayWidth: this._textVideoDisplayWidth,
        mainVideoDisplayWidth: this._mainVideoDisplayWidth,
        fontSizeScale,
        originalFontSize: text.fontSizeNum,
        finalFontSize
      })
    } else {
      // 如果还没有计算，直接使用原始值（可能不准确，但至少能显示）
      // 尝试使用容器尺寸的比例来估算
      let fallbackScale = 1
      if (this._textPreviewRect && this._mainVideoRect) {
        // 使用容器尺寸的比例作为估算
        const textContainerWidth = this._textPreviewRect.width || 0
        const mainContainerWidth = this._mainVideoRect.width || 0
        if (textContainerWidth > 0 && mainContainerWidth > 0) {
          fallbackScale = mainContainerWidth / textContainerWidth
        }
      }
      
      this.setData({
        textPreviewConfig: {
          x: text.x,
          y: text.y,
          fontSize: text.fontSizeNum * fallbackScale,
          content: text.content,
          color: text.color,
          textOpacity: text.textOpacity,
          strokeColor: text.strokeColor,
          strokeWidth: text.strokeWidth,
          _shadowStyle: text._shadowStyle,
          _bgStyle: text._bgStyle,
        }
      })
    }
  },
  
  // 更新裁剪预览配置（将裁剪页面的坐标转换为主页预览的坐标）
  updateCropPreviewConfig() {
    const crop = this.data.cropConfig
    if (!crop || (crop.x === 0 && crop.y === 0 && crop.width === 100 && crop.height === 100)) {
      this.setData({ cropPreviewConfig: null })
      return
    }
    
    // 如果裁剪页面和主页的视频显示区域都已计算
    if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null &&
        this._mainVideoOffsetX !== undefined && this._mainVideoOffsetX !== null) {
      
      // 裁剪页面的 cropConfig 是相对于 crop-video-wrapper 的百分比
      // 需要先转换为相对于视频实际显示区域的百分比
      const cropVideoX = this._cropVideoOffsetX
      const cropVideoY = this._cropVideoOffsetY
      const cropVideoWidth = this._cropVideoWidthPct
      const cropVideoHeight = this._cropVideoHeightPct
      
      // 裁剪框在视频实际显示区域内的相对位置（0-100%）
      const relativeX = ((crop.x - cropVideoX) / cropVideoWidth) * 100
      const relativeY = ((crop.y - cropVideoY) / cropVideoHeight) * 100
      const relativeWidth = (crop.width / cropVideoWidth) * 100
      const relativeHeight = (crop.height / cropVideoHeight) * 100
      
      // 再转换为相对于主页视频容器的百分比
      const mainVideoX = this._mainVideoOffsetX
      const mainVideoY = this._mainVideoOffsetY
      const mainVideoWidth = this._mainVideoWidthPct
      const mainVideoHeight = this._mainVideoHeightPct
      
      const previewX = mainVideoX + (relativeX / 100) * mainVideoWidth
      const previewY = mainVideoY + (relativeY / 100) * mainVideoHeight
      const previewWidth = (relativeWidth / 100) * mainVideoWidth
      const previewHeight = (relativeHeight / 100) * mainVideoHeight
      
      this.setData({
        cropPreviewConfig: {
          x: Math.max(0, Math.min(100, previewX)),
          y: Math.max(0, Math.min(100, previewY)),
          width: Math.max(0, Math.min(100, previewWidth)),
          height: Math.max(0, Math.min(100, previewHeight)),
          aspectRatio: crop.aspectRatio,
        }
      })
    } else {
      // 如果还没有计算，直接使用原始值（可能不准确，但至少能显示）
      this.setData({
        cropPreviewConfig: {
          x: crop.x,
          y: crop.y,
          width: crop.width,
          height: crop.height,
          aspectRatio: crop.aspectRatio,
        }
      })
    }
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
    const { shadowX, shadowY } = this.calcShadowOffset(distance, shadowAngle)
    this.setData({ 
      'textConfig.shadowDistance': distance,
      'textConfig.shadowX': shadowX,
      'textConfig.shadowY': shadowY,
    }, () => {
      this.updateShadowStyle()
    })
  },

  onShadowAngleChange(e) {
    const angle = e.detail.value
    const { shadowDistance } = this.data.textConfig
    const { shadowX, shadowY } = this.calcShadowOffset(shadowDistance, angle)
    this.setData({ 
      'textConfig.shadowAngle': angle,
      'textConfig.shadowX': shadowX,
      'textConfig.shadowY': shadowY,
    }, () => {
      this.updateShadowStyle()
    })
  },

  onShadowOpacityChange(e) {
    this.setData({ 'textConfig.shadowOpacity': e.detail.value }, () => {
      this.updateShadowStyle()
    })
  },

  // 计算阴影偏移量
  calcShadowOffset(distance, angle) {
    const radians = angle * (Math.PI / 180)
    const shadowX = Math.round((distance / 10) * Math.cos(radians) * 10) / 10
    const shadowY = Math.round((distance / 10) * Math.sin(radians) * 10) / 10
    return { shadowX, shadowY }
  },

  // 更新阴影CSS样式（两个版本：主预览缩小0.5，弹窗全尺寸）
  updateShadowStyle() {
    const tc = this.data.textConfig
    if (!tc.shadowColor || tc.shadowDistance <= 0) {
      this.setData({ 
        'textConfig._shadowStyle': 'none',
        'textConfig._shadowStyleFull': 'none',
      })
      return
    }
    const { shadowX, shadowY } = tc
    // 透明度：0=不透明(1.0), 100=全透明(0)
    const opacity = (100 - tc.shadowOpacity) / 100
    const rgba = this.hexToRgba(tc.shadowColor, opacity)
    // 主预览（缩小0.5倍）
    const blurSmall = tc.shadowBlur / 10
    const styleSmall = `${shadowX * 0.5}px ${shadowY * 0.5}px ${blurSmall}px ${rgba}`
    // 弹窗（全尺寸）
    const blurFull = tc.shadowBlur / 5
    const styleFull = `${shadowX}px ${shadowY}px ${blurFull}px ${rgba}`
    this.setData({ 
      'textConfig._shadowStyle': styleSmall,
      'textConfig._shadowStyleFull': styleFull,
    })
  },

  // 更新背景CSS样式
  updateBgStyle() {
    const tc = this.data.textConfig
    if (!tc.bgColor) {
      this.setData({ 'textConfig._bgStyle': '' })
      return
    }
    // 透明度：0=不透明(1.0), 100=全透明(0)
    const opacity = (100 - tc.bgOpacity) / 100
    const rgba = this.hexToRgba(tc.bgColor, opacity)
    const style = `background: ${rgba}; padding: 8px 12px; border-radius: 4px;`
    this.setData({ 'textConfig._bgStyle': style })
  },

  // 将 hex 颜色转换为 rgba
  hexToRgba(hex, alpha) {
    if (!hex) return 'transparent'
    const shorthand = /^#?([a-f\d])([a-f\d])([a-f\d])$/i
    hex = hex.replace(shorthand, (m, r, g, b) => r + r + g + g + b + b)
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) return hex
    const r = parseInt(result[1], 16)
    const g = parseInt(result[2], 16)
    const b = parseInt(result[3], 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  },

  onBgColorChange(e) {
    const color = e.currentTarget.dataset.color
    this.setData({ 'textConfig.bgColor': color }, () => {
      this.updateBgStyle()
    })
  },

  onBgOpacityChange(e) {
    this.setData({ 'textConfig.bgOpacity': e.detail.value }, () => {
      this.updateBgStyle()
    })
  },

  onClickCropTool() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先选择视频', icon: 'none' })
      return
    }
    // 打开裁剪面板，初始化裁剪区域
    this.setData({ 
      showCropPanel: true,
      cropConfig: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        aspectRatio: 'free',
      },
    })
    // 延迟获取视频区域尺寸，确保 wrapper 和视频已渲染
    setTimeout(() => {
      this.getCropVideoRect()
      // 获取后，如果是自由模式，重置为视频实际显示区域
      if (this.data.cropConfig.aspectRatio === 'free') {
        if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null) {
          this.setData({
            cropConfig: {
              ...this.data.cropConfig,
              x: this._cropVideoOffsetX,
              y: this._cropVideoOffsetY,
              width: this._cropVideoWidthPct,
              height: this._cropVideoHeightPct,
            },
          })
        }
      }
    }, 300)
  },

  onCropPanelClose() {
    this.setData({ showCropPanel: false })
  },

  onCropDone() {
    this.setData({ showCropPanel: false })
    wx.showToast({ title: '裁剪设置已保存', icon: 'success' })
    // 更新裁剪预览配置
    setTimeout(() => {
      this.updateMainVideoRect()
    }, 100)
  },

  // 裁剪视频加载完成，获取视频的原始宽高比
  onCropVideoLoaded(e) {
    const videoCtx = wx.createVideoContext('cropVideoPlayer', this)
    // 通过 video context 获取视频信息
    // 注意：微信小程序可能不支持直接获取视频宽高，需要通过其他方式
    // 这里先保存事件，后续通过 getCropVideoRect 计算
    this._cropVideoAspect = null // 暂时设为 null，后续通过计算获取
  },

  // 获取裁剪视频区域尺寸
  getCropVideoRect() {
    const query = wx.createSelectorQuery().in(this)
    // 获取 wrapper 的尺寸
    query.select('#cropVideoWrapper').boundingClientRect()
    query.exec((res) => {
      if (res && res[0]) {
        const wrapper = res[0]
        const videoWidth = this.data.videoWidth
        const videoHeight = this.data.videoHeight
        
        if (!videoWidth || !videoHeight) {
          // 如果没有视频宽高信息，使用 wrapper 的 100%
          this._cropVideoOffsetX = 0
          this._cropVideoOffsetY = 0
          this._cropVideoWidthPct = 100
          this._cropVideoHeightPct = 100
          this._cropVideoRect = wrapper
          this.ensureCropInBounds()
          return
        }
        
        // 计算视频的原始宽高比
        const videoAspect = videoWidth / videoHeight
        // 计算 wrapper 的宽高比
        const wrapperAspect = wrapper.width / wrapper.height
        
        let displayX, displayY, displayWidth, displayHeight
        
        if (videoAspect > wrapperAspect) {
          // 视频更宽，宽度占满 wrapper，高度按比例缩小（上下有黑边）
          displayWidth = 100
          displayHeight = (100 / videoAspect) * wrapperAspect
          displayX = 0
          displayY = (100 - displayHeight) / 2
        } else {
          // 视频更高，高度占满 wrapper，宽度按比例缩小（左右有黑边）
          displayHeight = 100
          displayWidth = (100 * videoAspect) / wrapperAspect
          displayX = (100 - displayWidth) / 2
          displayY = 0
        }
        
        // 保存视频的实际显示区域（相对于 wrapper 的百分比）
        this._cropVideoOffsetX = displayX
        this._cropVideoOffsetY = displayY
        this._cropVideoWidthPct = displayWidth
        this._cropVideoHeightPct = displayHeight
        
        // 保存 wrapper 的尺寸作为参考
        this._cropVideoRect = wrapper
        // 保存 wrapper 的宽高比，用于确保裁剪框的视觉宽高比正确
        this._cropWrapperAspect = wrapper.width / wrapper.height
        
        // 调试日志
        console.log('视频显示区域计算:', {
          videoSize: { width: videoWidth, height: videoHeight, aspect: videoAspect },
          wrapperSize: { width: wrapper.width, height: wrapper.height, aspect: wrapperAspect },
          display: { x: displayX, y: displayY, width: displayWidth, height: displayHeight }
        })
        
        // 获取后确保裁剪框在边界内
        this.ensureCropInBounds()
      }
    })
  },

  // 确保裁剪框在边界内（基于视频的实际显示区域）
  ensureCropInBounds() {
    const config = { ...this.data.cropConfig }
    let changed = false

    // 如果已获取视频的实际显示区域，限制裁剪框在视频区域内
    if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null) {
      const videoMinX = this._cropVideoOffsetX
      const videoMinY = this._cropVideoOffsetY
      const videoMaxX = this._cropVideoOffsetX + this._cropVideoWidthPct
      const videoMaxY = this._cropVideoOffsetY + this._cropVideoHeightPct

      // 限制位置在视频区域内
      if (config.x < videoMinX) {
        config.x = videoMinX
        changed = true
      }
      if (config.y < videoMinY) {
        config.y = videoMinY
        changed = true
      }
      
      // 限制尺寸不超出视频区域
      if (config.x + config.width > videoMaxX) {
        config.width = videoMaxX - config.x
        changed = true
      }
      if (config.y + config.height > videoMaxY) {
        config.height = videoMaxY - config.y
        changed = true
      }

      // 确保最小尺寸
      if (config.width < 10) {
        config.width = 10
        if (config.x + config.width > videoMaxX) config.x = videoMaxX - config.width
        changed = true
      }
      if (config.height < 10) {
        config.height = 10
        if (config.y + config.height > videoMaxY) config.y = videoMaxY - config.height
        changed = true
      }
    } else {
      // 如果还没有获取视频区域，使用 wrapper 的 0-100% 限制
      if (config.x < 0) {
        config.x = 0
        changed = true
      }
      if (config.y < 0) {
        config.y = 0
        changed = true
      }
      if (config.x + config.width > 100) {
        config.width = 100 - config.x
        changed = true
      }
      if (config.y + config.height > 100) {
        config.height = 100 - config.y
        changed = true
      }
      if (config.width < 10) {
        config.width = 10
        if (config.x + config.width > 100) config.x = 100 - config.width
        changed = true
      }
      if (config.height < 10) {
        config.height = 10
        if (config.y + config.height > 100) config.y = 100 - config.height
        changed = true
      }
    }

    if (changed) {
      this.setData({ cropConfig: config })
    }
  },

  // 选择裁剪比例
  onCropAspectRatioChange(e) {
    const ratio = e.currentTarget.dataset.ratio
    const config = { ...this.data.cropConfig, aspectRatio: ratio }
    
    // 如果选择了固定比例，调整裁剪区域
    if (ratio !== 'free') {
      const [w, h] = ratio.split(':').map(Number)
      const aspectRatio = w / h
      
      // 调试：验证比例解析
      console.log('比例解析:', {
        ratio,
        w,
        h,
        aspectRatio,
        expected: {
          '1:1': 1,
          '4:3': 4/3,
          '3:4': 3/4,
          '16:9': 16/9,
          '9:16': 9/16,
        }[ratio],
      })
      
      // 基于视频的实际显示区域计算裁剪框
      if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null) {
        // 视频的实际显示区域
        const videoX = this._cropVideoOffsetX
        const videoY = this._cropVideoOffsetY
        const videoWidth = this._cropVideoWidthPct
        const videoHeight = this._cropVideoHeightPct
        const videoAspect = videoWidth / videoHeight
        
        // 计算裁剪框在视频显示区域内的尺寸和位置
        // videoWidth 和 videoHeight 是相对于 wrapper 的百分比（0-100）
        // aspectRatio 是裁剪框的目标宽高比（比如 1:1 = 1, 16:9 = 16/9）
        // videoAspect = videoWidth / videoHeight 是视频在 wrapper 中的宽高比
        
        // 关键理解：videoWidth 和 videoHeight 是百分比，它们的比值就是视频在 wrapper 中的宽高比
        // 所以 videoAspect = videoWidth / videoHeight 是正确的
        
        // 我们需要计算一个裁剪框，使其宽高比 = aspectRatio，并且完全在视频显示区域内
        // 裁剪框的尺寸也是相对于 wrapper 的百分比
        
        // 计算在视频显示区域内，能容纳的最大裁剪框尺寸
        // 策略：尝试两种方案，选择能容纳且尺寸最大的
        
        // 关键：裁剪框的百分比是相对于 wrapper 的，所以需要考虑 wrapper 的宽高比
        // 如果 wrapper 的宽高比是 wrapperAspect，那么：
        // 裁剪框的实际宽高比 = (width% × wrapperWidth) / (height% × wrapperHeight) = (width / height) × wrapperAspect
        // 所以，如果我们想要裁剪框的实际宽高比 = aspectRatio，那么：
        // (width / height) × wrapperAspect = aspectRatio
        // width / height = aspectRatio / wrapperAspect
        
        const wrapperAspect = this._cropVideoRect ? (this._cropVideoRect.width / this._cropVideoRect.height) : 1
        // 调整目标宽高比，考虑 wrapper 的宽高比
        const adjustedAspectRatio = aspectRatio / wrapperAspect
        
        // 方法1：尝试宽度占满
        const cropWidth1 = videoWidth
        const cropHeight1 = cropWidth1 / adjustedAspectRatio
        const fit1 = cropHeight1 <= videoHeight // 是否能容纳
        const area1 = cropWidth1 * cropHeight1
        
        // 方法2：尝试高度占满
        const cropHeight2 = videoHeight
        const cropWidth2 = cropHeight2 * adjustedAspectRatio
        const fit2 = cropWidth2 <= videoWidth // 是否能容纳
        const area2 = cropWidth2 * cropHeight2
        
        // 调试：输出两种方案
        console.log('两种方案对比:', {
          ratio,
          aspectRatio,
          wrapperAspect,
          adjustedAspectRatio,
          videoAspect,
          videoSize: { width: videoWidth, height: videoHeight },
          方案1: { width: cropWidth1, height: cropHeight1, fit: fit1, area: area1, 实际宽高比: (cropWidth1 / cropHeight1) * wrapperAspect },
          方案2: { width: cropWidth2, height: cropHeight2, fit: fit2, area: area2, 实际宽高比: (cropWidth2 / cropHeight2) * wrapperAspect },
        })
        
        // 选择能容纳且尺寸最大的方案
        let cropWidth, cropHeight, cropX, cropY
        if (fit1 && fit2) {
          // 两种方案都能容纳，选择面积更大的
          const area1 = cropWidth1 * cropHeight1
          const area2 = cropWidth2 * cropHeight2
          if (area1 >= area2) {
            cropWidth = cropWidth1
            cropHeight = cropHeight1
            cropX = videoX
            cropY = videoY + (videoHeight - cropHeight) / 2
          } else {
            cropWidth = cropWidth2
            cropHeight = cropHeight2
            cropX = videoX + (videoWidth - cropWidth) / 2
            cropY = videoY
          }
        } else if (fit1) {
          // 只有方案1能容纳
          cropWidth = cropWidth1
          cropHeight = cropHeight1
          cropX = videoX
          cropY = videoY + (videoHeight - cropHeight) / 2
        } else if (fit2) {
          // 只有方案2能容纳
          cropWidth = cropWidth2
          cropHeight = cropHeight2
          cropX = videoX + (videoWidth - cropWidth) / 2
          cropY = videoY
        } else {
          // 两种方案都不能完全容纳，选择较小的（确保在边界内）
          if (cropWidth1 <= videoWidth && cropHeight1 <= videoHeight) {
            cropWidth = cropWidth1
            cropHeight = cropHeight1
            cropX = videoX
            cropY = videoY + (videoHeight - cropHeight) / 2
          } else {
            cropWidth = cropWidth2
            cropHeight = cropHeight2
            cropX = videoX + (videoWidth - cropWidth) / 2
            cropY = videoY
          }
        }
        
        // 最终边界检查，确保完全在视频区域内，同时保持宽高比
        // 先调整位置
        cropX = Math.max(videoX, Math.min(videoX + videoWidth - cropWidth, cropX))
        cropY = Math.max(videoY, Math.min(videoY + videoHeight - cropHeight, cropY))
        
        // 检查宽度是否超出，如果超出则缩小尺寸（保持宽高比）
        const maxWidth = videoX + videoWidth - cropX
        if (cropWidth > maxWidth) {
          cropWidth = maxWidth
          cropHeight = cropWidth / adjustedAspectRatio
          // 重新调整位置以保持居中（如果可能）
          cropY = Math.max(videoY, Math.min(videoY + videoHeight - cropHeight, videoY + (videoHeight - cropHeight) / 2))
        }
        
        // 检查高度是否超出，如果超出则缩小尺寸（保持宽高比）
        const maxHeight = videoY + videoHeight - cropY
        if (cropHeight > maxHeight) {
          cropHeight = maxHeight
          cropWidth = cropHeight * adjustedAspectRatio
          // 重新调整位置以保持居中（如果可能）
          cropX = Math.max(videoX, Math.min(videoX + videoWidth - cropWidth, videoX + (videoWidth - cropWidth) / 2))
        }
        
        // 再次检查宽度（因为高度调整可能影响宽度）
        const maxWidth2 = videoX + videoWidth - cropX
        if (cropWidth > maxWidth2) {
          cropWidth = maxWidth2
          cropHeight = cropWidth / adjustedAspectRatio
          cropY = Math.max(videoY, Math.min(videoY + videoHeight - cropHeight, cropY))
        }
        
        config.x = cropX
        config.y = cropY
        config.width = cropWidth
        config.height = cropHeight
        
        // 验证计算结果的宽高比
        const calculatedAspect = cropWidth / cropHeight
        const aspectMatch = Math.abs(calculatedAspect - aspectRatio) < 0.01
        
        console.log('固定比例计算:', {
          ratio,
          aspectRatio,
          videoAspect,
          videoSize: { width: videoWidth, height: videoHeight, x: videoX, y: videoY },
          cropSize: { width: cropWidth, height: cropHeight, x: cropX, y: cropY },
          cropAspect: calculatedAspect,
          aspectMatch,
          // 验证裁剪框是否在视频区域内
          inBounds: {
            x: cropX >= videoX && cropX <= videoX + videoWidth,
            y: cropY >= videoY && cropY <= videoY + videoHeight,
            width: cropX + cropWidth <= videoX + videoWidth,
            height: cropY + cropHeight <= videoY + videoHeight,
          },
          // 显示选择的方案
          选择的方案: fit1 && fit2 ? (area1 >= area2 ? '方案1(宽度占满)' : '方案2(高度占满)') : (fit1 ? '方案1(宽度占满)' : (fit2 ? '方案2(高度占满)' : '两种都不能容纳')),
        })
        
        // 如果宽高比不匹配，输出警告
        if (!aspectMatch) {
          console.error('❌ 裁剪框宽高比不匹配!', {
            expected: aspectRatio,
            calculated: calculatedAspect,
            diff: Math.abs(calculatedAspect - aspectRatio),
            ratio,
          })
        }
      } else if (this._cropVideoRect) {
        // 如果还没有获取视频区域，使用 wrapper 的尺寸（临时）
        const wrapperAspect = this._cropVideoRect.width / this._cropVideoRect.height
        
        if (aspectRatio > wrapperAspect) {
          config.width = 100
          config.height = (wrapperAspect / aspectRatio) * 100
          config.x = 0
          config.y = (100 - config.height) / 2
        } else {
          config.height = 100
          config.width = (aspectRatio / wrapperAspect) * 100
          config.y = 0
          config.x = (100 - config.width) / 2
        }
        // 延迟获取视频区域并重新计算
        setTimeout(() => {
          this.getCropVideoRect()
          this.onCropAspectRatioChange(e) // 重新计算
        }, 100)
      } else {
        // 如果没有视频尺寸，使用默认值（全屏）
        config.width = 100
        config.height = 100
        config.x = 0
        config.y = 0
      }
    } else {
      // 自由模式：重置为包围整个视频的实际显示区域
      if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null) {
        // 如果已获取视频区域，使用视频的实际显示区域
        config.x = this._cropVideoOffsetX
        config.y = this._cropVideoOffsetY
        config.width = this._cropVideoWidthPct
        config.height = this._cropVideoHeightPct
      } else {
        // 否则使用 wrapper 的 100%（临时，等待获取视频区域后调整）
        config.width = 100
        config.height = 100
        config.x = 0
        config.y = 0
        // 延迟获取视频区域并调整
        setTimeout(() => {
          this.getCropVideoRect()
          if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null) {
            this.setData({
              cropConfig: {
                ...this.data.cropConfig,
                x: this._cropVideoOffsetX,
                y: this._cropVideoOffsetY,
                width: this._cropVideoWidthPct,
                height: this._cropVideoHeightPct,
              },
            })
          }
        }, 100)
      }
    }
    
    // 确保不超出视频实际显示区域
    this.ensureCropInBounds()
    
    this.setData({ cropConfig: config })
  },

  // 裁剪框拖动开始
  onCropDragStart(e) {
    const touch = e.touches[0]
    const type = e.currentTarget.dataset.type || 'move'
    
    if (!this._cropVideoRect) {
      this.getCropVideoRect()
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
    }
    this.setData({ cropDragging: true, cropDragType: type })
  },

  // 裁剪框拖动中（节流优化）
  onCropDragMove(e) {
    if (!this._cropDrag || !this._cropDrag.active) return
    if (!this._cropVideoRect) return

    // 节流：每16ms更新一次（约60fps）
    const now = Date.now()
    if (this._cropDragLastUpdate && now - this._cropDragLastUpdate < 16) {
      return
    }
    this._cropDragLastUpdate = now

    const touch = e.touches[0]
    const deltaX = touch.clientX - this._cropDrag.startX
    const deltaY = touch.clientY - this._cropDrag.startY

    // 转换为百分比
    const deltaXPct = (deltaX / this._cropVideoRect.width) * 100
    const deltaYPct = (deltaY / this._cropVideoRect.height) * 100

    const { type, baseX, baseY, baseWidth, baseHeight } = this._cropDrag
    const { aspectRatio } = this.data.cropConfig
    const isFixedRatio = aspectRatio !== 'free'
    const [w, h] = aspectRatio !== 'free' ? aspectRatio.split(':').map(Number) : [1, 1]
    const ratio = w / h

    let newX = baseX
    let newY = baseY
    let newWidth = baseWidth
    let newHeight = baseHeight

    if (type === 'move') {
      // 移动整个裁剪框
      newX = baseX + deltaXPct
      newY = baseY + deltaYPct
      // 限制在视频区域内（0-100%）
      newX = Math.max(0, Math.min(100 - newWidth, newX))
      newY = Math.max(0, Math.min(100 - newHeight, newY))
    } else if (type.startsWith('resize-')) {
      // 调整大小
      
      // 如果固定比例，需要特殊处理拐角控制点
      if (isFixedRatio) {
        // 获取 wrapper 的宽高比
        const wrapperAspect = this._cropVideoRect ? (this._cropVideoRect.width / this._cropVideoRect.height) : 1
        // 调整目标宽高比，考虑 wrapper 的宽高比
        const adjustedAspectRatio = ratio / wrapperAspect
        
        // 对于拐角控制点（同时包含水平和垂直方向），需要根据拖动距离计算
        const isCorner = (type.includes('l') || type.includes('r')) && (type.includes('t') || type.includes('b'))
        
        if (isCorner) {
          // 拐角控制点：根据拖动距离的主要方向来决定缩放
          // 计算水平和垂直方向的拖动距离（考虑 wrapper 的宽高比）
          const deltaXScaled = deltaXPct
          const deltaYScaled = deltaYPct * wrapperAspect // 调整垂直距离以匹配水平距离的比例
          
          // 选择主要拖动方向（绝对值更大的）
          const absDeltaX = Math.abs(deltaXScaled)
          const absDeltaY = Math.abs(deltaYScaled)
          
          if (absDeltaX >= absDeltaY) {
            // 水平方向是主要方向，根据水平拖动调整宽度，然后调整高度
            if (type.includes('l')) {
              // 拖动左边
              const newLeftX = baseX + deltaXPct
              if (newLeftX < 0) {
                newX = 0
                newWidth = baseX + baseWidth
              } else {
                newX = newLeftX
                newWidth = baseWidth - deltaXPct
              }
            } else if (type.includes('r')) {
              // 拖动右边
              newWidth = baseWidth + deltaXPct
            }
            // 根据宽度调整高度（保持比例）
            newHeight = newWidth / adjustedAspectRatio
            // 根据拖动类型调整位置
            if (type.includes('t')) {
              newY = baseY + baseHeight - newHeight
            } else if (type.includes('b')) {
              // newY 不变
            }
          } else {
            // 垂直方向是主要方向，根据垂直拖动调整高度，然后调整宽度
            if (type.includes('t')) {
              // 拖动上边
              const newTopY = baseY + deltaYPct
              if (newTopY < 0) {
                newY = 0
                newHeight = baseY + baseHeight
              } else {
                newY = newTopY
                newHeight = baseHeight - deltaYPct
              }
            } else if (type.includes('b')) {
              // 拖动下边
              newHeight = baseHeight + deltaYPct
            }
            // 根据高度调整宽度（保持比例）
            newWidth = newHeight * adjustedAspectRatio
            // 根据拖动类型调整位置
            if (type.includes('l')) {
              newX = baseX + baseWidth - newWidth
            } else if (type.includes('r')) {
              // newX 不变
            }
          }
        } else {
          // 边控制点（只包含一个方向）
          // 拖动左边：往左拖动（deltaX < 0）应该扩大，往右拖动（deltaX > 0）应该缩小
          if (type.includes('l')) {
            const newLeftX = baseX + deltaXPct
            if (newLeftX < 0) {
              newX = 0
              newWidth = baseX + baseWidth
            } else {
              newX = newLeftX
              newWidth = baseWidth - deltaXPct
            }
            // 根据宽度调整高度（保持比例）
            newHeight = newWidth / adjustedAspectRatio
            // 保持下边不变
            newY = baseY + baseHeight - newHeight
          }
          // 拖动右边：往右拖动（deltaX > 0）应该扩大，往左拖动（deltaX < 0）应该缩小
          if (type.includes('r')) {
            newWidth = baseWidth + deltaXPct
            // 根据宽度调整高度（保持比例）
            newHeight = newWidth / adjustedAspectRatio
            // 保持上边不变
            newY = baseY + baseHeight - newHeight
          }
          // 拖动上边：往上拖动（deltaY < 0）应该扩大，往下拖动（deltaY > 0）应该缩小
          if (type.includes('t')) {
            const newTopY = baseY + deltaYPct
            if (newTopY < 0) {
              newY = 0
              newHeight = baseY + baseHeight
            } else {
              newY = newTopY
              newHeight = baseHeight - deltaYPct
            }
            // 根据高度调整宽度（保持比例）
            newWidth = newHeight * adjustedAspectRatio
            // 保持右边不变
            newX = baseX + baseWidth - newWidth
          }
          // 拖动下边：往下拖动（deltaY > 0）应该扩大，往上拖动（deltaY < 0）应该缩小
          if (type.includes('b')) {
            newHeight = baseHeight + deltaYPct
            // 根据高度调整宽度（保持比例）
            newWidth = newHeight * adjustedAspectRatio
            // 保持上边不变
            newY = baseY + baseHeight - newHeight
            // 保持左边不变
            newX = baseX + baseWidth - newWidth
          }
        }
      } else {
        // 自由模式：正常处理
        // 拖动左边：往左拖动（deltaX < 0）应该扩大，往右拖动（deltaX > 0）应该缩小
        if (type.includes('l')) {
          const newLeftX = baseX + deltaXPct
          if (newLeftX < 0) {
            newX = 0
            newWidth = baseX + baseWidth
          } else {
            newX = newLeftX
            newWidth = baseWidth - deltaXPct
          }
        }
        // 拖动右边：往右拖动（deltaX > 0）应该扩大，往左拖动（deltaX < 0）应该缩小
        if (type.includes('r')) {
          newWidth = baseWidth + deltaXPct
        }
        // 拖动上边：往上拖动（deltaY < 0）应该扩大，往下拖动（deltaY > 0）应该缩小
        if (type.includes('t')) {
          const newTopY = baseY + deltaYPct
          if (newTopY < 0) {
            newY = 0
            newHeight = baseY + baseHeight
          } else {
            newY = newTopY
            newHeight = baseHeight - deltaYPct
          }
        }
        // 拖动下边：往下拖动（deltaY > 0）应该扩大，往上拖动（deltaY < 0）应该缩小
        if (type.includes('b')) {
          newHeight = baseHeight + deltaYPct
        }
      }

      // 限制最小尺寸
      if (newWidth < 10) {
        newWidth = 10
        if (isFixedRatio) {
          newHeight = newWidth / (ratio / (this._cropVideoRect ? (this._cropVideoRect.width / this._cropVideoRect.height) : 1))
        }
        if (type.includes('l')) {
          newX = baseX + baseWidth - newWidth
        }
      }
      if (newHeight < 10) {
        newHeight = 10
        if (isFixedRatio) {
          newWidth = newHeight * (ratio / (this._cropVideoRect ? (this._cropVideoRect.width / this._cropVideoRect.height) : 1))
        }
        if (type.includes('t')) {
          newY = baseY + baseHeight - newHeight
        }
      }

      // 限制在视频区域内，确保不超出边界
      // 如果已获取视频的实际显示区域，使用视频区域；否则使用 wrapper 的 0-100%
      let minX = 0, minY = 0, maxX = 100, maxY = 100
      if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null) {
        minX = this._cropVideoOffsetX
        minY = this._cropVideoOffsetY
        maxX = this._cropVideoOffsetX + this._cropVideoWidthPct
        maxY = this._cropVideoOffsetY + this._cropVideoHeightPct
      }
      
      // 根据拖动类型，采用不同的边界限制策略
      if (type.includes('l')) {
        // 拖动左边：保持右边不变（baseX + baseWidth），只限制左边
        const rightEdge = baseX + baseWidth  // 原始右边边界
        if (newX < minX) {
          newX = minX
          newWidth = rightEdge - minX  // 保持右边不变
        }
        // 确保不超出右边界
        if (newX + newWidth > maxX) {
          newWidth = maxX - newX
        }
      } else if (type.includes('r')) {
        // 拖动右边：保持左边不变，只限制右边
        if (newX + newWidth > maxX) {
          newWidth = maxX - newX
        }
      } else if (type.includes('t')) {
        // 拖动上边：保持下边不变（baseY + baseHeight），只限制上边
        const bottomEdge = baseY + baseHeight  // 原始下边边界
        if (newY < minY) {
          newY = minY
          newHeight = bottomEdge - minY  // 保持下边不变
        }
        // 确保不超出下边界
        if (newY + newHeight > maxY) {
          newHeight = maxY - newY
        }
      } else if (type.includes('b')) {
        // 拖动下边：保持上边不变，只限制下边
        if (newY + newHeight > maxY) {
          newHeight = maxY - newY
        }
      } else {
        // 移动：正常限制在视频区域内
        newX = Math.max(minX, Math.min(maxX - newWidth, newX))
        newY = Math.max(minY, Math.min(maxY - newHeight, newY))
        if (newX + newWidth > maxX) newWidth = maxX - newX
        if (newY + newHeight > maxY) newHeight = maxY - newY
      }
      
      // 确保最小尺寸
      if (newWidth < 10) {
        newWidth = 10
        if (type.includes('l')) {
          // 拖动左边时，保持右边不变
          newX = (newX + newWidth) - 10
        } else if (newX + newWidth > 100) {
          newX = 100 - newWidth
        }
      }
      if (newHeight < 10) {
        newHeight = 10
        if (type.includes('t')) {
          // 拖动上边时，保持下边不变
          newY = (newY + newHeight) - 10
        } else if (newY + newHeight > 100) {
          newY = 100 - newHeight
        }
      }
    }

    // 最终边界检查（确保在视频实际显示区域内）
    let minX = 0, minY = 0, maxX = 100, maxY = 100
    if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null) {
      minX = this._cropVideoOffsetX
      minY = this._cropVideoOffsetY
      maxX = this._cropVideoOffsetX + this._cropVideoWidthPct
      maxY = this._cropVideoOffsetY + this._cropVideoHeightPct
    }
    
    // 如果是固定比例模式，在边界检查后需要重新调整尺寸以保持比例
    if (isFixedRatio) {
      const wrapperAspect = this._cropVideoRect ? (this._cropVideoRect.width / this._cropVideoRect.height) : 1
      const adjustedAspectRatio = ratio / wrapperAspect
      
      // 先进行边界检查
      newX = Math.max(minX, Math.min(maxX - newWidth, newX))
      newY = Math.max(minY, Math.min(maxY - newHeight, newY))
      
      // 检查宽度是否超出
      if (newX + newWidth > maxX) {
        newWidth = maxX - newX
        // 根据宽度调整高度（保持比例）
        newHeight = newWidth / adjustedAspectRatio
        // 如果调整后的高度超出边界，需要缩小
        if (newY + newHeight > maxY) {
          newHeight = maxY - newY
          newWidth = newHeight * adjustedAspectRatio
          // 重新调整位置
          newX = Math.max(minX, Math.min(maxX - newWidth, newX))
        }
        // 重新调整位置
        newY = Math.max(minY, Math.min(maxY - newHeight, newY))
      }
      
      // 检查高度是否超出
      if (newY + newHeight > maxY) {
        newHeight = maxY - newY
        // 根据高度调整宽度（保持比例）
        newWidth = newHeight * adjustedAspectRatio
        // 如果调整后的宽度超出边界，需要缩小
        if (newX + newWidth > maxX) {
          newWidth = maxX - newX
          newHeight = newWidth / adjustedAspectRatio
          // 重新调整位置
          newY = Math.max(minY, Math.min(maxY - newHeight, newY))
        }
        // 重新调整位置
        newX = Math.max(minX, Math.min(maxX - newWidth, newX))
      }
      
      // 最终验证：如果无法保持比例，阻止拖动（恢复到原始值）
      const finalAspect = (newWidth / newHeight) * wrapperAspect
      if (Math.abs(finalAspect - ratio) > 0.01) {
        // 比例被破坏，恢复到原始值
        newX = baseX
        newY = baseY
        newWidth = baseWidth
        newHeight = baseHeight
        // 显示提示
        wx.showToast({
          title: '已到达边界，无法继续拖动',
          icon: 'none',
          duration: 1500,
        })
      }
    } else {
      // 自由模式：正常边界检查
      newX = Math.max(minX, Math.min(maxX - newWidth, newX))
      newY = Math.max(minY, Math.min(maxY - newHeight, newY))
      // 确保不超出右边界和下边界
      if (newX + newWidth > maxX) {
        newWidth = maxX - newX
      }
      if (newY + newHeight > maxY) {
        newHeight = maxY - newY
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
    })
  },

  // 裁剪框拖动结束
  onCropDragEnd() {
    if (this._cropDrag) {
      this._cropDrag.active = false
    }
    this._cropDragLastUpdate = 0
    this.setData({ cropDragging: false, cropDragType: '' })
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
  },

  normalizeRange(startS, endS) {
    const durationS = this.data.durationS || 0
    let s = toFixed1(Number(startS || 0))
    let e = toFixed1(Number(endS || 0))

    s = clamp(s, 0, durationS)
    e = clamp(e, 0, durationS)

    if (e < s) e = s
    if (e - s < MIN_RANGE_S) e = toFixed1(s + MIN_RANGE_S)
    if (e - s > MAX_CLIP_DURATION_S) e = toFixed1(s + MAX_CLIP_DURATION_S)
    e = clamp(e, 0, durationS)
    if (e - s < MIN_RANGE_S) s = toFixed1(e - MIN_RANGE_S)
    s = clamp(s, 0, durationS)
    return { startS: s, endS: e }
  },

  updateWindowByRange(startS, endS) {
    const durationS = this.data.durationS || 0
    const windowDurationS = Math.min(durationS, MAX_CLIP_DURATION_S)
    if (durationS <= 0 || windowDurationS <= 0) {
      if (this.data.windowDurationS !== 0 || this.data.windowStartS !== 0) {
        this.setData({ windowStartS: 0, windowDurationS: 0, ticks: [] })
      }
      return
    }

    const maxWindowStart = Math.max(0, toFixed1(durationS - windowDurationS))
    let windowStartS = toFixed1(this.data.windowStartS || 0)
    windowStartS = clamp(windowStartS, 0, maxWindowStart)

    const s = Number(startS || 0)
    const e = Number(endS || 0)
    if (s < windowStartS) {
      windowStartS = toFixed1(s)
    } else if (e > windowStartS + windowDurationS) {
      windowStartS = toFixed1(e - windowDurationS)
    }
    windowStartS = clamp(windowStartS, 0, maxWindowStart)

    if (windowStartS !== (this.data.windowStartS || 0) || windowDurationS !== (this.data.windowDurationS || 0)) {
      this.setData({
        windowStartS,
        windowDurationS,
        ticks: buildTicks(windowStartS, windowDurationS),
      })
    }
  },

  onDragStart(e) {
    if (!this.data.videoPath || !(this.data.durationS > 0)) return
    if (!this._rulerWidthPx) this.refreshRulerRect()

    const type = e?.currentTarget?.dataset?.type || 'range'
    const touch = (e.touches && e.touches[0]) || null
    if (!touch) return

    this._drag = {
      active: true,
      type,
      startX: touch.clientX,
      baseStartS: this.data.startS,
      baseEndS: this.data.endS,
    }
    this.setData({ dragActiveType: type })

    // 如果正在播放片段，停止
    if (this.data.segmentPlaying) {
      this.setData({ segmentPlaying: false })
    }

    // 拖动时暂停视频
    if (this._videoCtx) {
      this._videoCtx.pause()
    }
  },

  onDragMove(e) {
    if (!this._drag || !this._drag.active) return
    const touch = (e.touches && e.touches[0]) || null
    if (!touch) return

    const durationS = this.data.durationS || 0
    const windowDurationS = this.data.windowDurationS || Math.min(durationS, MAX_CLIP_DURATION_S)
    const widthPx = this._rulerWidthPx || 0
    if (durationS <= 0 || windowDurationS <= 0 || widthPx <= 0) return

    const dx = touch.clientX - this._drag.startX
    const deltaS = toFixed1((dx / widthPx) * windowDurationS)

    let startS = this._drag.baseStartS
    let endS = this._drag.baseEndS

    if (this._drag.type === 'left') {
      startS = toFixed1(this._drag.baseStartS + deltaS)
      // 保持 end 不动，但需要满足 maxLen
      if (endS - startS > MAX_CLIP_DURATION_S) startS = toFixed1(endS - MAX_CLIP_DURATION_S)
      if (startS > endS - MIN_RANGE_S) startS = toFixed1(endS - MIN_RANGE_S)
    } else if (this._drag.type === 'right') {
      endS = toFixed1(this._drag.baseEndS + deltaS)
      if (endS - startS > MAX_CLIP_DURATION_S) endS = toFixed1(startS + MAX_CLIP_DURATION_S)
      if (endS < startS + MIN_RANGE_S) endS = toFixed1(startS + MIN_RANGE_S)
    } else {
      // range：整体平移，保持长度不变
      const len = toFixed1(this._drag.baseEndS - this._drag.baseStartS)
      startS = toFixed1(this._drag.baseStartS + deltaS)
      endS = toFixed1(startS + len)

      // 边界回弹
      if (startS < 0) {
        startS = 0
        endS = toFixed1(startS + len)
      }
      if (endS > durationS) {
        endS = durationS
        startS = toFixed1(endS - len)
      }
    }

    const normalized = this.normalizeRange(startS, endS)
    this.setData({ startS: normalized.startS, endS: normalized.endS })
    this.updateWindowByRange(normalized.startS, normalized.endS)
    this.updateUiByRange()

  },

  onDragEnd() {
    if (!this._drag || !this._drag.active) return
    this._drag.active = false
    this.updateWindowByRange(this.data.startS, this.data.endS)
    this.setData({ dragActiveType: '' })
    
    // 如果正在播放片段，停止
    if (this.data.segmentPlaying) {
      this.setData({ segmentPlaying: false })
    }
    
    // 拖拽结束后暂停并跳转到选中片段的起点
    if (this._videoCtx) {
      this._videoCtx.pause()
    }
    this.seekTo(this.data.startS || 0)
  },

  shiftRangeByDelta(deltaS) {
    const durationS = this.data.durationS || 0
    const baseStartS = this.data.startS || 0
    const baseEndS = this.data.endS || 0
    const len = toFixed1(baseEndS - baseStartS)

    let startS = toFixed1(baseStartS + deltaS)
    let endS = toFixed1(startS + len)

    if (startS < 0) {
      startS = 0
      endS = toFixed1(startS + len)
    }
    if (endS > durationS) {
      endS = durationS
      startS = toFixed1(endS - len)
    }

    const normalized = this.normalizeRange(startS, endS)
    return normalized
  },

  onScrubStart(e) {
    if (!this.data.videoPath || !(this.data.durationS > 0)) return
    if (!this._rulerWidthPx) this.refreshRulerRect()
    const touch = (e.touches && e.touches[0]) || null
    if (!touch) return

    // 拖动刻度时，先暂停视频
    if (this._videoCtx) {
      this._videoCtx.pause()
    }
    if (this.data.segmentPlaying) {
      this.setData({ segmentPlaying: false })
    }

    this._scrub = {
      active: true,
      startX: touch.clientX,
      baseWindowStartS: this.data.windowStartS || 0,
      baseStartS: this.data.startS || 0,
      baseEndS: this.data.endS || 0,
    }
    this.setData({ timelineDragging: true })
    this.previewAt(this.data.startS || 0)
  },

  onScrubMove(e) {
    if (!this._scrub || !this._scrub.active) return
    const touch = (e.touches && e.touches[0]) || null
    if (!touch) return

    const durationS = this.data.durationS || 0
    const windowDurationS = this.data.windowDurationS || Math.min(durationS, MAX_CLIP_DURATION_S)
    const widthPx = this._rulerWidthPx || 0
    if (durationS <= 0 || windowDurationS <= 0 || widthPx <= 0) return

    // 右滑：回到更早时间；左滑：滚到更晚时间（更符合“内容随手指移动”的直觉）
    const dx = touch.clientX - this._scrub.startX
    const deltaS = toFixed1((-dx / widthPx) * windowDurationS * 2) // 0.1s 精度，滚动速度 x2

    const maxWindowStart = Math.max(0, toFixed1(durationS - windowDurationS))
    const windowStartS = clamp(toFixed1(this._scrub.baseWindowStartS + deltaS), 0, maxWindowStart)

    // 同步平移选区（保持长度不变）
    const shift = toFixed1(windowStartS - this._scrub.baseWindowStartS)
    const normalized = (() => {
      // 基于 baseStart/baseEnd 平移（而不是每帧累加，避免漂移）
      const baseLen = toFixed1(this._scrub.baseEndS - this._scrub.baseStartS)
      let s = toFixed1(this._scrub.baseStartS + shift)
      let e = toFixed1(s + baseLen)
      if (s < 0) {
        s = 0
        e = toFixed1(s + baseLen)
      }
      if (e > durationS) {
        e = durationS
        s = toFixed1(e - baseLen)
      }
      return this.normalizeRange(s, e)
    })()

    this.setData({
      windowStartS,
      startS: normalized.startS,
      endS: normalized.endS,
      ticks: buildTicks(windowStartS, windowDurationS),
    })
    this.updateUiByRange()
    // 注意：滚动过程中不预览（避免闪烁），只在松手时预览
  },

  onScrubEnd() {
    if (!this._scrub || !this._scrub.active) return
    this._scrub.active = false
    this.setData({ timelineDragging: false })
    
    // 如果正在播放片段，停止
    if (this.data.segmentPlaying) {
      this.setData({ segmentPlaying: false })
    }
    
    // 松手后跳转到选中片段的起点
    this.seekTo(this.data.startS || 0)
  },

  onResolutionPick(e) {
    this.setData({ resolutionIndex: Number(e.detail.value || 0) })
  },

  onFpsPick(e) {
    this.setData({ fpsIndex: Number(e.detail.value || 0) })
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

    this.setData({ processing: true, progressText: '准备中…', outPath: '' })
    wx.showLoading({ title: '转换中…', mask: true })

    try {
      // 构建文字配置（只有设置了内容时才传递，过滤掉内部字段）
      let textConfig = null
      if (this.data.textConfig.content) {
        const tc = this.data.textConfig
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
        }
      }

      // 构建裁剪配置（如果设置了裁剪）
      // 需要将相对于 wrapper 的百分比转换为相对于视频实际显示区域的百分比
      let cropConfig = null
      const crop = this.data.cropConfig
      if (crop && (crop.x !== 0 || crop.y !== 0 || crop.width !== 100 || crop.height !== 100)) {
        // 如果已获取视频的实际显示区域，转换为相对于视频显示区域的百分比
        if (this._cropVideoOffsetX !== undefined && this._cropVideoOffsetX !== null) {
          const videoX = this._cropVideoOffsetX
          const videoY = this._cropVideoOffsetY
          const videoWidth = this._cropVideoWidthPct
          const videoHeight = this._cropVideoHeightPct
          
          // 将相对于 wrapper 的百分比转换为相对于视频显示区域的百分比
          // crop.x 是相对于 wrapper 的，需要转换为相对于视频显示区域的
          const relativeX = ((crop.x - videoX) / videoWidth) * 100
          const relativeY = ((crop.y - videoY) / videoHeight) * 100
          const relativeWidth = (crop.width / videoWidth) * 100
          const relativeHeight = (crop.height / videoHeight) * 100
          
          cropConfig = {
            x: Math.max(0, Math.min(100, relativeX)),
            y: Math.max(0, Math.min(100, relativeY)),
            width: Math.max(0, Math.min(100, relativeWidth)),
            height: Math.max(0, Math.min(100, relativeHeight)),
          }
        } else {
          // 如果没有视频区域信息，直接使用原始值（回退方案）
          cropConfig = {
            x: crop.x,
            y: crop.y,
            width: crop.width,
            height: crop.height,
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
      this.setData({ outPath, processing: false, progressText: '' })
      wx.showToast({ title: '转换成功', icon: 'success' })
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
})


