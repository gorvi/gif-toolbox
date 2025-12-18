// 主时间线模块：中间固定播放头 + 可横向滚动刻度条

const { clamp, toFixed1, formatMsLabel } = require('./utils')

// 根据总时长选择每秒对应的像素数，让短视频更“细”，长视频更“粗略”
function choosePixelsPerSecond(totalS) {
  const t = Math.max(0, Number(totalS || 0))
  if (t <= 30) return 80
  if (t <= 120) return 40
  if (t <= 600) return 20
  return 10
}

// 生成主时间线刻度（细分到 0.1 秒）
function buildMainTicks(totalS, pixelsPerSecond) {
  const ticks = []
  const duration = Math.max(0, Number(totalS || 0))
  if (!duration) return ticks

  const stepS = 0.1

  for (let t = 0; t <= duration + 1e-6; t += stepS) {
    const timeS = Math.min(duration, toFixed1(t))
    const leftPx = timeS * pixelsPerSecond

    const isIntSecond = Math.abs(timeS - Math.round(timeS)) < 0.01
    const tenth = Math.round(timeS * 10) // 以 0.1s 为单位的整型
    const isHalfSecond = !isIntSecond && (tenth % 5 === 0) // 0.5, 1.5, 2.5, ...

    let kind = 'small'
    if (isIntSecond) {
      kind = 'big'
    } else if (isHalfSecond) {
      kind = 'mid'
    }

    const label = isIntSecond ? formatMsLabel(timeS) : ''

    ticks.push({
      idx: tenth,
      timeS,
      leftPx,
      kind,
      label,
    })
  }

  return ticks
}

