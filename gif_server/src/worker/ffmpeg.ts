import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { nanoid } from 'nanoid'
import { CONFIG } from '../common/config.js'

export type TextConfig = {
  content: string
  fontSizeNum: number
  color: string
  textOpacity: number
  x: number  // 百分比 0-100
  y: number  // 百分比 0-100
  strokeColor?: string
  strokeWidth?: number
  strokeOpacity?: number
  shadowColor?: string
  shadowBlur?: number
  shadowDistance?: number
  shadowAngle?: number
  shadowOpacity?: number
  bgColor?: string
  bgOpacity?: number
  animation?: string  // 动画类型：'', 'fade', 'slide', 'bounce', 'pulse', 'shake', 'zoom'
  animationSpeed?: number // 动画速度：0.5-2.0
}

export type CropConfig = {
  x: number      // 裁剪区域X位置（0-1）
  y: number      // 裁剪区域Y位置（0-1）
  width: number  // 裁剪区域宽度（0-1）
  height: number // 裁剪区域高度（0-1）
}

export type VideoToGifOptions = {
  inputPath: string
  outputPath: string
  startS: number
  endS: number
  fps: number
  width: number
  qualityMode: 'STANDARD' | 'HIGH'
  tmpDir: string
  textConfig?: TextConfig
  cropConfig?: CropConfig
}

export type VideoToLiveOptions = {
  inputPath: string
  outputVideoPath: string  // 短视频输出路径
  outputImagePath: string  // 静态图片输出路径
  startS: number
  endS: number
  width: number
  keepAudio: boolean
  qualityMode: 'STANDARD' | 'HIGH'
}

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    // 如果命令是 ffmpeg，使用配置的路径
    const actualCmd = cmd === 'ffmpeg' ? CONFIG.FFMPEG_PATH : cmd
    const p = spawn(actualCmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    p.on('error', (err) => {
      // 提供更友好的错误信息
      if (err.message && err.message.includes('ENOENT')) {
        reject(new Error(`找不到 FFmpeg 可执行文件。请确保 FFmpeg 已安装并在 PATH 中，或设置环境变量 FFMPEG_PATH 指向 FFmpeg 的完整路径。当前配置: ${CONFIG.FFMPEG_PATH}`))
      } else {
        reject(err)
      }
    })
    p.on('close', (code) => resolve({ code: code ?? 0, stderr }))
  })
}

/**
 * 将 #RRGGBB 颜色转换为 FFmpeg 格式
 */
function colorToFfmpeg(color: string): string {
  if (!color) return 'white'
  // #RRGGBB -> 0xRRGGBB
  if (color.startsWith('#')) {
    return '0x' + color.slice(1)
  }
  return color
}

/**
 * 过滤掉emoji字符
 */
function filterEmoji(text: string): string {
  if (!text) return text
  // 匹配常见emoji的Unicode范围
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{200D}]|[\u{FE00}-\u{FE0F}]|[\u{203C}-\u{2049}]|[\u{2122}-\u{2139}]|[\u{2194}-\u{21AA}]|[\u{231A}-\u{23FA}]|[\u{24C2}]|[\u{25AA}-\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}-\u{3299}]/gu
  return text.replace(emojiRegex, '')
}

/**
 * 转义 drawtext 中的特殊字符
 */
function escapeDrawtext(text: string): string {
  // 先过滤emoji
  const filtered = filterEmoji(text)
  // 转义 : ' \ 等特殊字符
  return filtered
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
}

/**
 * 获取系统中文字体路径
 */
function getChineseFontPath(): string {
  // Windows 字体路径
  const windowsFonts = [
    'C:/Windows/Fonts/msyhbd.ttc',    // 微软雅黑粗体
    'C:/Windows/Fonts/msyh.ttc',      // 微软雅黑
    'C:/Windows/Fonts/simhei.ttf',    // 黑体
    'C:/Windows/Fonts/simsun.ttc',    // 宋体
  ]
  
  // Linux 字体路径
  const linuxFonts = [
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
  ]
  
  // macOS 字体路径
  const macFonts = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
  ]
  
  const allFonts = [...windowsFonts, ...linuxFonts, ...macFonts]
  
  for (const fontPath of allFonts) {
    if (fs.existsSync(fontPath)) {
      return fontPath
    }
  }
  
  // 没找到则返回空，使用默认字体
  return ''
}

