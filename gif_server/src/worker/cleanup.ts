import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../common/config.js'
import { all, run, type Db } from '../common/db.js'
import { TASK_STATUS, type TaskRow } from '../common/types.js'

function safeUnlink(p: string) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch (e) {}
}

export async function cleanupExpired(db: Db): Promise<void> {
  const now = Date.now()
  const expireMs = CONFIG.RETENTION_HOURS * 3600 * 1000
  const threshold = now - expireMs

  const doneStatuses = [TASK_STATUS.SUCCESS, TASK_STATUS.FAILED, TASK_STATUS.CANCELED]
  const tasks = await all<TaskRow>(
    db,
    `SELECT * FROM tasks WHERE status IN (?, ?, ?) AND updated_at_ms < ? LIMIT 200`,
    [doneStatuses[0], doneStatuses[1], doneStatuses[2], threshold],
  )

  if (!tasks.length) return

  for (const t of tasks) {
    // delete output file if exists
    if (t.output_file_id) {
      const row = await all<{ abs_path: string }>(db, `SELECT abs_path FROM files WHERE id = ?`, [t.output_file_id])
      if (row[0]?.abs_path) safeUnlink(row[0].abs_path)
      await run(db, `DELETE FROM files WHERE id = ?`, [t.output_file_id])
    }
    // delete input upload file too
    {
      const row = await all<{ abs_path: string }>(db, `SELECT abs_path FROM files WHERE id = ?`, [t.input_file_id])
      if (row[0]?.abs_path) safeUnlink(row[0].abs_path)
      await run(db, `DELETE FROM files WHERE id = ?`, [t.input_file_id])
    }
    await run(db, `DELETE FROM tasks WHERE id = ?`, [t.id])
  }

  // best-effort cleanup tmp dir old files
  try {
    const tmpDir = path.join(CONFIG.DATA_DIR, 'tmp')
    const files = fs.readdirSync(tmpDir)
    for (const name of files) {
      const p = path.join(tmpDir, name)
      const st = fs.statSync(p)
      if (st.isFile() && st.mtimeMs < threshold) safeUnlink(p)
    }
  } catch (e) {}
}