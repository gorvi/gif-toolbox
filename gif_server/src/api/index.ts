import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import multer from 'multer'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { CONFIG } from '../common/config.js'
import { all, get, initDb, openDb, run } from '../common/db.js'
import { TASK_STATUS, TASK_TYPE, type FileRow, type TaskRow } from '../common/types.js'

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

const db = openDb()
await initDb(db)

ensureDir(CONFIG.DATA_DIR)
ensureDir(path.join(CONFIG.DATA_DIR, 'uploads'))
ensureDir(path.join(CONFIG.DATA_DIR, 'outputs'))
ensureDir(path.join(CONFIG.DATA_DIR, 'tmp'))

const app = express()

// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now()
  const timestamp = new Date().toISOString()
  
  // 请求完成时记录日志
  res.on('finish', () => {
    const duration = Date.now() - start
    const logMsg = `[${timestamp}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    if (res.statusCode >= 400) {
      console.error(logMsg)
    } else {
      console.log(logMsg)
    }
  })
  
  next()
})

app.use(express.json({ limit: '2mb' }))

app.get('/healthz', (_req, res) => res.json({ ok: true }))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(CONFIG.DATA_DIR, 'uploads')),
    filename: (_req, file, cb) => {
      const id = nanoid()
      const safeExt = path.extname(file.originalname || '') || '.mp4'
      cb(null, `${id}${safeExt}`)
    },
  }),
  limits: {
    fileSize: CONFIG.MAX_UPLOAD_MB * 1024 * 1024,
  },
})

app.post('/v1/upload/video', upload.single('file'), async (req, res) => {
  const f = req.file
  if (!f) return res.status(400).json({ code: 400, msg: '缺少文件' })

  const id = path.parse(f.filename).name
  const now = Date.now()

  const row: FileRow = {
    id,
    kind: 'upload',
    original_name: f.originalname || f.filename,
    mime_type: f.mimetype || 'video/mp4',
    size_bytes: f.size,
    abs_path: f.path,
    created_at_ms: now,
  }

  await run(
    db,
    `INSERT INTO files (id, kind, original_name, mime_type, size_bytes, abs_path, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.kind, row.original_name, row.mime_type, row.size_bytes, row.abs_path, row.created_at_ms],
  )

  res.json({ code: 0, msg: 'ok', data: { fileId: row.id } })
})

const TextConfigSchema = z.object({
  content: z.string(),
  fontSizeNum: z.number().min(12).max(200),
  color: z.string(),
  textOpacity: z.number().min(0).max(100),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  strokeOpacity: z.number().optional(),
  shadowColor: z.string().optional(),
  shadowBlur: z.number().optional(),
  shadowDistance: z.number().optional(),
  shadowAngle: z.number().optional(),
  shadowOpacity: z.number().optional(),
  shadowX: z.number().optional(),
  shadowY: z.number().optional(),
  bgColor: z.string().optional(),
  bgOpacity: z.number().optional(),
}).passthrough().optional()

const CropConfigSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
}).optional()

const CreateVideoToGifSchema = z.object({
  inputFileId: z.string().min(1),
  startS: z.number().min(0),
  endS: z.number().min(0),
  fps: z.number().min(1).max(24).optional(),
  width: z.number().min(120).max(1280).optional(),
  qualityMode: z.enum(['STANDARD', 'HIGH']).optional(),
  textConfig: TextConfigSchema,
  cropConfig: CropConfigSchema,
})

