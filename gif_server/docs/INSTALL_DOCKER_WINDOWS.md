# Windows 安装 Docker 指南

## 安装 Docker Desktop for Windows

### 方法 1：使用安装程序（推荐）

1. **下载 Docker Desktop**
   - 访问：https://www.docker.com/products/docker-desktop/
   - 下载 "Docker Desktop for Windows"
   - 文件大小约 500MB

2. **安装要求**
   - Windows 10 64位：专业版、企业版或教育版（版本 1903 或更高）
   - Windows 11 64位
   - 启用 WSL 2 功能
   - 启用虚拟化（Hyper-V 或 WSL 2）

3. **安装步骤**
   - 运行下载的安装程序
   - 按照向导完成安装
   - 安装完成后重启电脑

4. **启动 Docker Desktop**
   - 从开始菜单启动 "Docker Desktop"
   - 等待 Docker 引擎启动（系统托盘会显示 Docker 图标）

5. **验证安装**
   ```powershell
   docker --version
   docker compose version
   ```

### 方法 2：使用 Chocolatey（如果已安装）

```powershell
# 以管理员身份运行 PowerShell
choco install docker-desktop
```

## 启动后端服务

安装 Docker 后，在 `gif_server` 目录执行：

```bash
# 停止当前运行的服务（如果有）
# 然后启动 Docker 服务
docker compose up -d --build
```

## 查看服务状态

```bash
# 查看容器状态
docker compose ps

# 查看日志
docker compose logs -f api      # API 服务日志
docker compose logs -f worker   # Worker 服务日志
```

## 停止服务

```bash
docker compose down
```

## 常见问题

### 1. WSL 2 未安装

如果提示需要 WSL 2，执行：

```powershell
# 以管理员身份运行 PowerShell
wsl --install
```

然后重启电脑。

### 2. 虚拟化未启用

- 进入 BIOS/UEFI 设置
- 启用虚拟化（Virtualization Technology 或 VT-x）
- 保存并重启

### 3. Docker 启动失败

- 确保已启用 WSL 2
- 检查 Windows 功能中是否启用了 "Hyper-V" 或 "虚拟机平台"
- 重启电脑后再试

## 优势

使用 Docker 运行的优势：
- ✅ FFmpeg 自动安装（无需手动安装）
- ✅ 环境隔离，不影响系统
- ✅ 跨平台一致（Windows/Linux/Mac）
- ✅ 易于部署和维护

