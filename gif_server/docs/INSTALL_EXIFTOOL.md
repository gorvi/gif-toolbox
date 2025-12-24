# ExifTool 安装指南（Live Photo 元数据支持）

## 为什么需要 ExifTool？

要实现真正的 Live Photo 格式，需要为图片和视频添加 `ContentIdentifier` 元数据。ExifTool 是处理元数据的最佳工具。

## Windows 安装方法

### 方法 1：使用 Chocolatey（推荐）

```powershell
# 以管理员身份运行 PowerShell
choco install exiftool
```

### 方法 2：手动安装

1. **下载 ExifTool**
   - 访问：https://exiftool.org/
   - 下载 Windows 版本：`exiftool-xx.xx.zip`

2. **解压**
   - 解压到：`C:\exiftool\`
   - 确保路径为：`C:\exiftool\exiftool.exe`

3. **添加到系统 PATH**
   - 添加到 PATH：`C:\exiftool`
   - 或设置环境变量：`EXIFTOOL_PATH=C:\exiftool\exiftool.exe`

4. **验证安装**
   ```powershell
   exiftool -ver
   ```

## Linux 安装方法

### Ubuntu/Debian
```bash
sudo apt install -y libimage-exiftool-perl
```

### CentOS/RHEL
```bash
sudo yum install -y perl-Image-ExifTool
```

## macOS 安装方法

### 使用 Homebrew
```bash
brew install exiftool
```

## 配置环境变量（可选）

如果 ExifTool 不在系统 PATH 中，可以在 `.env` 文件中设置：

```bash
# Windows
EXIFTOOL_PATH=C:\exiftool\exiftool.exe

# Linux/Mac
EXIFTOOL_PATH=/usr/bin/exiftool
```

## 备用方案

如果 ExifTool 未安装，系统会：
1. 尝试使用 FFmpeg 添加元数据（对视频文件有效）
2. 如果失败，文件仍然可用，只是缺少 Live Photo 元数据

## 验证安装

安装完成后，重启后端服务，然后测试：

```bash
# 检查 ExifTool 是否可用
exiftool -ver

# 应该看到版本号，例如：12.xx
```

## 注意事项

- ExifTool 不是必需的，但强烈推荐安装以获得完整的 Live Photo 支持
- 如果没有 ExifTool，系统会尝试使用 FFmpeg 作为备用方案
- 即使元数据添加失败，生成的文件仍然可以正常使用

