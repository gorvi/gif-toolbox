/**
 * 坐标转换辅助模块
 * 处理视频预览区域在不同上下文中的坐标转换
 */

/**
 * 计算视频的实际显示区域（考虑 object-fit: contain）
 * @param {Object} videoElement - 视频元素
 * @param {Object} wrapperElement - 包装容器元素
 * @returns {Object} { offsetX, offsetY, widthPct, heightPct, displayWidth, displayHeight }
 */
function getVideoDisplayRect(videoElement, wrapperElement) {
  if (!videoElement || !wrapperElement) {
    return {
      offsetX: 0,
      offsetY: 0,
      widthPct: 100,
      heightPct: 100,
      displayWidth: 0,
      displayHeight: 0,
    }
  }

  const wrapperRect = wrapperElement.getBoundingClientRect()
  const videoRect = videoElement.getBoundingClientRect()

  // 计算视频在 wrapper 中的实际显示区域（百分比）
  const offsetX = ((videoRect.left - wrapperRect.left) / wrapperRect.width) * 100
  const offsetY = ((videoRect.top - wrapperRect.top) / wrapperRect.height) * 100
  const widthPct = (videoRect.width / wrapperRect.width) * 100
  const heightPct = (videoRect.height / wrapperRect.height) * 100

  return {
    offsetX,
    offsetY,
    widthPct,
    heightPct,
    displayWidth: videoRect.width,
    displayHeight: videoRect.height,
  }
}

/**
 * 将坐标从一个视频显示区域转换到另一个
 * @param {Object} source - 源坐标系统 { x, y, width, height, fontSize? }
 * @param {Object} sourceRect - 源视频显示区域
 * @param {Object} targetRect - 目标视频显示区域
 * @returns {Object} 转换后的坐标
 */
function convertCoordinates(source, sourceRect, targetRect) {
  if (!sourceRect || !targetRect) {
    return source
  }

  // 将源坐标从相对于源视频显示区域的百分比转换为相对于源 wrapper 的百分比
  const sourceX = sourceRect.offsetX + (source.x / 100) * sourceRect.widthPct
  const sourceY = sourceRect.offsetY + (source.y / 100) * sourceRect.heightPct
  const sourceWidth = (source.width / 100) * sourceRect.widthPct
  const sourceHeight = (source.height / 100) * sourceRect.heightPct

  // 转换为相对于目标视频显示区域的百分比
  const targetX = ((sourceX - targetRect.offsetX) / targetRect.widthPct) * 100
  const targetY = ((sourceY - targetRect.offsetY) / targetRect.heightPct) * 100
  const targetWidth = (sourceWidth / targetRect.widthPct) * 100
  const targetHeight = (sourceHeight / targetRect.heightPct) * 100

  const result = {
    x: Math.max(0, Math.min(100, targetX)),
    y: Math.max(0, Math.min(100, targetY)),
    width: Math.max(0, Math.min(100, targetWidth)),
    height: Math.max(0, Math.min(100, targetHeight)),
  }

  // 如果有字体大小，需要根据实际像素尺寸缩放
  if (source.fontSize !== undefined && sourceRect.displayWidth && targetRect.displayWidth) {
    const scale = targetRect.displayWidth / sourceRect.displayWidth
    result.fontSize = source.fontSize * scale
  }

  return result
}

module.exports = {
  getVideoDisplayRect,
  convertCoordinates,
}

