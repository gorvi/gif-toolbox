# GIF Toolbox Server（Node.js + TypeScript + FFmpeg）

本目录为后端（方案1：云端转码）代码，配合小程序实现 **视频转GIF**（≤20秒）。

## 运行方式（本地/服务器通用）

### 1) 复制配置（可选）
将 `env.example` 作为参考，在运行环境里设置环境变量：
- 测试：`RETENTION_HOURS=168`（7天）
- 生产：`RETENTION_HOURS=48`（48小时）

### 2) Docker Compose 启动
在本目录执行：

```bash
docker compose up -d --build
```

API 默认监听：`http://localhost:3000`

### 3) 核心接口
- `POST /v1/upload/video`：上传视频（multipart/form-data，字段名 `file`）
- `POST /v1/tasks/video-to-gif`：创建转码任务
- `GET /v1/tasks/:taskId`：查询任务（轮询）
- `GET /v1/files/:fileId`：下载文件（GIF）
- `POST /v1/tasks/:taskId/cancel`：取消排队任务（可选）

## 数据目录
`./data` 会映射到容器内 `/data`：
- `/data/uploads`：上传文件
- `/data/outputs`：产物 GIF
- `/data/tmp`：临时文件
- `/data/db/app.sqlite3`：SQLite 数据库