/**
 * 构建 drawtext 滤镜（支持多层描边）
 * 返回一个或多个 drawtext 滤镜，用逗号连接
 */
function buildDrawtextFilter(textConfig: TextConfig, videoWidth: number, duration: number = 1): string {
  const text = escapeDrawtext(textConfig.content)
  const baseFontSize = Math.max(1, Math.round(textConfig.fontSizeNum))
  const fontColor = colorToFfmpeg(textConfig.color)
  // 透明度：0=不透明(alpha=1), 100=全透明(alpha=0)
  const baseTextAlpha = (100 - (textConfig.textOpacity || 0)) / 100
  
  // 位置计算：百分比转换为表达式
  const baseXExpr = `(w*${textConfig.x}/100-text_w/2)`
  const baseYExpr = `(h*${textConfig.y}/100-text_h/2)`
  
  // 动画效果计算（使用 FFmpeg 表达式，t 是当前时间）
  const animation = textConfig.animation || ''
  let fontSizeExpr = String(baseFontSize)
  let alphaExpr = String(baseTextAlpha)
  let xExpr = baseXExpr
  let yExpr = baseYExpr
  
  if (animation && duration > 0) {
    const speed = Math.max(0.5, Math.min(2, Number(textConfig.animationSpeed || 1)))
    const period = Math.max(0.2, 2 / speed)
    const tMod = `mod(t\\,${period})` // t 对周期取模，实现循环（注意逗号需要转义）
    
    switch (animation) {
      case 'fade':
        // 淡入淡出：0-0.5 淡入，0.5-1 淡出
        alphaExpr = `${baseTextAlpha}*if(lt(${tMod}\\,${period/2})\\,${tMod}*2/${period}\\,2-${tMod}*2/${period})`
        break
      case 'pulse':
        // 脉冲：缩放 1.0 -> 1.1 -> 1.0
        fontSizeExpr = `${baseFontSize}*(1+0.1*sin(2*PI*${tMod}/${period}))`
        break
      case 'bounce':
        // 弹跳：上下移动
        yExpr = `${baseYExpr}-20*abs(sin(2*PI*${tMod}/${period}))`
        break
      case 'shake':
        // 摇晃：左右抖动
        xExpr = `${baseXExpr}+5*sin(10*PI*${tMod}/${period})`
        break
      case 'zoom':
        // 缩放：1.0 -> 1.2 -> 1.0
        fontSizeExpr = `${baseFontSize}*(1+0.2*sin(2*PI*${tMod}/${period}))`
        break
      case 'slide':
        // 滑入：左右滑动
        xExpr = `${baseXExpr}+10*sin(2*PI*${tMod}/${period})`
        break
    }
  }
  
  // 获取中文字体
  const fontPath = getChineseFontPath()
  const fontFile = fontPath ? `:fontfile='${fontPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'` : ''
  
  const filters: string[] = []
  
  // 如果有描边，先绘制描边层（8个方向的偏移文字）
  if (textConfig.strokeColor && textConfig.strokeWidth && textConfig.strokeWidth > 0) {
    const strokeColor = colorToFfmpeg(textConfig.strokeColor)
    // 透明度：0=不透明(alpha=1), 100=全透明(alpha=0)
    const strokeAlpha = (100 - (textConfig.strokeOpacity || 0)) / 100
    const strokeSize = Math.max(1, Math.round(textConfig.strokeWidth / 50)) // 描边粗细
    
    // 8个方向：上、下、左、右、左上、右上、左下、右下
    const offsets = [
      [0, -1], [0, 1], [-1, 0], [1, 0],  // 上下左右
      [-1, -1], [1, -1], [-1, 1], [1, 1] // 四个角
    ]
    
    for (const [dx, dy] of offsets) {
      const ox = dx * strokeSize
      const oy = dy * strokeSize
      const strokeXExpr = ox >= 0 ? `${xExpr}+${ox}` : `${xExpr}${ox}`
      const strokeYExpr = oy >= 0 ? `${yExpr}+${oy}` : `${yExpr}${oy}`
      
      filters.push(
        `drawtext=text='${text}'${fontFile}:fontsize=${fontSizeExpr}:fontcolor=${strokeColor}@${strokeAlpha}:x=${strokeXExpr}:y=${strokeYExpr}`
      )
    }
  }
  
  // 主文字层
  let mainFilter = `drawtext=text='${text}'${fontFile}:fontsize=${fontSizeExpr}:fontcolor=${fontColor}@${alphaExpr}:x=${xExpr}:y=${yExpr}`
  
  // 阴影 - 根据角度计算偏移
  if (textConfig.shadowColor && textConfig.shadowDistance && textConfig.shadowDistance > 0) {
    const distance = textConfig.shadowDistance / 8
    const angle = (textConfig.shadowAngle || 45) * (Math.PI / 180)
    const shadowX = Math.round(distance * Math.cos(angle))
    const shadowY = Math.round(distance * Math.sin(angle))
    const shadowColor = colorToFfmpeg(textConfig.shadowColor)
    // 透明度：0=不透明(alpha=1), 100=全透明(alpha=0)
    const shadowAlpha = (100 - (textConfig.shadowOpacity || 0)) / 100
    mainFilter += `:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${shadowColor}@${shadowAlpha}`
  }
  
  // 背景色
  if (textConfig.bgColor) {
    const boxColor = colorToFfmpeg(textConfig.bgColor)
    // 透明度：0=不透明(alpha=1), 100=全透明(alpha=0)
    const bgAlpha = (100 - (textConfig.bgOpacity || 0)) / 100
    const boxBorderW = Math.max(2, Math.round((8 * baseFontSize) / 32))
    mainFilter += `:box=1:boxcolor=${boxColor}@${bgAlpha}:boxborderw=${boxBorderW}`
  }
  
  filters.push(mainFilter)
  
  return filters.join(',')
}

