# GIF Toolbox Server - 视频转 GIF API

> 适用：小程序上传视频（≤20秒）→ 后端 FFmpeg 生成 GIF → 小程序轮询任务 → 下载结果。

## 1. 基本信息
- Base URL：`https://<你的二级域名>`
- 返回格式：`{ code: number, msg: string, data?: any }`

## 2. 上传视频
### POST `/v1/upload/video`
- Content-Type：`multipart/form-data`
- 表单字段：`file`

响应：
```json
{ "code": 0, "msg": "ok", "data": { "fileId": "xxx" } }
```

curl 示例：
```bash
curl -F "file=@./demo.mp4" http://localhost:3000/v1/upload/video
```

## 3. 创建转码任务
### POST `/v1/tasks/video-to-gif`
Body(JSON)：
```json
{
  "inputFileId": "xxx",
  "startS": 0,
  "endS": 5,
  "fps": 10,
  "width": 480,
  "qualityMode": "HIGH"
}
```

说明：
- `endS - startS <= 20`（强制）
- `qualityMode`：`HIGH | STANDARD`

响应：
```json
{ "code": 0, "msg": "ok", "data": { "taskId": "t_xxx", "status": "QUEUED" } }
```

curl 示例：
```bash
curl -X POST http://localhost:3000/v1/tasks/video-to-gif \
  -H "Content-Type: application/json" \
  -d '{"inputFileId":"xxx","startS":0,"endS":5,"fps":10,"width":480,"qualityMode":"HIGH"}'
```

## 4. 查询任务
### GET `/v1/tasks/:taskId`

响应（成功）：
```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "taskId": "t_xxx",
    "type": "VIDEO_TO_GIF",
    "status": "SUCCESS",
    "progress": 100,
    "result": { "fileId": "f_out_xxx", "downloadUrl": "/v1/files/f_out_xxx" },
    "error": null
  }
}
```

## 5. 下载 GIF
### GET `/v1/files/:fileId`
直接返回文件内容（GIF 为 `image/gif`）。

## 6. 取消任务（可选）
### POST `/v1/tasks/:taskId/cancel`
仅支持取消 `QUEUED` 状态任务。