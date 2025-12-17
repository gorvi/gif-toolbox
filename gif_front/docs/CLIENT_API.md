# 端侧“接口”文档（模块边界）

> 本项目不依赖后端，接口指：页面调用的端侧 service / utils 的函数契约。

## 1. 常量（`constants/`）
### 1.1 `constants/config.js`
- `MAX_CLIP_DURATION_S`: number，视频最大截取秒数（固定 20）
- `DEFAULT_VIDEO_FPS`: number，默认帧率（5）
- `DEFAULT_VIDEO_RESOLUTION_P`: number，默认分辨率（480）

### 1.2 `constants/enums.js`
- `TASK_STATUS`: 端侧处理状态枚举

## 2. 媒体选择（`utils/media.js`）
### 2.1 `chooseSingleVideo() => Promise<{ tempFilePath, duration, size, width, height }>`
用途：从相册/相机选择一个视频。
失败：reject（用户取消/权限/系统错误）。

## 3. 时间格式（`utils/time.js`）
### 3.1 `formatHms(totalSeconds:number) => string`
返回 `HH:MM:SS`。

## 4. 视频转GIF（`services/video-to-gif.js`）
### 4.0 `isVideoToGifSupported() => { supported: boolean, reason?: string }`
用途：页面在执行前判断能力是否可用；若不可用，必须给出可读原因用于弹窗提示。

### 4.1 `convertVideoToGif(options) => Promise<void | { outPath: string }>`
#### 入参 `options`
- `videoPath`: string，视频临时路径
- `startS`: number，截取开始秒
- `endS`: number，截取结束秒
- `resolutionP`: number，目标分辨率（360/480/720）
- `fps`: number，目标帧率（5/8/10/12）

#### 行为约束
- `endS - startS <= MAX_CLIP_DURATION_S`
- 若端侧无法支持真实转换：**必须 reject，并给出可读 message**（页面会弹“转换失败”）

#### 说明
当前实现为占位：直接 reject（用于先把 UI、参数、失败提示与工程结构跑通）。

## 5. 图片转GIF（`services/images-to-gif.js`）
### 5.1 `convertImagesToGif(options) => Promise<{ outPath, width, height, size }>`
#### 入参 `options`
- `images`: `{path:string}[]` 图片路径数组（按顺序）
- `canvas`: 2d canvas node（用于绘制/取像素）
- `ctx`: 2d context
- `maxSidePx`: number 输出最长边像素（建议 320/480/720）
- `frameDelayMs`: number 每帧时长（ms）
- `loop`: number 0=无限循环，>0=循环次数
- `onProgress`: function（可选）进度回调

#### 行为约束
- 稳定优先：采用固定 256 色调色板映射（文件小、实现简单、兼容性好）
- 任意失败：必须 reject，并给出可读 message（页面会弹“生成失败”）


