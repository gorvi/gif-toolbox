# 后端连接问题诊断指南

## 问题现象
小程序无法连接到后端服务 `http://192.168.71.117:3001`

## 诊断步骤

### 1. 确认后端服务正在运行

在命令行执行：
```bash
# Windows
netstat -ano | findstr :3001

# 应该看到类似输出：
# TCP    0.0.0.0:3001           0.0.0.0:0              LISTENING       <PID>
```

### 2. 测试浏览器访问

在浏览器中访问：
- `http://192.168.71.117:3001/healthz` - 应该返回 `{"ok":true}`
- `http://localhost:3001/healthz` - 应该返回 `{"ok":true}`

如果浏览器可以访问，说明后端服务正常。

### 3. 检查微信开发者工具设置

**重要：必须勾选"不校验合法域名"**

1. 打开微信开发者工具
2. 点击右上角"详情"
3. 在"本地设置"中勾选：
   - ✅ **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**

### 4. 检查防火墙

Windows 防火墙可能阻止了端口 3001：

```powershell
# 检查防火墙规则
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*3001*"}

# 如果需要，添加防火墙规则（以管理员身份运行）
New-NetFirewallRule -DisplayName "Node.js 3001" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
```

### 5. 检查后端监听地址

确认后端代码监听在 `0.0.0.0` 而不是 `localhost`：

```typescript
// gif_server/src/api/index.ts
app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`[api] listening on 0.0.0.0:${CONFIG.PORT}`)
})
// 注意：默认端口是 3000，如果设置了环境变量 PORT=3001，则使用 3001
```

### 6. 查看小程序控制台日志

在微信开发者工具的控制台中，查看是否有以下日志：

```
[后端连接测试] 尝试连接: http://192.168.71.117:3001
[request] GET http://192.168.71.117:3001/healthz
```

如果看到错误，根据错误信息排查：
- `domain list` → 检查开发者工具设置（步骤3）
- `ECONNREFUSED` → 检查后端是否运行、端口是否正确
- `Network Error` → 检查网络连接、防火墙

### 7. 真机调试注意事项

如果使用真机调试：
- **不能使用 `localhost` 或 `127.0.0.1`**
- 必须使用本机实际 IP 地址（如 `192.168.71.117`）
- 确保手机和电脑在同一局域网
- 确保防火墙允许端口 3001

### 8. 常见错误及解决方案

#### 错误：`request:fail url not in domain list`
**解决**：在开发者工具中勾选"不校验合法域名"

#### 错误：`ECONNREFUSED` 或 `connect failed`
**解决**：
1. 确认后端服务正在运行
2. 确认后端监听在 `0.0.0.0:3001`（不是 `localhost`）
3. 检查防火墙是否阻止端口 3001

#### 错误：`Network Error`
**解决**：
1. 检查网络连接
2. 确认 IP 地址正确
3. 尝试在浏览器中访问相同地址

#### 错误：`502 Bad Gateway`
**解决**：
1. 检查后端服务是否正常运行
2. 查看后端控制台是否有错误日志
3. 确认端口没有被其他程序占用

## 快速测试命令

```bash
# 测试后端健康检查
curl http://192.168.71.117:3001/healthz
curl http://localhost:3001/healthz

# 检查端口占用
netstat -ano | findstr :3001

# 检查防火墙（PowerShell，以管理员身份运行）
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*3001*"}
```

## 如果问题仍然存在

1. 查看后端控制台日志，确认是否有错误
2. 查看小程序控制台日志，记录完整错误信息
3. 尝试使用其他端口（如 3002）测试
4. 检查是否有代理或 VPN 影响网络连接

