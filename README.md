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

## 生产部署（Zeabur · 推荐）

单体 Docker：`API + 前端 + SQLite`，适合轻量化上云。

### 方式 A：Dashboard（推荐首次）

1. 打开 [Zeabur Dashboard](https://zeabur.com/dashboard)，用 GitHub 登录
2. **New Project** → 选择 **CityCanvas** 仓库（`BruzeLam/CityCanvas`）
3. Zeabur 会自动识别根目录 `Dockerfile` 并用 Docker 构建
4. 进入服务 → **Variables**，添加：

```
JWT_SECRET=随机长字符串（openssl rand -hex 32）
DATABASE_PATH=/data/citycanvas.db
NODE_ENV=production
```

5. 进入 **Volumes** → **Add Volume**：
   - Path：`/data`（SQLite 持久化，重启不丢数据）
6. 点击 **Deploy** / 等待 Git push 自动部署
7. 在 **Networking** 绑定域名（或使用 Zeabur 提供的 `*.zeabur.app`）

> Vercel 上的旧静态部署不再包含账号与云端存档，请改用 Zeabur 域名。

### 方式 B：CLI

```bash
npx zeabur@latest auth login
cd CityCanvas
npx zeabur@latest deploy
```

部署后在 Dashboard 补全 `JWT_SECRET` 和 `/data` 卷（与方式 A 相同）。

### 本地 Docker 验证

```bash
docker build -t citycanvas .
docker run -p 3000:3000 -v citycanvas-data:/data \
  -e JWT_SECRET=test-secret-for-local \
  -e NODE_ENV=production \
  citycanvas
```

打开 http://localhost:3000

## 生产部署（通用 Docker）

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
| `PORT` | 端口（Zeabur 自动注入，默认 `8080`） |
| `HOST` | 监听地址，默认 `0.0.0.0` |

## License

MIT
