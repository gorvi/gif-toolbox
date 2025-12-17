# 视频播放器与时间轴截取组件设计文档

## 1. 概述

本文档描述视频转GIF功能中的**视频播放器**和**时间轴截取**组件的设计思路、交互逻辑和实现细节。

## 2. 组件架构

### 2.1 整体布局

```
┌─────────────────────────────────┐
│  视频预览区域 (Video Preview)    │
│  - 视频播放器                    │
│  - 占位提示（未选择视频时）        │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│  时间轴控制区域 (Timeline)        │
│  ├─ 时间显示行                   │
│  │  - 当前时间/总时长             │
│  │  - 操作按钮（更换视频）         │
│  ├─ 可视化选择条                 │
│  │  - 绿色选择区间                │
│  │  - 开始/结束时间标签            │
│  └─ 精确调节滑块                 │
│     - 开始时间滑块                │
│     - 结束时间滑块                │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│  导出参数设置 (Export Options)    │
│  - 分辨率选择器                   │
│  - 帧率选择器                     │
└─────────────────────────────────┘
```

### 2.2 组件层次结构

```
VideoToGifPage
├── VideoPreview (视频预览)
│   ├── <video> 组件（微信原生）
│   └── Placeholder（占位提示）
│
├── TimelineController (时间轴控制器)
│   ├── TimeDisplay（时间显示行）
│   ├── RangeSelector（可视化选择条）
│   └── SliderControls（精确滑块）
│
└── ExportOptions (导出参数)
    ├── ResolutionPicker
    └── FpsPicker
```

## 3. 核心组件设计

### 3.1 视频播放器组件 (VideoPreview)

#### 3.1.1 功能职责
- 显示视频预览
- 提供视频播放控制（播放/暂停）
- 显示视频总时长
- 未选择视频时显示占位提示

#### 3.1.2 技术实现
- **组件类型**: 微信小程序原生 `<video>` 组件
- **数据绑定**: `videoPath`（视频文件路径）
- **交互**: 点击预览区域可选择/更换视频

#### 3.1.3 关键属性
```javascript
{
  videoPath: '',           // 视频文件路径
  durationS: 0,            // 视频总时长（秒）
  currentTimeS: 0          // 当前播放时间（秒）
}
```

#### 3.1.4 UI 状态
- **有视频**: 显示 `<video>` 组件，启用播放控制
- **无视频**: 显示占位提示 "选择视频" + "支持拍摄/相册，截取最长10秒"

### 3.2 时间轴控制器组件 (TimelineController)

#### 3.2.1 功能职责
- 显示当前播放时间/总时长
- 可视化显示截取范围（绿色选择条）
- 提供精确的时间调节（开始/结束滑块）
- 实时更新选择范围的时间标签

#### 3.2.2 三层交互设计

**第一层：时间显示行**
- 显示格式: `当前时间/总时长` (如: `00:00:00/00:00:52`)
- 操作按钮: "更换" 按钮（重新选择视频）

**第二层：可视化选择条（RangeSelector）**
- **视觉设计**:
  - 背景: 灰色时间轴条（`rgba(0, 0, 0, 0.06)`）
  - 选择区间: 绿色条（`rgba(32, 192, 92, 0.85)`）
  - 时间标记: 在时间轴上显示关键时间点（00:00, 00:10, 00:20...）
- **计算逻辑**:
  ```javascript
  rangeLeftPct = (startS / durationS) * 100  // 选择条左偏移百分比
  rangeWidthPct = ((endS - startS) / durationS) * 100  // 选择条宽度百分比
  ```
- **时间标签**: 在选择条下方显示开始和结束时间

**第三层：精确调节滑块（SliderControls）**
- 两个独立的滑块：
  - **开始时间滑块**: 调节 `startS`
  - **结束时间滑块**: 调节 `endS`
- 滑块属性:
  - `min`: 0
  - `max`: `durationS`（视频总时长）
  - `step`: 0.1（精确到0.1秒）
  - `activeColor`: `#20c05c`（绿色，与选择条颜色一致）

#### 3.2.3 数据流

```
用户操作滑块
    ↓
onStartChange / onEndChange
    ↓
更新 startS / endS
    ↓
updateUiByRange()
    ↓
计算 rangeLeftPct, rangeWidthPct
    ↓
更新 UI（选择条位置、时间标签）
```

