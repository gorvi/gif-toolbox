/**
 * 裁剪处理模块
 * 处理视频裁剪相关的所有功能
 */

/**
 * 创建裁剪处理器
 * @param {Object} page - 页面实例
 * @returns {Object} 裁剪处理方法
 */
function createCropHandler(page) {
  return {
    /**
     * 确保裁剪框在边界内
     */
    ensureCropInBounds() {
      const config = { ...page.data.cropConfig }
      let changed = false

      const toNum = (v, fallback) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : fallback
      }
      const clampPct = (n) => Math.max(0, Math.min(100, n))

      const x = toNum(config.x, 0)
      const y = toNum(config.y, 0)
      const w = toNum(config.width, 100)
      const h = toNum(config.height, 100)

      let minX = 0
      let minY = 0
      let maxX = 100
      let maxY = 100
      if (page._mainVideoOffsetX !== undefined && page._mainVideoOffsetX !== null) {
        minX = Number(page._mainVideoOffsetX) || 0
        minY = Number(page._mainVideoOffsetY) || 0
        maxX = minX + (Number(page._mainVideoWidthPct) || 0)
        maxY = minY + (Number(page._mainVideoHeightPct) || 0)
        minX = clampPct(minX)
        minY = clampPct(minY)
        maxX = clampPct(maxX)
        maxY = clampPct(maxY)
      }

      let nx = clampPct(x)
      let ny = clampPct(y)
      let nw = clampPct(w)
      let nh = clampPct(h)

      const minSize = 10
      if (nw < minSize) nw = minSize
      if (nh < minSize) nh = minSize
      nw = Math.min(nw, Math.max(minSize, maxX - minX))
      nh = Math.min(nh, Math.max(minSize, maxY - minY))

      nx = Math.max(minX, Math.min(maxX - nw, nx))
      ny = Math.max(minY, Math.min(maxY - nh, ny))

      if (nx !== x || ny !== y || nw !== w || nh !== h) {
        config.x = nx
        config.y = ny
        config.width = nw
        config.height = nh
        changed = true
      }

      if (changed) {
        page.setData({ cropConfig: config })
      }
    },
  }
}

module.exports = {
  createCropHandler,
}
