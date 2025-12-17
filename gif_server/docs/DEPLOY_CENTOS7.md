# CentOS 7.9（轻量云）部署指南（Docker + Nginx + HTTPS）

> 目标：将 `gif_server` 部署到你的腾讯轻量云（CentOS 7.9），用二级域名提供服务。
> - 测试：保留 7 天（168h）
> - 生产：保留 48h

## 1) 安装 Docker / Docker Compose

### 安装 Docker
```bash
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io
sudo systemctl enable docker
sudo systemctl start docker
```

### 安装 Compose（docker compose 插件）
```bash
sudo yum install -y docker-compose-plugin
docker compose version
```

## 2) 上传代码到服务器
建议目录：
```bash
sudo mkdir -p /opt/gif_server
sudo chown -R $USER:$USER /opt/gif_server
```

把本地 `gif_server/` 整个目录上传到服务器 `/opt/gif_server`。

## 3) 准备数据目录与环境变量
```bash
cd /opt/gif_server
mkdir -p data
```

### 测试环境（7天）
```bash
export RETENTION_HOURS=168
```

### 生产环境（48小时）
```bash
export RETENTION_HOURS=48
```

你也可以把变量写进系统服务或 CI/CD 脚本中。

## 4) 启动服务
```bash
cd /opt/gif_server
docker compose up -d --build
docker compose ps
```

验证：
```bash
curl http://127.0.0.1:3000/healthz
```

## 5) 配置 Nginx HTTPS（二级域名）

### 安装 Nginx
```bash
sudo yum install -y epel-release
sudo yum install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 申请证书（推荐 acme.sh）
```bash
curl https://get.acme.sh | sh
source ~/.bashrc
acme.sh --set-default-ca --server letsencrypt

# 把 api.xxx.com 改成你的二级域名
sudo systemctl stop nginx
~/.acme.sh/acme.sh --issue -d api.xxx.com --standalone
sudo systemctl start nginx
```

安装证书：
```bash
sudo mkdir -p /etc/nginx/ssl
~/.acme.sh/acme.sh --install-cert -d api.xxx.com \
  --key-file       /etc/nginx/ssl/api.xxx.com.key \
  --fullchain-file /etc/nginx/ssl/api.xxx.com.pem \
  --reloadcmd     "sudo systemctl reload nginx"
```

### Nginx 反向代理配置
创建 `/etc/nginx/conf.d/gif_server.conf`：
```nginx
server {
  listen 80;
  server_name api.xxx.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name api.xxx.com;

  ssl_certificate     /etc/nginx/ssl/api.xxx.com.pem;
  ssl_certificate_key /etc/nginx/ssl/api.xxx.com.key;

  client_max_body_size 250m; # 上传上限（与 MAX_UPLOAD_MB 对齐）

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

重载：
```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6) 小程序后台配置
把 `https://api.xxx.com` 加到：
- request 合法域名
- uploadFile 合法域名
- downloadFile 合法域名

## 7) 常见问题
- **转码慢/失败**：先把 fps 降到 5~10、width 降到 360/480。
- **磁盘满**：确认生产 `RETENTION_HOURS=48` 生效，且 worker 正常运行。
- **安全**：上线建议加鉴权与限流（否则会被刷流量/占CPU）。