app.post('/v1/tasks/video-to-gif', async (req, res) => {
  const parsed = CreateVideoToGifSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ code: 400, msg: '参数不合法', data: parsed.error.flatten() })
  }

  const { inputFileId, startS, endS } = parsed.data
  const duration = endS - startS
  if (duration <= 0) return res.status(400).json({ code: 400, msg: '截取范围不合法' })
  if (duration > CONFIG.MAX_CLIP_DURATION_S) {
    return res.status(400).json({ code: 400, msg: `最多截取${CONFIG.MAX_CLIP_DURATION_S}秒` })
  }

  const file = await get<FileRow>(db, `SELECT * FROM files WHERE id = ?`, [inputFileId])
  if (!file) return res.status(404).json({ code: 404, msg: '找不到输入文件' })

  const taskId = nanoid()
  const now = Date.now()
  const params: Record<string, any> = {
    startS,
    endS,
    fps: parsed.data.fps ?? CONFIG.DEFAULT_FPS,
    width: parsed.data.width ?? CONFIG.DEFAULT_WIDTH,
    qualityMode: parsed.data.qualityMode ?? 'HIGH',
  }
  
  // 如果有文字配置，添加到参数中
  if (parsed.data.textConfig && parsed.data.textConfig.content) {
    params.textConfig = parsed.data.textConfig
    console.log('[API] 收到文字配置:', parsed.data.textConfig.content)
  }
  
  // 如果有裁剪配置，添加到参数中
  if (parsed.data.cropConfig) {
    params.cropConfig = parsed.data.cropConfig
    console.log('[API] 收到裁剪配置:', parsed.data.cropConfig)
  }

  await run(
    db,
    `INSERT INTO tasks (id, type, status, input_file_id, output_file_id, params_json, progress, error_message, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      TASK_TYPE.VIDEO_TO_GIF,
      TASK_STATUS.QUEUED,
      inputFileId,
      null,
      JSON.stringify(params),
      0,
      null,
      now,
      now,
    ],
  )

  res.json({ code: 0, msg: 'ok', data: { taskId, status: TASK_STATUS.QUEUED } })
})

app.get('/v1/tasks/:taskId', async (req, res) => {
  const taskId = req.params.taskId
  const task = await get<TaskRow>(db, `SELECT * FROM tasks WHERE id = ?`, [taskId])
  if (!task) return res.status(404).json({ code: 404, msg: '任务不存在' })

  let result: any = null
  if (task.status === TASK_STATUS.SUCCESS && task.output_file_id) {
    result = { fileId: task.output_file_id, downloadUrl: `/v1/files/${task.output_file_id}` }
  }

  res.json({
    code: 0,
    msg: 'ok',
    data: {
      taskId: task.id,
      type: task.type,
      status: task.status,
      progress: Math.max(0, Math.min(100, Math.round(task.progress))),
      result,
      error: task.error_message ? { message: task.error_message } : null,
    },
  })
})

app.post('/v1/tasks/:taskId/cancel', async (req, res) => {
  const taskId = req.params.taskId
  const task = await get<TaskRow>(db, `SELECT * FROM tasks WHERE id = ?`, [taskId])
  if (!task) return res.status(404).json({ code: 404, msg: '任务不存在' })
  if (task.status !== TASK_STATUS.QUEUED) {
    return res.status(409).json({ code: 409, msg: '仅支持取消排队中的任务' })
  }
  const now = Date.now()
  await run(
    db,
    `UPDATE tasks SET status = ?, progress = ?, error_message = ?, updated_at_ms = ? WHERE id = ? AND status = ?`,
    ['CANCELED', 0, '用户取消', now, taskId, TASK_STATUS.QUEUED],
  )
  res.json({ code: 0, msg: 'ok', data: { taskId, status: 'CANCELED' } })
})

app.get('/v1/files/:fileId', async (req, res) => {
  const fileId = req.params.fileId
  const file = await get<FileRow>(db, `SELECT * FROM files WHERE id = ?`, [fileId])
  if (!file) return res.status(404).json({ code: 404, msg: '文件不存在' })

  // 检查文件是否存在
  if (!fs.existsSync(file.abs_path)) {
    return res.status(404).json({ code: 404, msg: '文件不存在' })
  }

  // 获取文件信息
  const stats = fs.statSync(file.abs_path)
  const fileSize = stats.size

  // 设置响应头
  res.setHeader('Content-Type', 'image/gif')
  res.setHeader('Content-Length', fileSize)
  res.setHeader('Content-Disposition', `inline; filename="${file.original_name || 'output.gif'}"`)
  res.setHeader('Cache-Control', 'public, max-age=3600')

  // 使用流式传输，避免大文件占用过多内存
  const fileStream = fs.createReadStream(file.abs_path)

  // 错误处理
  fileStream.on('error', (err) => {
    console.error('[file download error]', err)
    if (!res.headersSent) {
      res.status(500).json({ code: 500, msg: '文件读取失败' })
    } else {
      res.end()
    }
  })

  // 连接中断处理
  req.on('close', () => {
    if (!fileStream.destroyed) {
      fileStream.destroy()
    }
  })

  // 将文件流传输到响应
  fileStream.pipe(res)
})

app.get('/v1/tasks', async (req, res) => {
  const rows = await all<TaskRow>(db, `SELECT * FROM tasks ORDER BY created_at_ms DESC LIMIT 50`)
  res.json({ code: 0, msg: 'ok', data: rows.map((t) => ({ id: t.id, status: t.status, progress: t.progress })) })
})

// 启动服务器并设置超时时间（120秒，用于大文件下载）
const server = app.listen(CONFIG.PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on 0.0.0.0:${CONFIG.PORT}`)
})

// 设置服务器超时时间
server.timeout = 120000