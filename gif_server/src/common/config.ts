import dotenv from 'dotenv'

dotenv.config()

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
  DEFAULT_FPS: toInt(process.env.DEFAULT_FPS, 10),
  DEFAULT_WIDTH: toInt(process.env.DEFAULT_WIDTH, 480),
} as const