# FFmpeg 安装指南

## 问题说明

如果遇到错误 `spawn ffmpeg ENOENT`，说明系统找不到 FFmpeg 可执行文件。

## Windows 安装方法

### 方法 1：使用 Chocolatey（推荐）

```powershell
# 安装 Chocolatey（如果还没有）
# 以管理员身份运行 PowerShell，执行：
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# 安装 FFmpeg
choco install ffmpeg
```

### 方法 2：手动安装

1. **下载 FFmpeg**
   - 访问：https://www.gyan.dev/ffmpeg/builds/
   - 下载 "ffmpeg-release-essentials.zip"

2. **解压到目录**
   - 解压到：`C:\ffmpeg\`
   - 确保路径为：`C:\ffmpeg\bin\ffmpeg.exe`

3. **添加到系统 PATH**
   - 右键"此电脑" -> "属性" -> "高级系统设置"
   - 点击"环境变量"
   - 在"系统变量"中找到 `Path`，点击"编辑"
   - 点击"新建"，添加：`C:\ffmpeg\bin`
   - 点击"确定"保存

4. **验证安装**
   ```powershell
   ffmpeg -version
   ```

### 方法 3：使用环境变量（不修改 PATH）

如果不想修改系统 PATH，可以设置环境变量：

1. **解压 FFmpeg**（同上）

2. **设置环境变量**
   - 在项目根目录创建 `.env` 文件（或修改现有文件）
   - 添加：
     ```
     FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
     ```

3. **重启后端服务**

## Linux 安装方法

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install -y ffmpeg
```

### CentOS/RHEL
```bash
sudo yum install -y epel-release
sudo yum install -y ffmpeg
```

### 验证安装
```bash
ffmpeg -version
```

## macOS 安装方法

### 使用 Homebrew
```bash
brew install ffmpeg
```

### 验证安装
```bash
ffmpeg -version
```

## 配置环境变量（可选）

如果 FFmpeg 不在系统 PATH 中，可以在 `.env` 文件中设置：

```bash
# Windows
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe

# Linux/Mac
FFMPEG_PATH=/usr/bin/ffmpeg
```

## 验证安装

安装完成后，重启后端服务，然后测试：

```bash
# 检查 FFmpeg 是否可用
ffmpeg -version

# 应该看到版本信息，例如：
# ffmpeg version 6.x.x Copyright (c) 2000-2024...
```

## 常见问题

### 1. 安装后仍然报错

- 确保已重启后端服务
- 检查环境变量是否正确设置
- 在命令行中测试 `ffmpeg -version` 是否可用

### 2. Windows 权限问题

- 确保以管理员身份运行 PowerShell 安装
- 或者手动解压并添加到 PATH

### 3. Docker 环境

如果使用 Docker，FFmpeg 已经在 Dockerfile 中安装，无需额外配置。




