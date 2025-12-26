# 腾讯轻量云服务器部署指南

> 完整指南：将 `gif_server` 后端服务部署到腾讯轻量云服务器

## 📋 前置准备

### 1. 服务器要求
- **操作系统**：
  - **首选（通用）**：Ubuntu 22.04 LTS
  - **首选（腾讯云）**：OpenCloudOS 9 ⭐ 腾讯云官方推荐
  - 备选：Debian 11/12、Rocky Linux 9
  - 不推荐：CentOS 7（已停止维护）、CentOS Stream、Windows Server
  - 详细选择指南请参考：[操作系统选择指南](./OS_SELECTION_GUIDE.md)
- **内存**：建议 2GB 以上
- **磁盘**：建议 50GB 以上（用于存储临时文件）
- **网络**：需要公网 IP 和域名（用于 HTTPS）

### 2. 需要安装的软件
- Node.js 18+ 
- FFmpeg（用于视频处理和 GIF 转换）
- Nginx（用于反向代理和 HTTPS）
- PM2 或 systemd（用于进程管理）

---

## 🚀 部署步骤

### 步骤 1：连接服务器

```bash
# 使用 SSH 连接服务器
ssh root@your-server-ip
```

### 步骤 2：安装 Node.js 18+

#### Ubuntu/Debian 系统：
```bash
# 使用 NodeSource 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version  # 应该显示 v18.x.x 或更高
npm --version
```

#### OpenCloudOS 9 / Rocky Linux 9 / CentOS 系统：
```bash
# 使用 NodeSource 安装 Node.js 18
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs  # OpenCloudOS 9 使用 dnf
# 或 sudo yum install -y nodejs  # CentOS 7 使用 yum

# 验证安装
node --version  # 应该显示 v18.x.x 或更高
npm --version
```

### 步骤 3：安装 FFmpeg

#### Ubuntu/Debian 系统（推荐，最简单）：
```bash
# 直接安装
sudo apt update
sudo apt install -y ffmpeg

# 验证安装
ffmpeg -version
```

#### OpenCloudOS 9 / Rocky Linux 9 / CentOS 系统：
```bash
# 安装 EPEL 仓库
sudo dnf install -y epel-release  # OpenCloudOS 9 使用 dnf
# 或 sudo yum install -y epel-release  # CentOS 7 使用 yum

# 添加 RPM Fusion 仓库（OpenCloudOS 9 / Rocky Linux 9）
sudo dnf install -y https://download1.rpmfusion.org/free/el/rpmfusion-free-release-9.noarch.rpm
sudo dnf install -y ffmpeg

# 验证安装
ffmpeg -version
```

如果系统仓库没有 FFmpeg，可以手动编译安装：

```bash
# 安装编译依赖
sudo yum groupinstall -y "Development Tools"
sudo yum install -y yasm cmake

# 下载并编译 FFmpeg（需要较长时间）
cd /tmp
wget https://ffmpeg.org/releases/ffmpeg-6.0.tar.bz2
tar -xjf ffmpeg-6.0.tar.bz2
cd ffmpeg-6.0
./configure --enable-gpl --enable-libx264 --enable-libx265
make -j$(nproc)
sudo make install
```

### 步骤 4：上传代码到服务器

#### 方法 1：使用 Git（推荐）

```bash
# 在服务器上克隆代码
cd /opt
sudo git clone https://your-repo-url/gif-toolbox.git
cd gif-toolbox/gif_server
```

#### 方法 2：使用 SCP 上传

```bash
# 在本地执行（Windows PowerShell）
scp -r gif_server root@your-server-ip:/opt/

# 在服务器上
cd /opt/gif_server
```

### 步骤 5：安装项目依赖

```bash
cd /opt/gif_server
npm install --production
```

### 步骤 6：编译 TypeScript

```bash
npm run build
```

### 步骤 7：配置环境变量

```bash
# 复制环境变量模板
cp env.example .env

# 编辑环境变量
vi .env
```

**`.env` 文件配置示例：**

```bash
NODE_ENV=production
PORT=3000

# 数据目录（绝对路径）
DATA_DIR=/opt/gif_server/data

# 文件保留时间（小时）
# 测试环境：168（7天）
# 生产环境：48（2天）
RETENTION_HOURS=48

# 上传限制（MB）
MAX_UPLOAD_MB=200

# 业务限制
MAX_CLIP_DURATION_S=20
MAX_LIVE_DURATION_S=3

# FFmpeg 参数
DEFAULT_FPS=10
DEFAULT_WIDTH=480

# FFmpeg 路径（如果不在 PATH 中）
FFMPEG_PATH=/usr/bin/ffmpeg
```

