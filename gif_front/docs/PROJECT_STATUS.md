# 项目状态文档

> 本文档记录项目的当前状态、已知问题、配置信息等，方便新对话快速了解项目。

## 项目结构

```
workspace_weixin_miniprogram/
├── gif/                    # 微信小程序前端
│   ├── pages/              # 页面
│   ├── services/            # 业务逻辑
│   ├── utils/              # 工具函数
│   ├── constants/          # 常量配置
│   └── .cursorrules        # 前端开发规则（只改 gif/ 目录）
│
└── gif_server/             # Node.js 后端服务
    ├── src/
    │   ├── api/            # API 服务器
    │   ├── worker/         # 后台任务处理
    │   └── common/         # 公共代码
    └── .cursorrules        # 后端开发规则（只改 gif_server/ 目录）
```

## 当前配置

### 前端配置 (`gif/constants/config.js`)

- **开发环境 API 地址**: `http://192.168.71.117:3001`
- **生产环境 API 地址**: `https://api.xxx.com` (待配置)
- **当前使用**: 开发环境

### 后端配置 (`gif_server/src/common/config.ts`)

- **端口**: 3001
- **监听地址**: `0.0.0.0:3001` (允许从 IP 访问)
- **数据目录**: `/data` (开发环境可能不同)

## 已知问题

### 1. 下载文件时出现 `socket hang up` 错误

**状态**: ✅ 已修复

**前端优化**:
- ✅ 添加了重试机制（最多3次）
- ✅ 增加超时时间到60秒
- ✅ 优化了错误提示

**后端优化** (2025-12-16):
- ✅ 设置正确的响应头（Content-Type、Content-Length、Content-Disposition）
- ✅ 使用流式传输，避免大文件占用过多内存
- ✅ 增加服务器超时时间到120秒
- ✅ 添加文件读取错误处理
- ✅ 添加连接中断处理

### 2. 后端连接问题

**状态**: 已解决（需要开发者工具设置）

**解决方案**:
- 微信开发者工具 → 详情 → 本地设置 → 勾选"不校验合法域名"

### 3. 任务一直处于 QUEUED 状态，不处理

**状态**: ⚠️ 需要启动 Worker 服务

**原因**:
- Worker 服务没有启动
- Worker 负责处理队列中的任务，必须单独启动

**解决方案**:
1. 在 `gif_server` 目录下启动 Worker 服务：
   ```bash
   npm run start:worker
   ```
   或开发模式（自动重新编译）：
   ```bash
   npm run dev:worker
   ```
2. 确保看到 `[worker] started` 日志
3. **重要**：需要同时运行 API 服务和 Worker 服务（两个终端窗口）

**注意**：
- API 服务：处理 HTTP 请求（上传、查询任务状态等）
- Worker 服务：处理实际的任务（视频转 GIF）
- 两者必须同时运行，缺一不可

## 开发规则

### 前端开发 (`gif/.cursorrules`)

- **工作范围**: 只修改 `gif/` 目录
- **不修改**: `gif_server/` 目录
- **命名规范**: 常量大写+下划线，函数小驼峰

### 后端开发 (`gif_server/.cursorrules`)

- **工作范围**: 只修改 `gif_server/` 目录
- **不修改**: `gif/` 目录
- **技术栈**: Node.js + TypeScript + Express + FFmpeg

## 快速开始

### 前端开发

```bash
cd gif
# 在微信开发者工具中打开此目录
```

### 后端开发

```bash
cd gif_server
npm install
npm run build

# 需要启动两个服务（两个终端窗口）：
# 终端1：API 服务
npm run dev:api  # 或 npm run start:api

# 终端2：Worker 服务（处理任务）
npm run dev:worker  # 或 npm run start:worker
```

## 重要文件位置

- 前端 API 配置: `gif/constants/config.js`
- 前端请求封装: `gif/utils/request.js`
- 视频转GIF服务: `gif/services/video-to-gif.js`
- 后端 API 入口: `gif_server/src/api/index.ts`
- 后端 Worker 服务: `gif_server/src/worker/index.ts`（**必须启动**）
- 后端文件下载: `gif_server/src/api/index.ts` (第166-208行)

## 界面重设计任务（GIF编辑相关）

目标：以“项目式编辑工作流”统一 GIF 编辑体验，整体升级为苹果毛玻璃风格，并预留旋转/缩放扩展。

### 验收标准

- 首页信息层级清晰：主入口突出（导入/继续编辑），工具分组明确，卡片统一毛玻璃风格。
- 编辑页统一工作流：预览区 + 操作切换 + 底部参数面板结构稳定，交互不遮挡核心预览。
- 旋转/缩放具备可见入口与占位面板，后续可直接接入真实处理逻辑。
- 现有可用功能入口不丢失（视频转 GIF、图片转 GIF、GIF 压缩、GIF 加字、GIF 编辑）。

### 任务清单（完成即更新状态）

| ID | 任务 | 状态 |
|---|---|---|
| UI-01 | 创建任务文档与验收标准 | ✅ 已完成 |
| UI-02 | 首页毛玻璃风格与工具卡片重布局 | ✅ 已完成 |
| UI-03 | 统一 GIF 编辑页壳与参数面板框架（视觉/布局） | ✅ 已完成 |
| UI-04 | 增加旋转与缩放入口与占位交互 | ✅ 已完成 |
| UI-05 | 运行项目现有检查与构建命令确保通过 | ✅ 已完成 |

## 最近修改

- 2025-12-16: 更新启动说明，强调 Worker 服务必须启动
- 2025-12-16: 优化后端文件下载接口（设置响应头、流式传输、超时处理）
- 2025-12-16: 优化下载函数，添加重试机制
- 2025-12-16: 修复响应格式兼容性问题
- 2025-12-16: 增强错误提示和日志
