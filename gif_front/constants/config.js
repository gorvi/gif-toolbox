const MAX_CLIP_DURATION_S = 10
const DEFAULT_VIDEO_FPS = 4        // 降低默认帧率，减小GIF大小
const DEFAULT_VIDEO_RESOLUTION_P = 320  // 降低默认分辨率，减小GIF大小
const MAX_IMAGE_COUNT = 30
const DEFAULT_FRAME_DELAY_MS = 250
const DEFAULT_GIF_LOOP = 0
const DEFAULT_GIF_MAX_SIDE_PX = 720

// 后端 API 地址配置
// 开发环境：后端直接运行在本地
// 生产环境：后端部署在服务器（Docker 或其他方式）

// 判断环境：可以通过编译模式或手动设置
// 在微信开发者工具中：编译模式 -> 自定义编译条件 -> 可以设置环境变量
// 或者直接修改下面的值

// 开发环境（本地直接运行）
// 注意：小程序开发者工具无法访问 localhost，需要使用实际 IP 地址
// 如果后端在本地运行，使用本机 IP（例如：192.168.71.117）
// 如果后端在服务器上，使用服务器 IP
const DEV_API_BASE_URL = 'http://192.168.71.117:3001'  // 已自动设置为你的本机 IP
// const DEV_API_BASE_URL = 'http://localhost:3001'  // 如果浏览器测试，可以用这个

// 生产环境（服务器部署，需要替换为实际地址）
const PROD_API_BASE_URL = 'https://api.xxx.com'  // TODO: 替换为你的生产环境地址

// 当前使用的环境（开发/生产切换点）
// 开发时：使用 DEV_API_BASE_URL
// 生产时：使用 PROD_API_BASE_URL
const API_BASE_URL = DEV_API_BASE_URL  // 开发环境
// const API_BASE_URL = PROD_API_BASE_URL  // 生产环境（上线前切换）

module.exports = {
  MAX_CLIP_DURATION_S,
  DEFAULT_VIDEO_FPS,
  DEFAULT_VIDEO_RESOLUTION_P,
  MAX_IMAGE_COUNT,
  DEFAULT_FRAME_DELAY_MS,
  DEFAULT_GIF_LOOP,
  DEFAULT_GIF_MAX_SIDE_PX,
  API_BASE_URL,
}
