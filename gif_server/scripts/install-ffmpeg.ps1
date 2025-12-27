# FFmpeg 自动安装脚本 (Windows)
# 此脚本会自动下载并安装 FFmpeg 到项目目录

$ErrorActionPreference = "Stop"

Write-Host "=== FFmpeg 自动安装脚本 ===" -ForegroundColor Yellow
Write-Host ""

# 项目根目录
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FfmpegDir = Join-Path $ProjectRoot "ffmpeg"
$FfmpegBin = Join-Path $FfmpegDir "bin"
$FfmpegExe = Join-Path $FfmpegBin "ffmpeg.exe"

# 检查是否已安装
if (Test-Path $FfmpegExe) {
    Write-Host "FFmpeg 已存在于: $FfmpegExe" -ForegroundColor Green
    Write-Host "版本信息:" -ForegroundColor Cyan
    & $FfmpegExe -version | Select-Object -First 3
    exit 0
}

Write-Host "开始下载 FFmpeg..." -ForegroundColor Cyan

# FFmpeg 下载地址 (使用 gyan.dev 的构建版本)
$DownloadUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$ZipFile = Join-Path $env:TEMP "ffmpeg-release-essentials.zip"

try {
    # 下载文件
    Write-Host "正在下载 FFmpeg (约 100MB，请稍候)..." -ForegroundColor Yellow
    $ProgressPreference = 'Continue'
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipFile -UseBasicParsing
    
    Write-Host "下载完成，正在解压..." -ForegroundColor Green
    
    # 创建目录
    if (Test-Path $FfmpegDir) {
        Remove-Item $FfmpegDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $FfmpegDir -Force | Out-Null
    
    # 解压 ZIP 文件
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipFile, $FfmpegDir)
    
    # 移动文件到正确位置 (解压后通常在 ffmpeg-*-essentials 目录中)
    $ExtractedDirs = Get-ChildItem -Path $FfmpegDir -Directory | Where-Object { $_.Name -like "ffmpeg-*-essentials" }
    if ($ExtractedDirs.Count -eq 1) {
        $ExtractedDir = $ExtractedDirs[0].FullName
        $BinSource = Join-Path $ExtractedDir "bin"
        if (Test-Path $BinSource) {
            Move-Item -Path $BinSource -Destination $FfmpegBin -Force
            Remove-Item $ExtractedDir -Recurse -Force
        }
    }
    
    # 清理临时文件
    Remove-Item $ZipFile -Force -ErrorAction SilentlyContinue
    
    # 验证安装
    if (Test-Path $FfmpegExe) {
        Write-Host ""
        Write-Host "FFmpeg 安装成功！" -ForegroundColor Green
        Write-Host "安装路径: $FfmpegExe" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "版本信息:" -ForegroundColor Yellow
        & $FfmpegExe -version | Select-Object -First 3
        
        # 创建或更新 .env 文件
        $EnvFile = Join-Path $ProjectRoot ".env"
        $FfmpegPath = $FfmpegExe.Replace('\', '\\')  # 转义路径中的反斜杠
        
        if (Test-Path $EnvFile) {
            $Content = Get-Content $EnvFile -Raw
            if ($Content -match "FFMPEG_PATH=") {
                $Content = $Content -replace "FFMPEG_PATH=.*", "FFMPEG_PATH=$FfmpegPath"
                Set-Content -Path $EnvFile -Value $Content -NoNewline
            } else {
                Add-Content -Path $EnvFile -Value "`nFFMPEG_PATH=$FfmpegPath"
            }
        } else {
            Set-Content -Path $EnvFile -Value "FFMPEG_PATH=$FfmpegPath"
        }
        
        Write-Host ""
        Write-Host "已自动配置 .env 文件中的 FFMPEG_PATH" -ForegroundColor Green
        Write-Host "请重启 Worker 服务以使配置生效" -ForegroundColor Yellow
    } else {
        Write-Host "安装失败：找不到 ffmpeg.exe" -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host ""
    Write-Host "安装失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "请手动安装 FFmpeg:" -ForegroundColor Yellow
    Write-Host "1. 访问: https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor Cyan
    Write-Host "2. 下载 ffmpeg-release-essentials.zip" -ForegroundColor Cyan
    Write-Host "3. 解压到项目目录的 ffmpeg 文件夹" -ForegroundColor Cyan
    exit 1
}