### 步骤 8：创建数据目录

```bash
mkdir -p /opt/gif_server/data/uploads
mkdir -p /opt/gif_server/data/outputs
chmod -R 755 /opt/gif_server/data
```

### 步骤 9：安装 PM2（进程管理）

```bash
# 全局安装 PM2
sudo npm install -g pm2

# 验证安装
pm2 --version
```

### 步骤 10：配置 PM2 启动脚本

创建 `ecosystem.config.js`：

```bash
cd /opt/gif_server
vi ecosystem.config.js
```

**`ecosystem.config.js` 内容：**

```javascript
module.exports = {
  apps: [
    {
      name: 'gif-api',
      script: './dist/api/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '500M',
    },
    {
      name: 'gif-worker',
      script: './dist/worker/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '500M',
    },
  ],
}
```

创建日志目录：

```bash
mkdir -p /opt/gif_server/logs
```

### 步骤 11：启动服务

```bash
cd /opt/gif_server

# 启动服务
pm2 start ecosystem.config.js

# 查看服务状态
pm2 status

# 查看日志
pm2 logs

# 保存 PM2 配置（开机自启）
pm2 save
pm2 startup
```

### 步骤 12：配置防火墙

```bash
# 开放 3000 端口（仅用于本地 Nginx 代理，不对外开放）
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# 开放 80 和 443 端口（HTTP/HTTPS）
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 步骤 13：安装和配置 Nginx

#### Ubuntu/Debian 系统：
```bash
# 安装 Nginx
sudo apt install -y nginx

# 启动 Nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

#### OpenCloudOS 9 / Rocky Linux 9 / CentOS 系统：
```bash
# 安装 Nginx
sudo dnf install -y nginx  # OpenCloudOS 9 使用 dnf
# 或 sudo yum install -y nginx  # CentOS 7 使用 yum

# 启动 Nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 步骤 14：申请 SSL 证书（Let's Encrypt）

```bash
# 安装 acme.sh
curl https://get.acme.sh | sh
source ~/.bashrc

# 设置默认 CA
acme.sh --set-default-ca --server letsencrypt

# 停止 Nginx（申请证书需要）
sudo systemctl stop nginx

# 申请证书（替换为你的域名）
acme.sh --issue -d api.yourdomain.com --standalone

# 启动 Nginx
sudo systemctl start nginx

# 安装证书
sudo mkdir -p /etc/nginx/ssl
acme.sh --install-cert -d api.yourdomain.com \
  --key-file       /etc/nginx/ssl/api.yourdomain.com.key \
  --fullchain-file /etc/nginx/ssl/api.yourdomain.com.pem \
  --reloadcmd     "sudo systemctl reload nginx"
```

### 步骤 15：配置 Nginx 反向代理

创建 Nginx 配置文件：

```bash
sudo vi /etc/nginx/conf.d/gif_server.conf
```

**`/etc/nginx/conf.d/gif_server.conf` 内容：**

```nginx
# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

# HTTPS 反向代理
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL 证书
    ssl_certificate     /etc/nginx/ssl/api.yourdomain.com.pem;
    ssl_certificate_key /etc/nginx/ssl/api.yourdomain.com.key;

    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 上传文件大小限制（与 MAX_UPLOAD_MB 对齐）
    client_max_body_size 250m;
    client_body_timeout 300s;

    # 代理到后端服务
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # 请求头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 超时设置
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        
        # 缓冲设置
        proxy_buffering off;
    }

    # 健康检查
    location /healthz {
        proxy_pass http://127.0.0.1:3000/healthz;
        access_log off;
    }
}
```

测试并重载 Nginx：

```bash
# 测试配置
sudo nginx -t

# 重载配置
sudo systemctl reload nginx
```

### 步骤 16：验证部署

```bash
# 检查服务状态
pm2 status

# 检查 API 服务
curl http://localhost:3000/healthz

# 检查 HTTPS
curl https://api.yourdomain.com/healthz

# 查看日志
pm2 logs
```

### 步骤 17：配置小程序后台

在微信小程序后台配置：

1. **开发 → 开发管理 → 开发设置**
2. **服务器域名配置**：
   - **request 合法域名**：`https://api.yourdomain.com`
   - **uploadFile 合法域名**：`https://api.yourdomain.com`
   - **downloadFile 合法域名**：`https://api.yourdomain.com`

---

## 🔧 常用管理命令

### PM2 管理

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs
pm2 logs gif-api      # 只看 API 日志
pm2 logs gif-worker   # 只看 Worker 日志

