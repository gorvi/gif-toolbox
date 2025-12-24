const { request, uploadFile } = require('../utils/request')
const { API_BASE_URL } = require('../constants/config')

function isVideoToLiveSupported() {
  return { supported: true, reason: '' }
}

function uploadVideo(videoPath) {
  return uploadFile({
    url: '/v1/upload/video',
    filePath: videoPath,
    name: 'file',
  })
}

function createVideoToLiveTask(options) {
  const { inputFileId, startS, endS, width, keepAudio, qualityMode = 'HIGH' } = options || {}
  const data = {
    inputFileId,
    startS,
    endS,
    width,
    keepAudio,
    qualityMode,
  }
  return request({
    url: '/v1/tasks/video-to-live',
    method: 'POST',
    data,
  })
}

function getTaskStatus(taskId) {
  return request({
    url: `/v1/tasks/${taskId}`,
    method: 'GET',
  })
}

function pollTaskUntilDone(taskId, onProgress) {
  return new Promise((resolve, reject) => {
    const maxAttempts = 150
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
            // Live Photo 返回两个文件：图片和视频
            if (task.result && (task.result.videoFileId || task.result.fileId)) {
              resolve({
                videoFileId: task.result.videoFileId || task.result.fileId,
                videoDownloadUrl: task.result.videoDownloadUrl || task.result.downloadUrl || `/v1/files/${task.result.videoFileId || task.result.fileId}`,
                imageFileId: task.result.imageFileId || null,
                imageDownloadUrl: task.result.imageDownloadUrl || null,
              })
            } else {
              reject(new Error('任务成功但缺少结果文件'))
            }
          } else if (task.status === 'FAILED') {
            const errorMsg = task.error?.message || '转换失败'
            reject(new Error(errorMsg))
          } else {
            setTimeout(poll, 2000)
          }
        })
        .catch((err) => reject(err))
    }

    poll()
  })
}