export async function convertVideoToGifWithFfmpeg(opts: VideoToGifOptions): Promise<void> {
  const duration = Math.max(0.1, opts.endS - opts.startS)
  const palettePath = path.join(opts.tmpDir, `palette_${Date.now()}.png`)

  const scale = `scale=${opts.width}:-1:flags=lanczos`
  const fps = `fps=${opts.fps}`
  
  // 构建裁剪滤镜（如果有）
  let cropFilter = ''
  let normalizedCropWidth = 1
  if (opts.cropConfig) {
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
    const raw = opts.cropConfig
    const x = clamp01(Number(raw.x) || 0)
    const y = clamp01(Number(raw.y) || 0)
    let width = clamp01(Number(raw.width) || 0)
    let height = clamp01(Number(raw.height) || 0)
    width = Math.min(width, 1 - x)
    height = Math.min(height, 1 - y)

    const hasCrop = width > 1e-6 && height > 1e-6 && (x > 1e-6 || y > 1e-6 || Math.abs(width - 1) > 1e-6 || Math.abs(height - 1) > 1e-6)
    if (hasCrop) {
      normalizedCropWidth = Math.max(1e-6, width)
      const cropW = `max(2\\,iw*${width})`
      const cropH = `max(2\\,ih*${height})`
      const cropX = `(iw*${x})`
      const cropY = `(ih*${y})`
      cropFilter = `,crop=${cropW}:${cropH}:${cropX}:${cropY}`
    }
  }
  
  // 构建文字滤镜（如果有）
  let drawtextFilter = ''
  if (opts.textConfig && opts.textConfig.content) {
    // 如果裁剪了，文字位置需要基于裁剪后的尺寸
    const textWidth = cropFilter ? opts.width * normalizedCropWidth : opts.width
    drawtextFilter = ',' + buildDrawtextFilter(opts.textConfig, textWidth, duration)
  }

  // palettegen -> paletteuse for better colors
  // 顺序：scale -> crop -> text -> palettegen
  const palettegen = `${fps},${scale}${cropFilter}${drawtextFilter},palettegen=stats_mode=diff`
  const dither =
    opts.qualityMode === 'HIGH'
      ? 'paletteuse=dither=bayer:bayer_scale=5'
      : 'paletteuse=dither=none'

  const paletteuse = `${fps},${scale}${cropFilter}${drawtextFilter}[x];[x][1:v]${dither}`

  // 1) palette
  {
    const args = [
      '-hide_banner',
      '-y',
      '-ss',
      String(opts.startS),
      '-t',
      String(duration),
      '-i',
      opts.inputPath,
      '-vf',
      palettegen,
      palettePath,
    ]
    console.log('[FFmpeg] palettegen args:', args.join(' '))
    const { code, stderr } = await run('ffmpeg', args)
    if (code !== 0) {
      throw new Error(`ffmpeg palettegen 失败：${stderr.slice(-800)}`)
    }
  }

  // 2) gif
  {
    const args = [
      '-hide_banner',
      '-y',
      '-ss',
      String(opts.startS),
      '-t',
      String(duration),
      '-i',
      opts.inputPath,
      '-i',
      palettePath,
      '-lavfi',
      paletteuse,
      '-loop',
      '0',
      opts.outputPath,
    ]
    console.log('[FFmpeg] gif args:', args.join(' '))
    const { code, stderr } = await run('ffmpeg', args)
    if (code !== 0) {
      throw new Error(`ffmpeg 转码失败：${stderr.slice(-800)}`)
    }
  }
}

