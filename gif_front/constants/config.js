const MAX_CLIP_DURATION_S = 10
const DEFAULT_VIDEO_FPS = 4        // 降低默认帧率，减小GIF大小
const DEFAULT_VIDEO_RESOLUTION_P = 720
const MAX_IMAGE_COUNT = 30
const DEFAULT_FRAME_DELAY_MS = 250
const DEFAULT_GIF_LOOP = 0
const DEFAULT_GIF_MAX_SIDE_PX = 720

// 后端 API 地址配置
// 开发环境（本地直接运行）
// 注意：小程序开发者工具无法访问 localhost，需要使用实际 IP 地址
// 如果后端在本地运行，使用本机 IP（例如：192.168.3.96）
// 如果后端在服务器上，使用服务器 IP
const DEV_API_BASE_URL = 'http://192.168.3.96:3000'

// 生产环境（服务器部署）
const PROD_API_BASE_URL = 'https://api.gif.aiok.site'

/**
 * 自动获取 API 地址
 * 优先级：编译模式环境变量 > 小程序版本类型 > 默认生产环境
 * 
 * 使用说明：
 * 1. 开发版（develop）：自动使用开发环境
 * 2. 体验版（trial）：自动使用生产环境
 * 3. 正式版（release）：自动使用生产环境
 * 4. 编译模式：可通过编译模式设置 __ENV__ 变量强制指定环境
 */
function getApiBaseUrl() {
  // 1. 优先检查编译模式环境变量（开发时手动切换）
  // 可以通过编译模式设置全局变量 __ENV__
  try {
    if (typeof __ENV__ !== 'undefined') {
      const env = String(__ENV__).toLowerCase()
      if (env === 'dev' || env === 'development') {
        console.log('[环境] 编译模式：开发环境', DEV_API_BASE_URL)
        return DEV_API_BASE_URL
      }
      if (env === 'prod' || env === 'production') {
        console.log('[环境] 编译模式：生产环境', PROD_API_BASE_URL)
        return PROD_API_BASE_URL
      }
    }
  } catch (e) {
    // 忽略编译模式检查错误
  }

  // 2. 根据小程序版本类型自动判断
  try {
    const accountInfo = wx.getAccountInfoSync()
    const envVersion = accountInfo.miniProgram.envVersion
    
    console.log('[环境] 小程序版本类型:', envVersion)
    
    switch (envVersion) {
      case 'develop':  // 开发版（开发者工具）
        console.log('[环境] 使用开发环境:', DEV_API_BASE_URL)
        return DEV_API_BASE_URL
      
      case 'trial':    // 体验版
      case 'release':  // 正式版
        console.log('[环境] 使用生产环境:', PROD_API_BASE_URL)
        return PROD_API_BASE_URL
      
      default:
        console.warn('[环境] 未知版本类型，使用生产环境')
        return PROD_API_BASE_URL
    }
  } catch (e) {
    console.error('[环境] 获取版本信息失败，使用生产环境:', e)
    return PROD_API_BASE_URL
  }
}

// 自动获取 API 地址
const API_BASE_URL = getApiBaseUrl()

// 导出环境信息（方便调试）
const ENV_INFO = (() => {
  try {
    const accountInfo = wx.getAccountInfoSync()
    return {
      envVersion: accountInfo.miniProgram.envVersion,
      version: accountInfo.miniProgram.version,
      apiBaseUrl: API_BASE_URL
    }
  } catch (e) {
    return {
      envVersion: 'unknown',
      apiBaseUrl: API_BASE_URL
    }
  }
})()

console.log('[环境配置]', ENV_INFO)

module.exports = {
  MAX_CLIP_DURATION_S,
  DEFAULT_VIDEO_FPS,
  DEFAULT_VIDEO_RESOLUTION_P,
  MAX_IMAGE_COUNT,
  DEFAULT_FRAME_DELAY_MS,
  DEFAULT_GIF_LOOP,
  DEFAULT_GIF_MAX_SIDE_PX,
  API_BASE_URL,
  ENV_INFO,  // 导出环境信息，方便调试
}
