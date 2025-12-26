# 快速部署指南

> 最简化的部署步骤，适用于 Ubuntu 22.04 LTS 和 OpenCloudOS 9

## 📋 前置要求

- 服务器：腾讯轻量云（Ubuntu 22.04 LTS 或 OpenCloudOS 9）
- 域名：已解析到服务器 IP
- 权限：root 或 sudo 权限

## 🚀 一键安装脚本

### Ubuntu 22.04 LTS

```bash
#!/bin/bash
# 一键安装所有依赖（Ubuntu 22.04 LTS）

# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 FFmpeg
sudo apt install -y ffmpeg

# 安装 Nginx
sudo apt install -y nginx

# 安装 PM2
sudo npm install -g pm2

echo "✅ 所有软件安装完成！"
```

### OpenCloudOS 9

```bash
#!/bin/bash
# 一键安装所有依赖（OpenCloudOS 9）

# 更新系统
sudo dnf update -y

# 安装 EPEL 仓库
sudo dnf install -y epel-release

# 安装 Node.js 18
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs

# 安装 FFmpeg（需要 RPM Fusion 仓库）
sudo dnf install -y https://download1.rpmfusion.org/free/el/rpmfusion-free-release-9.noarch.rpm
sudo dnf install -y ffmpeg

# 安装 Nginx
sudo dnf install -y nginx

# 安装 PM2
sudo npm install -g pm2

echo "✅ 所有软件安装完成！"
```

## 📦 部署后端服务

### 1. 上传代码

```bash
# 创建目录
sudo mkdir -p /opt/gif_server
cd /opt

# 使用 Git 克隆（推荐）
sudo git clone https://your-repo-url/gif-toolbox.git
cd gif-toolbox/gif_server

# 或使用 SCP 上传（在本地执行）
# scp -r gif_server root@your-server-ip:/opt/
```

### 2. 安装依赖并编译

```bash
cd /opt/gif_server

# 安装依赖
npm install --production

# 编译 TypeScript
npm run build
```

### 3. 配置环境变量

```bash
# 复制模板
cp env.example .env

# 编辑配置
vi .env
```

**`.env` 文件内容：**

```bash
NODE_ENV=production
PORT=3000
DATA_DIR=/opt/gif_server/data
RETENTION_HOURS=48
MAX_UPLOAD_MB=200
MAX_CLIP_DURATION_S=20
DEFAULT_FPS=10
DEFAULT_WIDTH=480
FFMPEG_PATH=ffmpeg
```

### 4. 创建数据目录

```bash
mkdir -p /opt/gif_server/data/{uploads,outputs,tmp}
chmod -R 755 /opt/gif_server/data
```

### 5. 配置 PM2

创建 `ecosystem.config.js`：

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

### 6. 启动服务

```bash
cd /opt/gif_server

# 启动服务
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 保存配置（开机自启）
pm2 save
pm2 startup
```

### 7. 配置 Nginx 反向代理

创建 `/etc/nginx/conf.d/gif_server.conf`：

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/nginx/ssl/api.yourdomain.com.pem;
    ssl_certificate_key /etc/nginx/ssl/api.yourdomain.com.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 250m;
    client_body_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }

    location /healthz {
        proxy_pass http://127.0.0.1:3000/healthz;
        access_log off;
    }
}
```

### 8. 申请 SSL 证书

```bash
# 安装 acme.sh
curl https://get.acme.sh | sh
source ~/.bashrc

# 设置默认 CA
acme.sh --set-default-ca --server letsencrypt

# 停止 Nginx
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

### 9. 重载 Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 10. 配置防火墙

```bash
# 开放 80 和 443 端口
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 11. 验证部署

```bash
# 检查服务状态
pm2 status

# 检查 API 服务
curl http://localhost:3000/healthz

# 检查 HTTPS
curl https://api.yourdomain.com/healthz
```

### 12. 配置小程序后台

在微信小程序后台：
- **开发 → 开发管理 → 开发设置 → 服务器域名**
- 添加 `https://api.yourdomain.com` 到：
  - request 合法域名
  - uploadFile 合法域名
  - downloadFile 合法域名

## 🔧 常用命令

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs

# 重启服务
pm2 restart all

# 停止服务
pm2 stop all

# 查看 Nginx 状态
sudo systemctl status nginx

# 重载 Nginx 配置
sudo systemctl reload nginx
```

## 📝 完整文档

详细部署步骤请参考：
- [完整部署指南](./DEPLOY_TENCENT_CLOUD.md)
- [操作系统选择指南](./OS_SELECTION_GUIDE.md)
- [宝塔面板配置指南](./BT_PANEL_SETUP.md)

