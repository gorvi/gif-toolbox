const { API_BASE_URL } = require('../constants/config')

/**
 * 网络请求封装
 * @param {Object} options
 * @param {string} options.url 请求路径（相对路径）
 * @param {string} [options.method='GET'] 请求方法
 * @param {Object} [options.data] 请求数据（JSON）
 * @param {Object} [options.header] 请求头
 * @returns {Promise<any>}
 */
function request(options) {
  const { url, method = 'GET', data, header = {} } = options || {}
  if (!url) return Promise.reject(new Error('缺少 url 参数'))

  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`

  // 调试日志
  console.log('[request]', method, fullUrl, data)

  return new Promise((resolve, reject) => {
    wx.request({
      url: fullUrl,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...header,
      },
      success: (res) => {
        console.log('[request success]', res.statusCode, res.data)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 兼容两种响应格式：
          // 1. 标准格式：{ code: 0, msg: 'ok', data: {...} }
          // 2. 简单格式：{ ok: true } 或其他直接返回的数据
          if (res.data && typeof res.data === 'object') {
            if (res.data.code === 0) {
              // 标准格式，返回 data 字段
              resolve(res.data.data)
            } else if (res.data.ok === true || res.data.code === undefined) {
              // 简单格式（如 /healthz），直接返回整个对象
              resolve(res.data)
            } else {
              // 有 code 但不是 0，说明是错误
              reject(new Error(res.data.msg || `请求失败: code=${res.data.code}`))
            }
          } else {
            // 非对象响应，直接返回
            resolve(res.data)
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.data?.msg || '请求失败'}`))
        }
      },
      fail: (err) => {
        console.error('[request fail]', err)
        const errMsg = err.errMsg || '网络请求失败'
        // 提供更详细的错误信息
        if (errMsg.includes('domain list') || errMsg.includes('不在白名单')) {
          reject(new Error('域名不在白名单，请在开发者工具中勾选"不校验合法域名"'))
        } else if (errMsg.includes('ECONNREFUSED') || errMsg.includes('connect') || errMsg.includes('refused')) {
          reject(new Error(`无法连接到后端服务 ${API_BASE_URL}，请确认：\n1. 后端服务已启动\n2. 端口是否正确\n3. 真机调试时请使用服务器IP而非localhost`))
        } else if (errMsg.includes('Network Error') || errMsg.includes('timeout')) {
          reject(new Error(`网络错误，请检查后端服务是否运行在 ${API_BASE_URL}`))
        } else {
          reject(new Error(`${errMsg}\n后端地址: ${API_BASE_URL}`))
        }
      },
    })
  })
}

/**
 * 上传文件
 * @param {Object} options
 * @param {string} options.url 上传接口路径
 * @param {string} options.filePath 本地文件路径
 * @param {string} options.name form-data 字段名（默认 'file'）
 * @param {Object} [options.formData] 额外 form-data
 * @returns {Promise<any>}
 */
function uploadFile(options) {
  const { url, filePath, name = 'file', formData = {} } = options || {}
  if (!url || !filePath) return Promise.reject(new Error('缺少 url 或 filePath 参数'))

  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`

  // 调试日志
  console.log('[uploadFile]', fullUrl, filePath)

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: fullUrl,
      filePath,
      name,
      formData,
      success: (res) => {
        console.log('[uploadFile success]', res.statusCode, res.data)
        // 检查状态码
        if (res.statusCode && res.statusCode !== 200) {
          reject(new Error(`上传失败: HTTP ${res.statusCode}`))
          return
        }
        try {
          const data = JSON.parse(res.data || '{}')
          if (data.code === 0) {
            resolve(data.data)
          } else {
            reject(new Error(data.msg || `上传失败: code=${data.code}`))
          }
        } catch (e) {
          // 如果解析失败，可能是非JSON响应
          console.error('[uploadFile parse error]', e, res.data)
          reject(new Error(`解析响应失败: ${e.message || '响应格式错误'}`))
        }
      },
      fail: (err) => {
        console.error('[uploadFile fail]', err)
        // 提供更详细的错误信息
        const errMsg = err.errMsg || '上传失败'
        if (errMsg.includes('domain list')) {
          reject(new Error('域名不在白名单，请在开发者工具中勾选"不校验合法域名"'))
        } else if (errMsg.includes('ECONNREFUSED') || errMsg.includes('connect')) {
          reject(new Error(`无法连接到后端服务 ${API_BASE_URL}，请确认：\n1. 后端服务已启动\n2. 端口是否正确\n3. 真机调试时请使用服务器IP而非localhost`))
        } else if (errMsg.includes('Network Error')) {
          reject(new Error(`网络错误，请检查后端服务是否运行在 ${API_BASE_URL}`))
        } else {
          reject(new Error(errMsg))
        }
      },
    })
  })
}

module.exports = {
  request,
  uploadFile,
}

