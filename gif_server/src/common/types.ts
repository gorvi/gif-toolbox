export const TASK_TYPE = {
  VIDEO_TO_GIF: 'VIDEO_TO_GIF',
  VIDEO_TO_LIVE: 'VIDEO_TO_LIVE',
} as const

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE]

export const TASK_STATUS = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
} as const

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS]

export type FileRow = {
  id: string
  kind: 'upload' | 'output'
  original_name: string
  mime_type: string
  size_bytes: number
  abs_path: string
  created_at_ms: number
}

export type TaskRow = {
  id: string
  type: TaskType
  status: TaskStatus
  input_file_id: string
  output_file_id: string | null
  params_json: string
  progress: number
  error_message: string | null
  created_at_ms: number
  updated_at_ms: number
}