export async function convertVideoToLiveWithFfmpeg(opts: VideoToLiveOptions): Promise<void> {
  // 生成唯一的 ContentIdentifier（Live Photo 要求）
  // 使用 UUID 格式，符合 iOS Live Photo 规范
  const contentIdentifier = `A7CE48EE-${nanoid(8).toUpperCase()}-${nanoid(4).toUpperCase()}-${nanoid(4).toUpperCase()}-${nanoid(12).toUpperCase()}`
  const duration = Math.max(0.1, opts.endS - opts.startS)
  const frameTime = opts.startS + duration / 2  // 提取中间帧作为静态图片

  // 1. 生成静态图片（从视频中间帧提取）
  {
    const scale = `scale=${opts.width}:-2:flags=lanczos`
    const args = [
      '-hide_banner',
      '-y',
      '-ss',
      String(frameTime),
      '-i',
      opts.inputPath,
      '-vf',
      scale,
      '-vframes',
      '1',
      '-q:v',
      '2',  // 高质量 JPEG
      opts.outputImagePath,
    ]
    console.log('[FFmpeg] live image args:', args.join(' '))
    const { code, stderr } = await run('ffmpeg', args)
    if (code !== 0) {
      throw new Error(`ffmpeg 提取静态图片失败：${stderr.slice(-800)}`)
    }
  }

  // 2. 生成短视频（MOV 格式，Live Photo 要求）
  {
    const scale = `scale=${opts.width}:-2:flags=lanczos`
    const audioArgs = opts.keepAudio
      ? ['-c:a', 'aac', '-b:a', '96k']
      : ['-an']

    const crf = opts.qualityMode === 'HIGH' ? '23' : '28'

    const args = [
      '-hide_banner',
      '-y',
      '-ss',
      String(opts.startS),
      '-t',
      String(duration),
      '-i',
      opts.inputPath,
      '-vf',
      scale,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      crf,
      '-pix_fmt',
      'yuv420p',
      ...audioArgs,
      '-movflags',
      '+faststart',
      '-f',
      'mov',  // 强制使用 MOV 格式（Live Photo 要求）
      opts.outputVideoPath,
    ]
    console.log('[FFmpeg] live video args:', args.join(' '))
    const { code, stderr } = await run('ffmpeg', args)
    if (code !== 0) {
      throw new Error(`ffmpeg 转码失败：${stderr.slice(-800)}`)
    }
  }

  // 3. 添加 Live Photo 元数据（ContentIdentifier）
  try {
    await addLivePhotoMetadata(opts.outputImagePath, opts.outputVideoPath, contentIdentifier)
    console.log('[FFmpeg] Live Photo 元数据已添加，ContentIdentifier:', contentIdentifier)
  } catch (err: any) {
    console.warn('[FFmpeg] 添加 Live Photo 元数据失败（文件仍可用）:', err.message)
    // 不抛出错误，即使元数据添加失败，文件仍然可用
  }
}

