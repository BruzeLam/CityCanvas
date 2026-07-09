# CityCanvas

**架空城市地图绘制器** — 专注城市尺度的自然地理与路网规划。

## 功能

- 地貌绘制：陆地 / 海洋 / 山地（自由手绘、多边形、矩形）
- 河流与四级道路网
- 选择编辑、橡皮擦、顶点拖拽
- **账号系统**：邮箱注册登录
- **云端存档**：SQLite 持久化，自动保存
- 导出 PNG / 本地 .md 备份

## 本地开发

```bash
npm install
cp .env.example .env
npm run dev
```

- 前端：http://localhost:5173
- API：http://localhost:3000（Vite 代理 `/api`）

## 生产部署（Zeabur / Railway / Docker）

```bash
docker build -t citycanvas .
docker run -p 3000:3000 -v citycanvas-data:/data \
  -e JWT_SECRET=你的随机密钥 \
  citycanvas
```

环境变量：

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 签名密钥（必填） |
| `DATABASE_PATH` | SQLite 路径，默认 `/data/citycanvas.db` |
| `PORT` | 端口，默认 `3000` |

单体服务同时提供 API 和静态前端，SQLite 文件需挂载持久卷。

## License

MIT
