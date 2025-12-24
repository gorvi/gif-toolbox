/**
 * 工具函数模块
 * 包含纯函数，不依赖页面状态
 */

// 工具函数
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function toFixed1(n) {
  return Math.round(n * 10) / 10
}

// 过滤掉emoji字符
function filterEmoji(str) {
  if (!str) return str
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
 * 播放时间显示：
 * - totalDuration < 1 小时时：mm:ss.d
 * - totalDuration >= 1 小时时：hh:mm:ss.d
 */
function formatClock(totalSeconds, totalDurationSeconds) {
  const t = Math.max(0, Number(totalSeconds || 0))
  const sec = Math.floor(t)
  const d = Math.floor((t - sec) * 10 + 1e-6)

  if (Number(totalDurationSeconds || 0) >= 3600) {
    // 显示到小时：hh:mm:ss.d
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${d}`
  }

  // 否则显示 mm:ss.d（总分钟可能超过 60）
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${pad2(m)}:${pad2(s)}.${d}`
}

/**
 * 生成刻度线（0.1 秒精度）
 */
function buildTicks(windowStartS, windowDurationS) {
  const base = Math.max(0, Number(windowStartS || 0))
  const d = Math.max(0, Number(windowDurationS || 0))
  if (d <= 0) return []

  const ticks = []
  const stepS = 0.1
  const maxT = Math.floor(d * 10) / 10

  for (let i = 0; i <= maxT * 10; i++) {
    const t = toFixed1(i * stepS)
    if (t > d) break

    const isInteger = Math.abs(t - Math.round(t)) < 0.01
    const isHalf = Math.abs((t * 10) % 5) < 0.01 && !isInteger

    let kind = 'small'
    if (isInteger) {
      kind = 'big'
    } else if (isHalf) {
      kind = 'mid'
    }

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

/**
 * 计算两点之间的距离
 */
function getDistance(touch1, touch2) {
  if (!touch1 || !touch2) return 0
  const x1 = Number(touch1.clientX || 0)
  const y1 = Number(touch1.clientY || 0)
  const x2 = Number(touch2.clientX || 0)
  const y2 = Number(touch2.clientY || 0)
  const dx = x2 - x1
  const dy = y2 - y1
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 计算阴影偏移量
 */
function calcShadowOffset(distance, angle) {
  const radians = angle * (Math.PI / 180)
  const shadowX = Math.round((distance / 10) * Math.cos(radians) * 10) / 10
  const shadowY = Math.round((distance / 10) * Math.sin(radians) * 10) / 10
  return { shadowX, shadowY }
}

/**
 * 将 hex 颜色转换为 rgba
 */
function hexToRgba(hex, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

module.exports = {
  clamp,
  toFixed1,
  filterEmoji,
  pad2,
  formatHms1,
  formatMsLabel,
  formatClock,
  buildTicks,
  getDistance,
  calcShadowOffset,
  hexToRgba,
}

