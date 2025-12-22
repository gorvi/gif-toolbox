const { request, uploadFile } = require('../utils/request')
const { API_BASE_URL } = require('../constants/config')

/**
 * 检查视频转GIF是否支持（后端已支持）
 */
function isVideoToGifSupported() {
  return { supported: true, reason: '' }
}

/**
 * 上传视频文件
 * @param {string} videoPath 本地视频路径
 * @returns {Promise<{fileId: string}>}
 */
function uploadVideo(videoPath) {
  return uploadFile({
    url: '/v1/upload/video',
    filePath: videoPath,
    name: 'file',
  })
}

/**
 * 创建视频转GIF任务
 * @param {Object} options
 * @param {string} options.inputFileId 上传得到的 fileId
 * @param {number} options.startS 开始秒
 * @param {number} options.endS 结束秒
 * @param {number} options.fps 帧率
 * @param {number} options.width 宽度
 * @param {string} [options.qualityMode='HIGH'] 画质模式
 * @param {Object} [options.textConfig] 文字配置
 * @param {Object} [options.cropConfig] 裁剪配置 {x, y, width, height} (0-1)
 * @returns {Promise<{taskId: string, status: string}>}
 */
function createVideoToGifTask(options) {
  const { inputFileId, startS, endS, fps, width, qualityMode = 'HIGH', textConfig, cropConfig } = options || {}
  const data = {
      inputFileId,
      startS,
      endS,
      fps,
      width,
      qualityMode,
  }
  // 如果有文字配置，添加到请求数据中
  if (textConfig && textConfig.content) {
    data.textConfig = textConfig
  }
  // 如果有裁剪配置，添加到请求数据中
  if (cropConfig) {
    data.cropConfig = cropConfig
  }
  return request({
    url: '/v1/tasks/video-to-gif',
    method: 'POST',
    data,
  })
}

/**
 * 查询任务状态
 * @param {string} taskId 任务ID
 * @returns {Promise<{taskId, status, progress, result, error}>}
 */
function getTaskStatus(taskId) {
  return request({
    url: `/v1/tasks/${taskId}`,
    method: 'GET',
  })
}

/**
 * 轮询任务直到完成
 * @param {string} taskId 任务ID
 * @param {(progress: number, status: string) => void} [onProgress] 进度回调
 * @returns {Promise<{fileId: string, downloadUrl: string}>}
 */
function pollTaskUntilDone(taskId, onProgress) {
  return new Promise((resolve, reject) => {
    const maxAttempts = 150 // 最多轮询 5 分钟（2s * 150）
    let attempts = 0

    const poll = () => {
      attempts++
      if (attempts > maxAttempts) {
        reject(new Error('任务超时，请稍后在历史记录中查看'))
        return
      }

      getTaskStatus(taskId)
        .then((task) => {
          if (typeof onProgress === 'function') {
            onProgress(task.progress || 0, task.status)
          }

          if (task.status === 'SUCCESS') {
            if (task.result && task.result.fileId) {
              resolve({
                fileId: task.result.fileId,
                downloadUrl: task.result.downloadUrl || `/v1/files/${task.result.fileId}`,
              })
            } else {
              reject(new Error('任务成功但缺少结果文件'))
            }
          } else if (task.status === 'FAILED') {
            const errorMsg = task.error?.message || '转换失败'
            reject(new Error(errorMsg))
          } else {
            // QUEUED 或 PROCESSING，继续轮询
            setTimeout(poll, 2000) // 2秒后再次查询
          }
        })
        .catch((err) => {
          reject(err)
        })
    }

    poll()
  })
}

/**
 * 下载文件（GIF）- 带重试机制
 * @param {string} fileId 文件ID
 * @param {number} [maxRetries=3] 最大重试次数
 * @returns {Promise<string>} 返回临时文件路径
 */
