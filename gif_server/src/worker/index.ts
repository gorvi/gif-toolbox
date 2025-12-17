import path from 'node:path'
import fs from 'node:fs'
import { nanoid } from 'nanoid'

import { CONFIG } from '../common/config.js'
import { get, initDb, openDb, run, all } from '../common/db.js'
import { TASK_STATUS, TASK_TYPE, type FileRow, type TaskRow } from '../common/types.js'
import { convertVideoToGifWithFfmpeg } from './ffmpeg.js'
import { cleanupExpired } from './cleanup.js'

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

const db = openDb()
await initDb(db)

ensureDir(CONFIG.DATA_DIR)
ensureDir(path.join(CONFIG.DATA_DIR, 'uploads'))
ensureDir(path.join(CONFIG.DATA_DIR, 'outputs'))
ensureDir(path.join(CONFIG.DATA_DIR, 'tmp'))

async function claimOneQueuedTask(): Promise<TaskRow | null> {
  const row = await get<TaskRow>(
    db,
    `SELECT * FROM tasks WHERE status = ? AND type = ? ORDER BY created_at_ms ASC LIMIT 1`,
    [TASK_STATUS.QUEUED, TASK_TYPE.VIDEO_TO_GIF],
  )
  if (!row) return null

  const now = Date.now()
  // CAS update: only claim if still queued
  await run(
    db,
    `UPDATE tasks SET status = ?, progress = ?, updated_at_ms = ? WHERE id = ? AND status = ?`,
    [TASK_STATUS.PROCESSING, 1, now, row.id, TASK_STATUS.QUEUED],
  )

  const claimed = await get<TaskRow>(db, `SELECT * FROM tasks WHERE id = ?`, [row.id])
  if (!claimed || claimed.status !== TASK_STATUS.PROCESSING) return null
  return claimed
}

async function setTaskFailed(taskId: string, message: string) {
  const now = Date.now()
  await run(
    db,
    `UPDATE tasks SET status = ?, progress = ?, error_message = ?, updated_at_ms = ? WHERE id = ?`,
    [TASK_STATUS.FAILED, 0, message.slice(0, 1500), now, taskId],
  )
}

async function setTaskProgress(taskId: string, progress: number) {
  const now = Date.now()
  await run(db, `UPDATE tasks SET progress = ?, updated_at_ms = ? WHERE id = ?`, [progress, now, taskId])
}

async function setTaskSuccess(taskId: string, outputFileId: string) {
  const now = Date.now()
  await run(
    db,
    `UPDATE tasks SET status = ?, progress = ?, output_file_id = ?, updated_at_ms = ? WHERE id = ?`,
    [TASK_STATUS.SUCCESS, 100, outputFileId, now, taskId],
  )
}

async function processVideoToGif(task: TaskRow) {
  const params = JSON.parse(task.params_json) as {
    startS: number
    endS: number
    fps: number
    width: number
    qualityMode: 'STANDARD' | 'HIGH'
    textConfig?: {
      content: string
      fontSizeNum: number
      color: string
      textOpacity: number
      x: number
      y: number
      strokeColor?: string
      strokeWidth?: number
      shadowColor?: string
      shadowBlur?: number
      shadowDistance?: number
      bgColor?: string
    }
    cropConfig?: {
      x: number
      y: number
      width: number
      height: number
    }
  }

  const duration = params.endS - params.startS
  if (duration <= 0) throw new Error('截取范围不合法')
  if (duration > CONFIG.MAX_CLIP_DURATION_S) throw new Error(`最多截取${CONFIG.MAX_CLIP_DURATION_S}秒`)

  const input = await get<FileRow>(db, `SELECT * FROM files WHERE id = ?`, [task.input_file_id])
  if (!input) throw new Error('找不到输入文件')

  const outId = nanoid()
  const outPath = path.join(CONFIG.DATA_DIR, 'outputs', `${outId}.gif`)
  const tmpDir = path.join(CONFIG.DATA_DIR, 'tmp')

  console.log('[worker] 处理任务:', task.id, '文字配置:', params.textConfig ? '有' : '无', '裁剪配置:', params.cropConfig ? '有' : '无')

  await setTaskProgress(task.id, 10)
  await convertVideoToGifWithFfmpeg({
    inputPath: input.abs_path,
    outputPath: outPath,
    startS: params.startS,
    endS: params.endS,
    fps: params.fps,
    width: params.width,
    qualityMode: params.qualityMode,
    tmpDir,
    textConfig: params.textConfig,
    cropConfig: params.cropConfig,
  })
  await setTaskProgress(task.id, 90)

  const st = fs.statSync(outPath)
  const now = Date.now()
  const outputRow: FileRow = {
    id: outId,
    kind: 'output',
    original_name: `${outId}.gif`,
    mime_type: 'image/gif',
    size_bytes: st.size,
    abs_path: outPath,
    created_at_ms: now,
  }
  await run(
    db,
    `INSERT INTO files (id, kind, original_name, mime_type, size_bytes, abs_path, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      outputRow.id,
      outputRow.kind,
      outputRow.original_name,
      outputRow.mime_type,
      outputRow.size_bytes,
      outputRow.abs_path,
      outputRow.created_at_ms,
    ],
  )

  await setTaskSuccess(task.id, outId)
}

async function mainLoop() {
  while (true) {
    const task = await claimOneQueuedTask()
    if (!task) {
      await new Promise((r) => setTimeout(r, 800))
      continue
    }
    try {
      await processVideoToGif(task)
    } catch (e: any) {
      await setTaskFailed(task.id, e?.message || '转码失败')
    }
  }
}

// 定时清理：每 30 分钟一次（根据 RETENTION_HOURS）
setInterval(() => {
  cleanupExpired(db).catch(() => {})
}, 30 * 60 * 1000)

// 启动时先清理一次
cleanupExpired(db).catch(() => {})

// eslint-disable-next-line no-console
console.log('[worker] started')

await mainLoop()