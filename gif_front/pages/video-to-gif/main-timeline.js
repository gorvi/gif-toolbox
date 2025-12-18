// 主时间轴模块：负责剪映风格时间线（中间固定播放头 + 可滚动刻度）

const { clamp, toFixed1, formatMsLabel } = require('./utils')

function choosePixelsPerSecond(totalS) {
  const t = Math.max(0, Number(totalS || 0))
  if (t <= 30) return 80
  if (t <= 120) return 40
  if (t <= 600) return 20
  return 10
}

function buildMainTicks(totalS, pixelsPerSecond) {
  const ticks = []
  const duration = Math.max(0, Number(totalS || 0))
  if (!duration) return ticks

  // 根据总时长选择刻度步长
  let stepS = 1
  if (duration <= 30) {
    stepS = 0.5
  } else if (duration <= 120) {
    stepS = 1
  } else if (duration <= 600) {
    stepS = 2
  } else {
    stepS = 5
  }

  for (let t = 0; t <= duration + 1e-6; t += stepS) {
    const timeS = Math.min(duration, toFixed1(t))
    const leftPx = timeS * pixelsPerSecond

    const isIntSecond = Math.abs(timeS - Math.round(timeS)) < 0.01
    const isMajor = isIntSecond && (Math.round(timeS) % 5 === 0)

    const kind = isMajor ? 'big' : 'small'
    const label = isMajor ? formatMsLabel(timeS) : ''

    ticks.push({
      idx: Math.round(timeS * 10),
      timeS,
      leftPx,
      kind,
      label,
    })
  }

  return ticks
}

function createMainTimeline(page) {
  const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : { windowWidth: 375 }
  const viewWidthPx = sys.windowWidth || 375

  const state = {
    totalDurationS: 0,
    pixelsPerSecond: 80,
    viewWidthPx,
    contentWidthPx: 0,
    maxScrollLeft: 0,
    ticks: [],
  }

  function sync(extra) {
    page.setData({
      mainTimeline: Object.assign({
        enabled: state.totalDurationS > 0,
        totalDurationS: state.totalDurationS,
        pixelsPerSecond: state.pixelsPerSecond,
        contentWidthPx: state.contentWidthPx,
        viewWidthPx: state.viewWidthPx,
        scrollLeft: 0,
        playheadTimeS: 0,
        maxScrollLeft: state.maxScrollLeft,
        ticks: state.ticks,
      }, extra || {}),
    })
  }

  return {
    init(totalDurationS) {
      const t = Math.max(0, Number(totalDurationS || 0))
      state.totalDurationS = t
      if (!t) {
        page.setData({ 'mainTimeline.enabled': false })
        return
      }

      state.pixelsPerSecond = choosePixelsPerSecond(t)
      state.contentWidthPx = t * state.pixelsPerSecond
      state.maxScrollLeft = Math.max(0, state.contentWidthPx - state.viewWidthPx)
      state.ticks = buildMainTicks(t, state.pixelsPerSecond)

      sync()
    },

    updateDuration(totalDurationS) {
      this.init(totalDurationS)
    },

    // 预留：播放进度驱动时间线滚动（子任务 B 实现）
    onVideoTimeUpdate(/* currentS */) {},

    // 预留：用户拖动时间线（子任务 C 实现）
    onScroll(/* e */) {},
  }
}

module.exports = {
  createMainTimeline,
}
