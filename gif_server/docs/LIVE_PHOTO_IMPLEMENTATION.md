# Live Photo 实现方案

## 当前实现方案

### 方案 1：生成两个独立文件（当前实现）

**后端实现：**
1. 从视频中间帧提取静态图片（JPEG）
2. 裁剪视频为短视频（MP4，1.5-3秒）
3. 返回两个文件的下载链接

**前端实现：**
1. 下载图片和视频
2. 分别保存到相册：
   - `wx.saveImageToPhotosAlbum()` - 保存图片
   - `wx.saveVideoToPhotosAlbum()` - 保存视频

**优点：**
- ✅ 实现简单
- ✅ 兼容性好
- ✅ 不依赖特殊格式

**缺点：**
- ❌ 不是真正的 Live Photo 格式
- ❌ 图片和视频是分开的，无法自动关联
- ❌ 在相册中显示为两个独立文件

---

## 真正的 Live Photo 格式要求

### 苹果 Live Photo 格式

Live Photo 由以下部分组成：

1. **静态图片**（JPEG/HEIF）
   - 包含 EXIF 元数据
   - 关键元数据：`ContentIdentifier`（UUID）

2. **短视频**（MOV）
   - QuickTime 格式
   - 包含元数据：`com.apple.quicktime.content.identifier`
   - 必须与图片的 `ContentIdentifier` 相同

3. **元数据关联**
   - 图片和视频通过相同的 `ContentIdentifier` 关联
   - 系统通过这个 UUID 识别它们是同一组 Live Photo

### 实现步骤

#### 方案 2：生成真正的 Live Photo（需要额外工具）

**需要的工具/库：**
1. **exiftool** - 处理图片元数据
2. **ffmpeg** - 处理视频（已有）
3. **Node.js 库** - 处理 QuickTime 元数据

**实现步骤：**

1. **生成静态图片（带元数据）**
   ```bash
   # 使用 FFmpeg 提取图片
   ffmpeg -ss 1.5 -i input.mp4 -vframes 1 -q:v 2 output.jpg
   
   # 使用 exiftool 添加 ContentIdentifier
   exiftool -ContentIdentifier="UUID-xxx" output.jpg
   ```

2. **生成短视频（带元数据）**
   ```bash
   # 使用 FFmpeg 生成 MOV 格式视频
   ffmpeg -ss 0 -t 3 -i input.mp4 -c:v libx264 -c:a aac output.mov
   
   # 使用 exiftool 添加 ContentIdentifier
   exiftool -"com.apple.quicktime.content.identifier"="UUID-xxx" output.mov
   ```

3. **打包为 Live Photo**
   - 需要将图片和视频打包成特定格式
   - 或使用第三方库处理

---

## 推荐实现方案

### 方案 A：使用第三方库（推荐）

**Node.js 库：**
- `live-photo-js` - JavaScript 处理 Live Photo
- `node-exiftool` - 处理 EXIF 元数据
- `mp4box.js` - 处理 MP4/MOV 元数据

**安装依赖：**
```bash
npm install exiftool-vendored
# 或
npm install node-exiftool
```

**实现代码：**
```typescript
import exiftool from 'exiftool-vendored'

async function createLivePhoto(imagePath: string, videoPath: string, outputPath: string) {
  const uuid = nanoid()  // 生成唯一标识符
  
  // 1. 为图片添加 ContentIdentifier
  await exiftool.write(imagePath, {
    ContentIdentifier: uuid,
  })
  
  // 2. 为视频添加 ContentIdentifier
  await exiftool.write(videoPath, {
    'com.apple.quicktime.content.identifier': uuid,
  })
  
  // 3. 打包（需要额外处理）
  // ...
}
```

### 方案 B：使用 Python 脚本（如果 Node.js 库不可用）

创建 Python 脚本处理 Live Photo：

```python
# scripts/create_live_photo.py
import subprocess
import uuid

def create_live_photo(image_path, video_path, output_path):
    content_id = str(uuid.uuid4())
    
    # 添加图片元数据
    subprocess.run([
        'exiftool', '-ContentIdentifier', content_id, image_path
    ])
    
    # 添加视频元数据
    subprocess.run([
        'exiftool', '-com.apple.quicktime.content.identifier', content_id, video_path
    ])
    
    # 打包（需要额外处理）
```

### 方案 C：使用 FFmpeg 元数据（简化版）

FFmpeg 可以添加一些元数据，但可能不够完整：

```bash
# 添加元数据到视频
ffmpeg -i input.mp4 -metadata "com.apple.quicktime.content.identifier=UUID" output.mov
```

---

## 微信小程序限制

**重要：** 微信小程序可能不支持真正的 Live Photo 格式：

1. **保存 API 限制**
   - `wx.saveImageToPhotosAlbum()` - 只能保存图片
   - `wx.saveVideoToPhotosAlbum()` - 只能保存视频
   - 没有 API 可以保存 Live Photo 格式

2. **格式支持**
   - 小程序无法直接创建 Live Photo 格式文件
   - 即使生成了正确的格式，保存时也会被拆分

3. **建议方案**
   - 当前方案（生成两个文件）已经是最佳实践
   - 用户可以在相册中看到图片和视频
   - 如果需要真正的 Live Photo，需要在 iOS 设备上使用原生应用

---

## 实现建议

### 短期方案（当前实现）

保持当前方案：生成图片和视频两个文件，分别保存。

**优点：**
- 实现简单
- 兼容性好
- 用户可以看到两个文件

### 长期方案（如果需要真正的 Live Photo）

1. **安装 exiftool**
   ```bash
   # Windows
   choco install exiftool
   
   # 或下载：https://exiftool.org/
   ```

2. **修改后端代码**
   - 添加 exiftool 调用
   - 为图片和视频添加相同的 ContentIdentifier
   - 返回打包后的文件

3. **前端处理**
   - 下载单个文件（已打包的 Live Photo）
   - 尝试保存（可能仍会被拆分）

---

## 总结

**当前实现：**
- ✅ 已实现：生成图片和视频两个文件
- ✅ 已实现：前端分别保存到相册
- ⚠️ 限制：不是真正的 Live Photo 格式

**真正的 Live Photo 需要：**
- 图片和视频有相同的 ContentIdentifier
- 使用 MOV 格式（而不是 MP4）
- 正确的元数据结构
- 系统级别的支持（微信小程序可能不支持）

**建议：**
- 保持当前实现方案
- 如果用户需要真正的 Live Photo，建议在 iOS 设备上使用原生应用
- 或者提供说明：生成的文件可以在相册中手动组合

