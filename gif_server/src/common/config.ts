import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 明确指定 .env 文件路径
// 在开发模式：src/common/config.ts -> ../../.env
// 在编译后：dist/common/config.js -> ../../.env
const envPath = path.resolve(__dirname, '../../.env')
dotenv.config({ path: envPath })

function toInt(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

export const CONFIG = {
  PORT: toInt(process.env.PORT, 3000),
  DATA_DIR: process.env.DATA_DIR || '/data',
  RETENTION_HOURS: toInt(process.env.RETENTION_HOURS, 168),
  MAX_UPLOAD_MB: toInt(process.env.MAX_UPLOAD_MB, 200),
  MAX_CLIP_DURATION_S: toInt(process.env.MAX_CLIP_DURATION_S, 10),
  MAX_LIVE_DURATION_S: toInt(process.env.MAX_LIVE_DURATION_S, 3),
  DEFAULT_FPS: toInt(process.env.DEFAULT_FPS, 10),
  DEFAULT_WIDTH: toInt(process.env.DEFAULT_WIDTH, 480),
  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg', // FFmpeg 可执行文件路径，默认使用系统 PATH
  EXIFTOOL_PATH: process.env.EXIFTOOL_PATH || 'exiftool', // ExifTool 可执行文件路径，用于 Live Photo 元数据
} as const
