/**
 * 文字编辑模块
 * 处理文字编辑相关的所有功能
 */

const { filterEmoji, calcShadowOffset: calcShadowOffsetUtil, hexToRgba } = require('./utils')

/**
 * 创建文字编辑器
 * @param {Object} page - 页面实例
 * @returns {Object} 文字编辑方法
 */
function createTextEditor(page) {
  return {
    /**
     * 计算两点之间的距离（用于双指捏合）
     */
    getTouchDistance(touch1, touch2) {
      const dx = touch1.clientX - touch2.clientX
      const dy = touch1.clientY - touch2.clientY
      return Math.sqrt(dx * dx + dy * dy)
    },

    /**
     * 计算阴影偏移量
     */
    calcShadowOffset(distance, angle) {
      return calcShadowOffsetUtil(distance, angle)
    },

    /**
     * 更新阴影CSS样式
     */
    updateShadowStyle() {
      const tc = page.data.textConfig
      if (!tc.shadowColor || tc.shadowDistance <= 0) {
        page.setData({ 
          'textConfig._shadowStyle': 'none',
          'textConfig._shadowStyleFull': 'none',
        })
        return
      }
      const { shadowX, shadowY } = tc
      // 透明度：0=不透明(1.0), 100=全透明(0)
      const opacity = (100 - tc.shadowOpacity) / 100
      const rgba = hexToRgba(tc.shadowColor, opacity)
      // 主预览（缩小0.5倍）
      const blurSmall = tc.shadowBlur / 10
      const styleSmall = `${shadowX * 0.5}px ${shadowY * 0.5}px ${blurSmall}px ${rgba}`
      // 弹窗（全尺寸）
      const blurFull = tc.shadowBlur / 5
      const styleFull = `${shadowX}px ${shadowY}px ${blurFull}px ${rgba}`
      page.setData({ 
        'textConfig._shadowStyle': styleSmall,
        'textConfig._shadowStyleFull': styleFull,
      })
    },

    /**
     * 更新背景CSS样式
     */
    updateBgStyle() {
      const tc = page.data.textConfig
      if (!tc.bgColor) {
        page.setData({ 'textConfig._bgStyle': '' })
        return
      }
      // 透明度：0=不透明(1.0), 100=全透明(0)
      const opacity = (100 - tc.bgOpacity) / 100
      const rgba = hexToRgba(tc.bgColor, opacity)
      const style = `background: ${rgba}; padding: 8px 12px; border-radius: 4px;`
      page.setData({ 'textConfig._bgStyle': style })
    },

    /**
     * 将 hex 颜色转换为 rgba
     */
    hexToRgba(hex, alpha) {
      return hexToRgba(hex, alpha)
    },

    /**
     * 过滤emoji字符
     */
    filterEmoji(str) {
      return filterEmoji(str)
    },
  }
}

module.exports = {
  createTextEditor,
}

