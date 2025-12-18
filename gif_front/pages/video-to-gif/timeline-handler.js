/**
 * 时间轴拖拽处理模块
 * 处理时间轴上的拖拽、滚动、范围选择等交互
 */

const { MAX_CLIP_DURATION_S } = require('../../constants/config')
const { clamp, toFixed1, buildTicks } = require('./utils')

const MIN_RANGE_S = 0.1

/**
 * 创建时间轴处理器
 * @param {Object} page - 页面实例
 * @returns {Object} 时间轴处理方法
 */
function createTimelineHandler(page) {
  return {
    /**
     * 规范化范围
     */
    normalizeRange(startS, endS) {
      const durationS = page.data.durationS || 0
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

    /**
     * 根据范围更新窗口
     */
    updateWindowByRange(startS, endS) {
      const durationS = page.data.durationS || 0
      const windowDurationS = Math.min(durationS, MAX_CLIP_DURATION_S)
      if (durationS <= 0 || windowDurationS <= 0) {
        if (page.data.windowDurationS !== 0 || page.data.windowStartS !== 0) {
          page.setData({ windowStartS: 0, windowDurationS: 0, ticks: [] })
        }
        return
      }

      const maxWindowStart = Math.max(0, toFixed1(durationS - windowDurationS))
      let windowStartS = toFixed1(page.data.windowStartS || 0)
      windowStartS = clamp(windowStartS, 0, maxWindowStart)

      const s = Number(startS || 0)
      const e = Number(endS || 0)
      if (s < windowStartS) {
        windowStartS = toFixed1(s)
      } else if (e > windowStartS + windowDurationS) {
        windowStartS = toFixed1(e - windowDurationS)
      }
      windowStartS = clamp(windowStartS, 0, maxWindowStart)

      if (windowStartS !== (page.data.windowStartS || 0) || windowDurationS !== (page.data.windowDurationS || 0)) {
        page.setData({
          windowStartS,
          windowDurationS,
          ticks: buildTicks(windowStartS, windowDurationS),
        })
      }
    },

    /**
     * 通过偏移量平移范围
     */
    shiftRangeByDelta(deltaS) {
      const durationS = page.data.durationS || 0
      const baseStartS = page.data.startS || 0
      const baseEndS = page.data.endS || 0
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

      return this.normalizeRange(startS, endS)
    },
  }
}

module.exports = {
  createTimelineHandler,
  MIN_RANGE_S,
}