function createMainTimeline(page) {
  let viewWidthPx = 320
  if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
    try {
      const sys = wx.getSystemInfoSync()
      const w = sys.windowWidth || viewWidthPx
      viewWidthPx = Math.floor(w * 0.8)
    } catch (e) {
      // ignore
    }
  }

  const state = {
    totalDurationS: 0,
    pixelsPerSecond: 80,
    viewWidthPx,
    contentWidthPx: 0,
    maxScrollLeft: 0,      // contentWidthPx - viewWidthPx，仅用于计算边界
    ticks: [],
    offsetPx: 0,          // 主时间线整体平移像素（负值表示内容向左移动）
    playheadTimeS: 0,
    manualScrolling: false,
    manualScrollTimer: null,
    lastPreviewTimeS: 0,
    previewTimer: null,
    lastSyncTs: 0,        // 上一次同步到页面的时间戳
    lastSyncTimeS: 0,     // 上一次同步的时间点
    range: { startPx: 0, widthPx: 0 },
  }

  function sync(extra) {
    const merged = Object.assign(
      {},
      {
        enabled: state.totalDurationS > 0,
        totalDurationS: state.totalDurationS,
        pixelsPerSecond: state.pixelsPerSecond,
        contentWidthPx: state.contentWidthPx,
        viewWidthPx: state.viewWidthPx,
        offsetPx: state.offsetPx,
        playheadTimeS: state.playheadTimeS,
        playheadTimeText: formatMsLabel(state.playheadTimeS),
        maxScrollLeft: state.maxScrollLeft,
        ticks: state.ticks,
        range: state.range,
      },
      extra || {}
    )
    page.setData({
      mainTimeline: merged,
    })
  }

  // 根据当前 viewWidthPx / pixelsPerSecond / totalDurationS 重新计算 contentWidthPx、边界和 offsetPx
  function recomputeLayout() {
    state.contentWidthPx = state.totalDurationS * state.pixelsPerSecond
    state.maxScrollLeft = Math.max(0, state.contentWidthPx - state.viewWidthPx)
    const centerX = state.viewWidthPx / 2
    const minOffset = centerX - state.contentWidthPx
    const maxOffset = centerX
    state.offsetPx = clamp(state.offsetPx, minOffset, maxOffset)
    // 同步截取高亮区域
    updateRangeFromPage()
  }

  function updateRangeFromPage() {
    if (!page || !page.data) return
    const startS = Number(page.data.startS || 0)
    const endS = Number(page.data.endS || 0)
    const s = clamp(startS, 0, state.totalDurationS)
    const e = clamp(endS, s, state.totalDurationS)
    const startPx = s * state.pixelsPerSecond
    const widthPx = Math.max(0, (e - s) * state.pixelsPerSecond)
    state.range = { startPx, widthPx }
    // 每次更新截取范围后，同步到页面，避免拖动主时间线后绿条消失
    sync()
  }

  // 实际测量主时间线宽度，保证 0 秒居中对齐红线
  function measureViewWidthAndSync() {
    if (typeof wx === 'undefined' || !wx.createSelectorQuery) return
    wx.nextTick(() => {
      const q = wx.createSelectorQuery().in(page)
      q.select('.main-timeline').boundingClientRect()
      q.exec((res) => {
        const rect = res && res[0]
        if (rect && rect.width) {
          state.viewWidthPx = rect.width
          // 重新以 0 秒居中作为基准
          state.offsetPx = state.viewWidthPx / 2
          recomputeLayout()
          sync()
        }
      })
    })
  }

  return {
    init(totalDurationS) {
      const t = Math.max(0, Number(totalDurationS || 0))
      state.totalDurationS = t
      if (!t) {
        page.setData({ mainTimeline: { enabled: false } })
        return
      }

      state.pixelsPerSecond = choosePixelsPerSecond(t)
      state.contentWidthPx = t * state.pixelsPerSecond
      state.ticks = buildMainTicks(t, state.pixelsPerSecond)
      state.playheadTimeS = 0
      // 先按当前 viewWidthPx 让 0 秒在中间：offsetPx = centerX - 0
      state.offsetPx = state.viewWidthPx / 2
      recomputeLayout()
      state.manualScrolling = false

      sync()
      // 等 DOM 渲染完成后再用真实宽度重新校准一次
      measureViewWidthAndSync()
    },

    updateDuration(totalDurationS) {
      this.init(totalDurationS)
    },

    updateRangeFromPage,

    // 播放按钮点击后恢复自动跟随模式（允许 onVideoTimeUpdate 驱动时间线移动）
    resumeAutoFollow() {
      state.manualScrolling = false
    },

    // 播放进度驱动时间线滚动（非手动拖动时才自动居中）
    onVideoTimeUpdate(currentS) {
      if (!(state.totalDurationS > 0)) return
      if (state.manualScrolling) return

      const t = clamp(Number(currentS || 0), 0, state.totalDurationS)
      state.playheadTimeS = t

      const centerPx = t * state.pixelsPerSecond
      // 目标：让当前时间在容器水平中心，即 offsetPx = centerX - centerPx
      const centerX = state.viewWidthPx / 2
      let offsetPx = centerX - centerPx
      // 边界：0 秒最多在中心（offsetPx = centerX），末尾最多在中心（offsetPx = centerX - contentWidthPx）
      const minOffset = centerX - state.contentWidthPx
      const maxOffset = centerX
      offsetPx = clamp(offsetPx, minOffset, maxOffset)
      state.offsetPx = offsetPx

      sync()
    },

    // 主时间线触摸开始
    onTouchStart(e) {
      if (!state.totalDurationS || !e.touches || !e.touches.length) return
      const touches = e.touches
      if (touches.length >= 2) {
        // 双指缩放
        const dx = touches[0].clientX - touches[1].clientX
        const dy = touches[0].clientY - touches[1].clientY
        const dist = Math.sqrt(dx * dx + dy * dy)
        state.pinch = {
          active: true,
          startDist: dist,
          basePixelsPerSecond: state.pixelsPerSecond,
        }
        state.drag = { active: false }
      } else {
        // 单指拖动
        const touch = touches[0]
        state.drag = {
          active: true,
          startX: touch.clientX,
          baseOffset: state.offsetPx,
        }
        state.pinch = { active: false }
      }
      state.manualScrolling = true
      if (typeof page._mainTimelineFollow !== 'undefined') {
        page._mainTimelineFollow = false
      }
    },

    // 主时间线触摸移动
    onTouchMove(e) {
      if (!state.totalDurationS || !e.touches || !e.touches.length) return
      const touches = e.touches

      // 双指缩放
      if (touches.length >= 2 && state.pinch && state.pinch.active) {
        const dx = touches[0].clientX - touches[1].clientX
        const dy = touches[0].clientY - touches[1].clientY
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (!dist || !state.pinch.startDist) return
        const scale = dist / state.pinch.startDist
        // 根据主时间线宽度限制缩放范围：
        // - 最小：半屏 4 秒 => 全宽约 8 秒
        // - 最大：半屏 2 秒 => 全宽约 4 秒
        const halfWidth = (state.viewWidthPx || 320) / 2
        const MIN_PX_PER_S = halfWidth / 4   // 半屏 4s
        const MAX_PX_PER_S = halfWidth / 2   // 半屏 2s
        const newPps = clamp(state.pinch.basePixelsPerSecond * scale, MIN_PX_PER_S, MAX_PX_PER_S)
        state.pixelsPerSecond = newPps
        state.ticks = buildMainTicks(state.totalDurationS, state.pixelsPerSecond)
        recomputeLayout()

        // 维持当前时间在中间
        const centerX = state.viewWidthPx / 2
        const centerPx = state.playheadTimeS * state.pixelsPerSecond
        let offsetPx = centerX - centerPx
        const minOffset = centerX - state.contentWidthPx
        const maxOffset = centerX
        offsetPx = clamp(offsetPx, minOffset, maxOffset)
        state.offsetPx = offsetPx

        sync()
        return
      }

      // 单指拖动
      if (!state.drag || !state.drag.active) return
      const touch = touches[0]
      const deltaX = touch.clientX - state.drag.startX
      let offsetPx = state.drag.baseOffset + deltaX

      const centerX = state.viewWidthPx / 2
      const minOffset = centerX - state.contentWidthPx
      const maxOffset = centerX
      offsetPx = clamp(offsetPx, minOffset, maxOffset)
      state.offsetPx = offsetPx

      if (!(state.totalDurationS > 0) || !(state.pixelsPerSecond > 0)) {
        sync()
        return
      }

      // 计算当前视图中央对应的时间点
      const centerPx = centerX - offsetPx
      const t = clamp(centerPx / state.pixelsPerSecond, 0, state.totalDurationS)
      state.playheadTimeS = t

      const now = Date.now()
      const dt = now - (state.lastSyncTs || 0)
      const dTime = Math.abs(t - (state.lastSyncTimeS || 0))
      // 只有时间变化到一定程度或超过一定时间间隔时才同步，减轻 setData 频率
      if (dt < 30 && dTime < 0.05) {
        return
      }
      state.lastSyncTs = now
      state.lastSyncTimeS = t

      // 同步当前时间到页面，用于点击“播放全篇”时从该时间点开始播放
      if (typeof page.setData === 'function') {
        page.setData({ currentS: t })
      }

      // 拖动主时间线时预览当前帧：让视频画面始终显示红线指向的位置
      if (page._videoController && typeof page._videoController.previewAt === 'function') {
        // 进一步节流，避免频繁 seek 导致卡顿
        if (!state.lastPreviewTimeS || Math.abs(t - state.lastPreviewTimeS) >= 0.1) {
          state.lastPreviewTimeS = t
          if (state.previewTimer) {
            clearTimeout(state.previewTimer)
          }
          state.previewTimer = setTimeout(() => {
            page._videoController.previewAt(t)
          }, 0)
        }
      }

      sync()
    },

    // 主时间线触摸结束
    onTouchEnd() {
      if (state.drag) state.drag.active = false
      if (state.pinch) state.pinch.active = false
      // 不立刻恢复跟随，由用户点击播放按钮时再打开
    },
  }
}

module.exports = {
  createMainTimeline,
}