#### 3.2.4 约束规则

```javascript
// 1. 开始时间不能超过结束时间
if (startS > endS) startS = endS

// 2. 结束时间不能小于开始时间
if (endS < startS) endS = startS

// 3. 截取时长不能超过最大限制（20秒）
if (endS - startS > MAX_CLIP_DURATION_S) {
  // 调整结束时间
  endS = startS + MAX_CLIP_DURATION_S
}

// 4. 时间范围不能超出视频总时长
startS = clamp(startS, 0, durationS)
endS = clamp(endS, 0, durationS)
```

### 3.3 导出参数组件 (ExportOptions)

#### 3.3.1 分辨率选择器
- **选项**: 360p, 480p, 720p
- **默认值**: 480p
- **实现**: 微信小程序 `<picker>` 组件

#### 3.3.2 帧率选择器
- **选项**: 5 FPS, 8 FPS, 10 FPS, 12 FPS
- **默认值**: 5 FPS
- **实现**: 微信小程序 `<picker>` 组件

## 4. 数据结构

### 4.1 页面数据模型

```javascript
{
  // 视频相关
  videoPath: '',              // 视频文件路径
  durationS: 0,               // 视频总时长（秒，精确到0.1）
  
  // 截取范围
  startS: 0,                  // 开始时间（秒，精确到0.1）
  endS: 0,                    // 结束时间（秒，精确到0.1）
  
  // UI 显示
  currentText: '00:00:00/00:00:00',  // 当前时间/总时长文本
  startText: '00:00:00',             // 开始时间文本
  endText: '00:00:00',               // 结束时间文本
  rangeLeftPct: 0,                   // 选择条左偏移百分比
  rangeWidthPct: 0,                  // 选择条宽度百分比
  
  // 导出参数
  resolutionIndex: 1,         // 分辨率选项索引（0=360p, 1=480p, 2=720p）
  fpsIndex: 0,                 // 帧率选项索引（0=5fps, 1=8fps, 2=10fps, 3=12fps）
  resolutionLabels: ['360p', '480p', '720p'],
  fpsLabels: ['5 FPS', '8 FPS', '10 FPS', '12 FPS'],
  
  // 状态
  processing: false,           // 是否正在处理
  progressText: '',           // 进度文本
  outPath: ''                 // 输出文件路径
}
```

### 4.2 常量定义

```javascript
const MAX_CLIP_DURATION_S = 10        // 最大截取时长（秒）
const DEFAULT_VIDEO_FPS = 5            // 默认帧率
const DEFAULT_VIDEO_RESOLUTION_P = 480  // 默认分辨率

const RESOLUTION_OPTIONS = [360, 480, 720]
const FPS_OPTIONS = [5, 8, 10, 12]
```

## 5. 核心方法

### 5.1 时间格式化

```javascript
/**
 * 将秒数格式化为 HH:MM:SS 或 MM:SS 格式
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatHms(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
```

### 5.2 UI 更新方法

```javascript
/**
 * 根据截取范围更新 UI 显示
 * - 计算选择条的位置和宽度
 * - 更新时间标签文本
 */
updateUiByRange() {
  const { durationS, startS, endS } = this.data
  
  // 计算选择条的百分比位置
  const leftPct = durationS > 0 ? (startS / durationS) * 100 : 0
  const widthPct = durationS > 0 ? ((endS - startS) / durationS) * 100 : 0
  
  this.setData({
    currentText: `${formatHms(0)}/${formatHms(durationS)}`,
    startText: formatHms(startS),
    endText: formatHms(endS),
    rangeLeftPct: clamp(leftPct, 0, 100),
    rangeWidthPct: clamp(widthPct, 0, 100),
  })
}
```

### 5.3 滑块事件处理

