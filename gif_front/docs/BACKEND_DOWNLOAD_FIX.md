# 后端文件下载优化建议

## 问题
小程序下载 GIF 文件时出现 `socket hang up` 错误。

## 可能原因
1. 后端发送文件时没有设置正确的响应头
2. 文件过大，传输超时
3. 连接在传输过程中被中断

## 后端优化建议

### 1. 设置正确的响应头

在 `gif_server/src/api/index.ts` 的 `/v1/files/:fileId` 接口中：

```typescript
app.get('/v1/files/:fileId', async (req, res) => {
  const fileId = req.params.fileId
  const file = await get<FileRow>(db, `SELECT * FROM files WHERE id = ?`, [fileId])
  if (!file) return res.status(404).json({ code: 404, msg: '文件不存在' })
  
  // 设置响应头
  res.setHeader('Content-Type', 'image/gif')
  res.setHeader('Content-Disposition', `inline; filename="${file.original_name || 'output.gif'}"`)
  
  // 如果文件很大，考虑使用流式传输
  const fs = require('fs')
  const fileStream = fs.createReadStream(file.abs_path)
  fileStream.pipe(res)
  
  // 或者使用 sendFile（Express 会自动处理）
  // res.sendFile(file.abs_path, {
  //   headers: {
  //     'Content-Type': 'image/gif',
  //   },
  // })
})
```

### 2. 增加超时时间

在 Express 应用中设置更长的超时时间：

```typescript
// 在 app.listen 之前
app.timeout = 120000 // 120秒
```

### 3. 使用流式传输

对于大文件，使用流式传输而不是一次性加载到内存：

```typescript
const fs = require('fs')
const fileStream = fs.createReadStream(file.abs_path)
fileStream.pipe(res)
```

### 4. 添加错误处理

```typescript
fileStream.on('error', (err) => {
  console.error('[file download error]', err)
  if (!res.headersSent) {
    res.status(500).json({ code: 500, msg: '文件读取失败' })
  }
})
```

## 前端已做优化

- ✅ 添加了重试机制（最多3次）
- ✅ 增加超时时间到60秒
- ✅ 优化了错误提示

## 测试步骤

1. 修改后端代码（按照上述建议）
2. 重启后端服务
3. 在小程序中重新测试视频转GIF
4. 查看控制台日志，确认下载是否成功