/**
 * 为 Live Photo 文件添加元数据（ContentIdentifier）
 * 使用 exiftool 或 FFmpeg 添加元数据
 */
export async function addLivePhotoMetadata(
  imagePath: string,
  videoPath: string,
  contentIdentifier: string,
): Promise<void> {
  // 方案 1: 使用 exiftool（如果已安装）
  const exiftoolPath = CONFIG.EXIFTOOL_PATH
  
  try {
    // 为图片添加 ContentIdentifier
    {
      const args = [
        '-overwrite_original',
        `-ContentIdentifier=${contentIdentifier}`,
        imagePath,
      ]
      const { code, stderr } = await run(exiftoolPath, args)
      if (code !== 0) {
        console.warn(`exiftool 添加图片元数据失败，尝试使用 FFmpeg: ${stderr.slice(-200)}`)
        // 如果 exiftool 失败，尝试使用 FFmpeg
        await addMetadataWithFfmpeg(imagePath, 'ContentIdentifier', contentIdentifier)
      }
    }

    // 为视频添加 ContentIdentifier
    {
      const args = [
        '-overwrite_original',
        `-com.apple.quicktime.content.identifier=${contentIdentifier}`,
        videoPath,
      ]
      const { code, stderr } = await run(exiftoolPath, args)
      if (code !== 0) {
        console.warn(`exiftool 添加视频元数据失败，尝试使用 FFmpeg: ${stderr.slice(-200)}`)
        // 如果 exiftool 失败，尝试使用 FFmpeg
        await addMetadataWithFfmpeg(videoPath, 'com.apple.quicktime.content.identifier', contentIdentifier)
      }
    }
  } catch (err: any) {
    // exiftool 未安装，使用 FFmpeg 添加元数据
    console.warn('exiftool 不可用，使用 FFmpeg 添加元数据:', err.message)
    await addMetadataWithFfmpeg(imagePath, 'ContentIdentifier', contentIdentifier)
    await addMetadataWithFfmpeg(videoPath, 'com.apple.quicktime.content.identifier', contentIdentifier)
  }
}

/**
 * 使用 FFmpeg 添加元数据（备用方案）
 * 注意：FFmpeg 对某些元数据的支持有限，可能无法完全替代 exiftool
 */
async function addMetadataWithFfmpeg(
  filePath: string,
  metadataKey: string,
  metadataValue: string,
): Promise<void> {
  const tempPath = filePath + '.tmp'
  
  try {
    // 对于视频文件，使用 -metadata 参数
    if (filePath.endsWith('.mov') || filePath.endsWith('.mp4')) {
      const args = [
        '-hide_banner',
        '-y',
        '-i',
        filePath,
        '-metadata',
        `${metadataKey}=${metadataValue}`,
        '-codec',
        'copy',  // 复制流，不重新编码
        tempPath,
      ]
      
      const { code, stderr } = await run('ffmpeg', args)
      if (code !== 0) {
        throw new Error(`FFmpeg 添加视频元数据失败：${stderr.slice(-800)}`)
      }
    } else {
      // 对于图片文件，FFmpeg 可能无法添加 EXIF 元数据
      // 这种情况下，我们只记录警告，不抛出错误
      console.warn(`FFmpeg 无法为图片文件添加 ${metadataKey} 元数据，建议安装 exiftool`)
      return
    }
    
    // 替换原文件
    if (fs.existsSync(tempPath)) {
      fs.renameSync(tempPath, filePath)
    }
  } catch (err: any) {
    // 清理临时文件
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath)
    }
    throw err
  }
}
