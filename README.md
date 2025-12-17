# GIF Toolbox - 视频转GIF工具

一个完整的视频转GIF解决方案，包含微信小程序前端和Node.js后端服务。

## 项目结构

```
gif/
├── gif_front/          # 微信小程序前端
│   ├── pages/          # 页面
│   ├── services/       # API服务
│   └── utils/          # 工具函数
└── gif_server/         # Node.js + TypeScript 后端
    ├── src/            # 源代码
    ├── docker/         # Docker配置
    └── docs/           # 文档
```

## 功能特性

- ✅ 视频转GIF（支持≤20秒视频）
- ✅ 视频裁剪（支持多种比例：1:1, 4:3, 16:9等）
- ✅ 文字叠加（支持描边、阴影、背景等样式）
- ✅ 可调节分辨率（160p-720p）
- ✅ 可调节帧率（1-10 FPS）
- ✅ 视频片段选择（0.1-10秒）

## 快速开始

### 后端服务

进入 `gif_server` 目录：

```bash
cd gif_server
docker compose up -d --build
```

API 默认监听：`http://localhost:3001`

### 前端小程序

1. 使用微信开发者工具打开 `gif_front` 目录
2. 配置后端API地址（`gif_front/constants/config.js`）
3. 在开发者工具中设置：不校验合法域名
4. 编译运行

## 核心接口

- `POST /v1/upload/video`：上传视频
- `POST /v1/tasks/video-to-gif`：创建转码任务
- `GET /v1/tasks/:taskId`：查询任务状态
- `GET /v1/files/:fileId`：下载GIF文件

## 技术栈

**前端：**
- 微信小程序
- JavaScript

**后端：**
- Node.js + TypeScript
- Express
- FFmpeg
- SQLite

## 数据目录

后端 `./data` 目录：
- `/data/uploads`：上传文件
- `/data/outputs`：产物 GIF
- `/data/tmp`：临时文件
- `/data/db/app.sqlite3`：SQLite 数据库

## 许可证

MIT