```javascript
/**
 * 开始时间滑块变化
 * @param {Object} e - 事件对象
 */
onStartChange(e) {
  const durationS = this.data.durationS || 0
  let startS = toFixed1(Number(e.detail.value || 0))
  startS = clamp(startS, 0, durationS)
  
  let endS = this.data.endS
  // 约束：结束时间不能小于开始时间
  if (endS < startS) endS = startS
  // 约束：截取时长不能超过最大限制
  if (endS - startS > MAX_CLIP_DURATION_S) {
    endS = toFixed1(startS + MAX_CLIP_DURATION_S)
  }
  endS = clamp(endS, 0, durationS)
  
  this.setData({ startS, endS })
  this.updateUiByRange()
}

/**
 * 结束时间滑块变化
 * @param {Object} e - 事件对象
 */
onEndChange(e) {
  const durationS = this.data.durationS || 0
  let endS = toFixed1(Number(e.detail.value || 0))
  endS = clamp(endS, 0, durationS)
  
  let startS = this.data.startS
  // 约束：开始时间不能大于结束时间
  if (startS > endS) startS = endS
  // 约束：截取时长不能超过最大限制
  if (endS - startS > MAX_CLIP_DURATION_S) {
    startS = toFixed1(endS - MAX_CLIP_DURATION_S)
  }
  startS = clamp(startS, 0, durationS)
  
  this.setData({ startS, endS })
  this.updateUiByRange()
}
```

## 6. 交互流程

### 6.1 选择视频流程

```
用户点击预览区域
    ↓
调用 chooseSingleVideo()
    ↓
获取视频文件路径和时长
    ↓
初始化截取范围：
  - startS = 0
  - endS = min(durationS, MAX_CLIP_DURATION_S)
    ↓
更新 UI（显示视频、更新时间轴）
```

### 6.2 调整截取范围流程

```
用户拖动滑块
    ↓
触发 onStartChange / onEndChange
    ↓
应用约束规则（时长限制、范围限制）
    ↓
更新 startS / endS
    ↓
调用 updateUiByRange()
    ↓
更新可视化选择条和时间标签
```

### 6.3 转换流程

```
用户点击"转换"按钮
    ↓
验证：
  - 是否选择了视频
  - 截取范围是否合法
  - 截取时长是否在限制内
    ↓
调用 convertVideoToGif()
    ↓
显示进度提示
    ↓
完成后显示结果预览
```

## 7. UI/UX 设计要点

### 7.1 视觉层次
1. **视频预览区**: 最大区域，吸引用户注意力
2. **时间轴控制区**: 次重要，提供精确控制
3. **参数设置区**: 辅助功能，使用选择器简化操作

### 7.2 颜色系统
- **主色调**: 绿色 `#20c05c`（选择区间、滑块激活色）
- **背景色**: 灰色半透明（时间轴背景）
- **文本色**: 黑色半透明（根据重要性调整透明度）

### 7.3 反馈机制
- **实时更新**: 滑块拖动时，选择条和时间标签实时更新
- **约束提示**: 超出限制时自动调整，无需额外提示
- **状态反馈**: 处理中显示进度文本，完成后显示结果

### 7.4 响应式设计
- 使用百分比布局，适配不同屏幕尺寸
- 时间轴使用相对单位（rpx），保证在不同设备上的一致性

## 8. 技术实现细节

### 8.1 时间精度
- 使用 `toFixed1()` 函数将时间精确到 0.1 秒
- 滑块 `step` 设置为 0.1，保证精确控制

### 8.2 性能优化
- 使用 `clamp()` 函数限制数值范围，避免无效计算
- UI 更新使用 `setData()` 批量更新，减少渲染次数

### 8.3 兼容性
- 使用微信小程序原生组件，保证兼容性
- 视频组件使用标准属性，避免平台差异

## 9. 未来优化方向

### 9.1 交互优化
- [ ] 支持在可视化选择条上直接拖拽调整范围
- [ ] 添加时间轴缩略图预览
- [ ] 支持键盘快捷键（如左右箭头微调）

### 9.2 功能增强
- [ ] 支持视频播放时实时预览截取范围
- [ ] 添加帧级别的精确选择
- [ ] 支持多段截取（未来版本）

### 9.3 性能优化
- [ ] 视频加载时显示加载进度
- [ ] 大视频文件的分段加载
- [ ] 时间轴渲染优化（虚拟滚动）

## 10. 参考实现

- **视频组件**: 微信小程序 `<video>` 组件文档
- **滑块组件**: 微信小程序 `<slider>` 组件文档
- **选择器组件**: 微信小程序 `<picker>` 组件文档

---

**文档版本**: v1.0  
**最后更新**: 2025-12-16  
**维护者**: 开发团队