function downloadFile(fileId, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}/v1/files/${fileId}`
    let retryCount = 0

    const attemptDownload = () => {
      console.log(`[downloadFile] 尝试下载 ${fileId} (第 ${retryCount + 1}/${maxRetries} 次)`)
      
      wx.downloadFile({
        url,
        timeout: 60000, // 60秒超时（GIF文件可能较大）
        success: (res) => {
          console.log('[downloadFile success]', res.statusCode, res.tempFilePath ? '有文件路径' : '无文件路径')
          if (res.statusCode === 200 && res.tempFilePath) {
            resolve(res.tempFilePath)
          } else {
            const errorMsg = `下载失败: HTTP ${res.statusCode || '未知'}`
            console.error('[downloadFile]', errorMsg)
            if (retryCount < maxRetries - 1) {
              retryCount++
              console.log(`[downloadFile] 2秒后重试...`)
              setTimeout(attemptDownload, 2000)
            } else {
              reject(new Error(errorMsg))
            }
          }
        },
        fail: (err) => {
          const errMsg = err.errMsg || '下载失败'
          console.error('[downloadFile fail]', errMsg, err)
          
          // socket hang up 或其他网络错误，尝试重试
          const isRetryable = errMsg.includes('socket hang up') ||
                             errMsg.includes('ECONNRESET') ||
                             errMsg.includes('ECONNREFUSED') ||
                             errMsg.includes('timeout') ||
                             errMsg.includes('Network Error')
          
          if (isRetryable && retryCount < maxRetries - 1) {
            retryCount++
            const delay = (retryCount + 1) * 2000 // 递增延迟：2s, 4s, 6s
            console.log(`[downloadFile] ${delay/1000}秒后重试 (${retryCount + 1}/${maxRetries})...`)
            setTimeout(attemptDownload, delay)
          } else {
            // 不可重试或已达最大重试次数
            if (errMsg.includes('domain list')) {
              reject(new Error('域名不在白名单，请在开发者工具中勾选"不校验合法域名"'))
            } else if (errMsg.includes('socket hang up')) {
              reject(new Error('下载连接中断，可能是网络不稳定或文件过大。请重试。'))
            } else if (errMsg.includes('ECONNRESET') || errMsg.includes('ECONNREFUSED')) {
              reject(new Error('无法连接到后端服务，请检查后端是否正常运行'))
            } else if (errMsg.includes('timeout')) {
              reject(new Error('下载超时，文件可能过大。请稍后重试。'))
            } else {
              reject(new Error(`下载失败: ${errMsg}`))
            }
          }
        },
      })
    }

    attemptDownload()
  })
}

/**
 * 视频转GIF（完整流程）
 * @param {Object} options
 * @param {string} options.videoPath 本地视频路径
 * @param {number} options.startS 开始秒
 * @param {number} options.endS 结束秒
 * @param {number} options.resolutionP 分辨率
 * @param {number} options.fps 帧率
 * @param {Object} [options.textConfig] 文字配置
 * @param {Object} [options.cropConfig] 裁剪配置
 * @param {(progress: number, status: string) => void} [options.onProgress] 进度回调
 * @returns {Promise<{outPath: string}>}
 */
async function convertVideoToGif(options) {
  const { videoPath, startS, endS, resolutionP, fps, textConfig, cropConfig, onProgress } = options || {}

  if (!videoPath) throw new Error('请先选择视频')
  if (typeof startS !== 'number' || typeof endS !== 'number') throw new Error('截取范围不合法')
  if (endS <= startS) throw new Error('截取范围不合法')

  // 1. 上传视频
  if (typeof onProgress === 'function') onProgress(0, '上传中')
  const { fileId: inputFileId } = await uploadVideo(videoPath)

  // 2. 创建任务
  if (typeof onProgress === 'function') onProgress(10, '创建任务')
  const { taskId } = await createVideoToGifTask({
    inputFileId,
    startS,
    endS,
    fps,
    width: resolutionP,
    qualityMode: 'HIGH',
    textConfig,
    cropConfig,
  })

  // 3. 轮询任务
  if (typeof onProgress === 'function') onProgress(20, '处理中')
  const { fileId: outputFileId, downloadUrl } = await pollTaskUntilDone(taskId, (progress, status) => {
    // 将后端进度映射到 20-90%
    const mappedProgress = 20 + (progress * 0.7)
    if (typeof onProgress === 'function') onProgress(mappedProgress, status === 'PROCESSING' ? '处理中' : status)
  })

  // 4. 下载结果
  if (typeof onProgress === 'function') onProgress(90, '下载中')
  const tempFilePath = await downloadFile(outputFileId)

  if (typeof onProgress === 'function') onProgress(100, '完成')

  return { outPath: tempFilePath }
}

module.exports = {
  isVideoToGifSupported,
  convertVideoToGif,
}
