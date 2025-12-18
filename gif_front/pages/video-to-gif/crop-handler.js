/**
 * 裁剪处理模块
 * 处理视频裁剪相关的所有功能
 */

const { clamp } = require('./utils')

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

      // 判断是在文字编辑面板还是独立裁剪面板
      const isInTextPanel = page.data.showTextPanel && page.data.textActiveTab === 'crop'
      const offsetX = isInTextPanel ? page._textVideoOffsetX : page._cropVideoOffsetX
      const offsetY = isInTextPanel ? page._textVideoOffsetY : page._cropVideoOffsetY
      const widthPct = isInTextPanel ? page._textVideoWidthPct : page._cropVideoWidthPct
      const heightPct = isInTextPanel ? page._textVideoHeightPct : page._cropVideoHeightPct

      // 如果已获取视频的实际显示区域，限制裁剪框在视频区域内
      if (offsetX !== undefined && offsetX !== null) {
        const videoMinX = offsetX
        const videoMinY = offsetY
        const videoMaxX = offsetX + widthPct
        const videoMaxY = offsetY + heightPct

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
        page.setData({ cropConfig: config })
      }
    },
  }
}

module.exports = {
  createCropHandler,
}