function downloadFile(fileId, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}/v1/files/${fileId}`
    let retryCount = 0

    const attemptDownload = () => {
      wx.downloadFile({
        url,
        timeout: 60000,
        success: (res) => {
          if (res.statusCode === 200 && res.tempFilePath) {
            resolve(res.tempFilePath)
          } else {
            const errorMsg = `下载失败: HTTP ${res.statusCode || '未知'}`
            if (retryCount < maxRetries - 1) {
              retryCount++
              setTimeout(attemptDownload, 2000)
            } else {
              reject(new Error(errorMsg))
            }
          }
        },
        fail: (err) => {
          const errMsg = err.errMsg || '下载失败'
          const isRetryable =
            errMsg.includes('socket hang up') ||
            errMsg.includes('ECONNRESET') ||
            errMsg.includes('ECONNREFUSED') ||
            errMsg.includes('timeout') ||
            errMsg.includes('Network Error')
          if (isRetryable && retryCount < maxRetries - 1) {
            retryCount++
            setTimeout(attemptDownload, 2000)
            return
          }
          reject(new Error(errMsg))
        },
      })
    }

    attemptDownload()
  })
}

function normalizeApiBaseUrl(baseUrl) {
  const s = String(baseUrl || '').trim()
  if (!s) return ''
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function getAltApiBaseUrl() {
  const baseUrl = normalizeApiBaseUrl(API_BASE_URL)
  const m = baseUrl.match(/^(https?:\/\/)([^/:]+)(?::(\d+))?/i)
  if (!m) return ''

  const proto = m[1]
  const host = m[2]
  const port = Number(m[3] || '')
  if (!Number.isFinite(port)) return ''

  if (port === 3000) return `${proto}${host}:3001`
  if (port === 3001) return `${proto}${host}:3000`
  return ''
}

async function convertVideoToLiveWithBase(baseUrl, options) {
  const apiBaseUrl = normalizeApiBaseUrl(baseUrl)
  const { videoPath, startS, endS, resolutionP, keepAudio, qualityMode, onProgress } = options || {}

  if (typeof onProgress === 'function') onProgress(0, '上传中')
  const { fileId: inputFileId } = await uploadFile({
    url: `${apiBaseUrl}/v1/upload/video`,
    filePath: videoPath,
    name: 'file',
  })

  if (typeof onProgress === 'function') onProgress(10, '创建任务')
  const createRes = await request({
    url: `${apiBaseUrl}/v1/tasks/video-to-live`,
    method: 'POST',
    data: {
      inputFileId,
      startS,
      endS,
      width: resolutionP,
      keepAudio,
      qualityMode: qualityMode || 'HIGH',
    },
  })
  const taskId = createRes && createRes.taskId
  if (!taskId) throw new Error('创建任务失败：缺少 taskId')

  if (typeof onProgress === 'function') onProgress(20, '处理中')
  const { videoFileId, videoDownloadUrl, imageFileId, imageDownloadUrl } = await new Promise((resolve, reject) => {
    const maxAttempts = 150
    let attempts = 0

    const poll = () => {
      attempts++
      if (attempts > maxAttempts) {
        reject(new Error('任务超时，请稍后在历史记录中查看'))
        return
      }

      request({ url: `${apiBaseUrl}/v1/tasks/${taskId}`, method: 'GET' })
        .then((task) => {
          if (typeof onProgress === 'function') {
            const mappedProgress = 20 + ((task.progress || 0) * 0.7)
            onProgress(mappedProgress, task.status === 'PROCESSING' ? '处理中' : task.status)
          }

          if (task.status === 'SUCCESS') {
            // Live Photo 返回两个文件：图片和视频
            if (task.result && (task.result.videoFileId || task.result.fileId)) {
              resolve({
                videoFileId: task.result.videoFileId || task.result.fileId,
                videoDownloadUrl: task.result.videoDownloadUrl || task.result.downloadUrl || `/v1/files/${task.result.videoFileId || task.result.fileId}`,
                imageFileId: task.result.imageFileId || null,
                imageDownloadUrl: task.result.imageDownloadUrl || null,
              })
              return
            }
            reject(new Error('任务成功但缺少结果文件'))
            return
          }

          if (task.status === 'FAILED') {
            const errorMsg = task.error?.message || '转换失败'
            reject(new Error(errorMsg))
            return
          }

          setTimeout(poll, 2000)
        })
        .catch((err) => reject(err))
    }

    poll()
  })

  if (typeof onProgress === 'function') onProgress(90, '下载中')
  
  // 下载视频文件
  const videoFilePath = await new Promise((resolve, reject) => {
    const url = `${apiBaseUrl}${videoDownloadUrl}`
    let retryCount = 0

    const attemptDownload = () => {
      wx.downloadFile({
        url,
        timeout: 60000,
        success: (res) => {
          if (res.statusCode === 200 && res.tempFilePath) {
            resolve(res.tempFilePath)
          } else {
            const errorMsg = `下载失败: HTTP ${res.statusCode || '未知'}`
            if (retryCount < 2) {
              retryCount++
              setTimeout(attemptDownload, 2000)
            } else {
              reject(new Error(errorMsg))
            }
          }
        },
        fail: (err) => {
          const errMsg = err.errMsg || '下载失败'
          const isRetryable =
            errMsg.includes('socket hang up') ||
            errMsg.includes('ECONNRESET') ||
            errMsg.includes('ECONNREFUSED') ||
            errMsg.includes('timeout') ||
            errMsg.includes('Network Error')
          if (isRetryable && retryCount < 2) {
            retryCount++
            setTimeout(attemptDownload, 2000)
            return
          }
          reject(new Error(errMsg))
        },
      })
    }

    attemptDownload()
  })

  // 下载图片文件（如果存在）
  let imagePath = null
  if (imageFileId && imageDownloadUrl) {
    try {
      imagePath = await new Promise((resolve, reject) => {
        const url = `${apiBaseUrl}${imageDownloadUrl}`
        let retryCount = 0

        const attemptDownload = () => {
          wx.downloadFile({
            url,
            timeout: 60000,
            success: (res) => {
              if (res.statusCode === 200 && res.tempFilePath) {
                resolve(res.tempFilePath)
              } else {
                const errorMsg = `下载图片失败: HTTP ${res.statusCode || '未知'}`
                if (retryCount < 2) {
                  retryCount++
                  setTimeout(attemptDownload, 2000)
                } else {
                  reject(new Error(errorMsg))
                }
              }
            },
            fail: (err) => {
              const errMsg = err.errMsg || '下载图片失败'
              if (retryCount < 2) {
                retryCount++
                setTimeout(attemptDownload, 2000)
              } else {
                reject(new Error(errMsg))
              }
            },
          })
        }

        attemptDownload()
      })
    } catch (e) {
      console.warn('下载图片失败，仅保存视频:', e)
    }
  }

  if (typeof onProgress === 'function') onProgress(100, '完成')
  return { 
    outPath: videoFilePath,  // 视频路径（主要输出）
    videoPath: videoFilePath,
    imagePath: imagePath,  // 图片路径（可选）
  }
}

async function convertVideoToLive(options) {
  const { videoPath, startS, endS, resolutionP, keepAudio, qualityMode, onProgress } = options || {}

  if (!videoPath) throw new Error('请先选择视频')
  if (typeof startS !== 'number' || typeof endS !== 'number') throw new Error('截取范围不合法')
  if (endS <= startS) throw new Error('截取范围不合法')
  try {
    return await convertVideoToLiveWithBase(API_BASE_URL, {
      videoPath,
      startS,
      endS,
      resolutionP,
      keepAudio,
      qualityMode,
      onProgress,
    })
  } catch (e) {
    const msg = String((e && (e.message || e.errMsg)) || '')
    if (msg.includes('HTTP 404') || msg.includes('Cannot POST') || msg.includes('/v1/tasks/video-to-live')) {
      const altBase = getAltApiBaseUrl()
      if (altBase) {
        try {
          return await convertVideoToLiveWithBase(altBase, {
            videoPath,
            startS,
            endS,
            resolutionP,
            keepAudio,
            qualityMode,
            onProgress,
          })
        } catch (e2) {}
      }
      throw new Error(
        `后端未支持“视频转Live”，请更新并重启后端 API（包含 /v1/tasks/video-to-live 路由）。当前后端地址：${normalizeApiBaseUrl(API_BASE_URL)}${
          altBase ? `（已尝试：${altBase}）` : ''
        }`,
      )
    }
    throw e
  }
}

module.exports = {
  isVideoToLiveSupported,
  convertVideoToLive,
}