# 重启服务
pm2 restart all
pm2 restart gif-api
pm2 restart gif-worker

# 停止服务
pm2 stop all
pm2 stop gif-api

# 删除服务
pm2 delete gif-api

# 查看监控
pm2 monit
```

### Nginx 管理

```bash
# 测试配置
sudo nginx -t

# 重载配置
sudo systemctl reload nginx

# 重启
sudo systemctl restart nginx

# 查看状态
sudo systemctl status nginx
```

### 查看日志

```bash
# PM2 日志
pm2 logs

# Nginx 访问日志
sudo tail -f /var/log/nginx/access.log

# Nginx 错误日志
sudo tail -f /var/log/nginx/error.log

# 系统日志
journalctl -u nginx -f
```

---

## 🛠️ 故障排查

### 1. 服务无法启动

```bash
# 检查 Node.js 版本
node --version

# 检查依赖是否安装
cd /opt/gif_server
npm list

# 检查编译是否成功
ls -la dist/

# 查看 PM2 日志
pm2 logs
```

### 2. 端口被占用

```bash
# 查看端口占用
sudo netstat -tlnp | grep 3000
sudo lsof -i :3000

# 修改端口（在 .env 文件中）
PORT=3001
```

### 3. FFmpeg 不可用

```bash
# 检查 FFmpeg 是否安装
ffmpeg -version

# 检查路径
which ffmpeg

# 在 .env 中指定路径
FFMPEG_PATH=/usr/local/bin/ffmpeg
```

### 4. 磁盘空间不足

```bash
# 检查磁盘使用
df -h

# 清理旧文件（手动）
find /opt/gif_server/data -type f -mtime +7 -delete

# 检查 RETENTION_HOURS 配置
cat .env | grep RETENTION_HOURS
```

### 5. 任务处理失败

```bash
# 检查 Worker 是否运行
pm2 status | grep worker

# 查看 Worker 日志
pm2 logs gif-worker

# 检查 FFmpeg
ffmpeg -version
```

### 6. HTTPS 证书问题

```bash
# 检查证书是否过期
sudo openssl x509 -in /etc/nginx/ssl/api.yourdomain.com.pem -noout -dates

# 手动续期证书
acme.sh --renew -d api.yourdomain.com --force
```

---

## 📊 监控和维护

### 设置定时任务清理旧文件

```bash
# 编辑 crontab
crontab -e

# 添加定时任务（每天凌晨 2 点清理）
0 2 * * * find /opt/gif_server/data -type f -mtime +3 -delete
```

### 监控服务状态

```bash
# 使用 PM2 监控
pm2 monit

# 或使用系统监控
htop
```

### 备份数据

```bash
# 备份数据库和配置
tar -czf backup-$(date +%Y%m%d).tar.gz \
  /opt/gif_server/data \
  /opt/gif_server/.env \
  /opt/gif_server/ecosystem.config.js
```

---

## 🔒 安全建议

1. **防火墙配置**：只开放必要的端口（80, 443）
2. **定期更新**：保持系统和软件包更新
3. **访问控制**：考虑添加 API 鉴权（当前版本未实现）
4. **限流**：在 Nginx 层面添加限流规则
5. **日志监控**：定期检查日志，发现异常访问

---

## 📝 注意事项

1. **文件保留时间**：生产环境建议设置为 48 小时，避免磁盘空间不足
2. **资源限制**：根据服务器配置调整 PM2 的 `max_memory_restart`
3. **并发处理**：Worker 服务单实例运行，如需提高处理能力可增加实例数
4. **域名解析**：确保域名正确解析到服务器 IP
5. **SSL 证书**：Let's Encrypt 证书每 90 天需要续期，acme.sh 会自动处理

---

## ✅ 部署检查清单

- [ ] Node.js 18+ 已安装
- [ ] FFmpeg 已安装并可用
- [ ] 代码已上传到服务器
- [ ] 依赖已安装（`npm install`）
- [ ] TypeScript 已编译（`npm run build`）
- [ ] 环境变量已配置（`.env`）
- [ ] 数据目录已创建
- [ ] PM2 已安装并配置
- [ ] 服务已启动（`pm2 status`）
- [ ] 防火墙已配置
- [ ] Nginx 已安装并配置
- [ ] SSL 证书已申请
- [ ] Nginx 反向代理已配置
- [ ] HTTPS 访问正常
- [ ] 小程序后台域名已配置
- [ ] 健康检查通过（`/healthz`）

---

完成以上步骤后，后端服务应该已经成功部署到腾讯轻量云服务器！

