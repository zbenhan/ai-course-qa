# AI 使用分享 · 现场互动站点

课程现场用：听众扫码进入 → 提交问题 → 投票选出最关心的问题 → 下载课件。

- **前端**：纯静态页面，托管在 **GitHub Pages**
- **后端**：零依赖 Node 服务，部署在**你自己的 VPS** 上，存问题与票数
- **二维码**：由脚本生成，可投屏也可转发

```
┌──────────────┐   HTTPS API   ┌──────────────┐
│ GitHub Pages │ ────────────► │  你的 VPS     │
│  提问/投票 UI │ ◄──────────── │  Node + JSON │
└──────────────┘               └──────────────┘
```

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `docs/` | 前端站点，GitHub Pages 从这里发布 |
| `docs/config.js` | **唯一需要改的配置文件**（接口地址、票数、课件列表） |
| `docs/files/` | 课件文件放这里 |
| `server/` | VPS 后端服务（含 Docker 与 systemd 两种部署方式） |
| `tools/` | 二维码生成、本地预览脚本 |

## 一、先部署后端（VPS）

后端零依赖，**不需要 `npm install`**，只要有 Node.js ≥ 18 即可。

### 方式 A：Docker（推荐）

```bash
# 1. 把 server 目录传到 VPS，例如 /opt/ai-course-qa/server
# 2. 进入目录并准备环境变量
cd /opt/ai-course-qa/server
cp .env.example .env
vi .env            # 改掉 ADMIN_TOKEN（必改）
# 3. 启动
docker compose up -d --build
curl http://127.0.0.1:8787/api/health
```

### 方式 B：systemd（没有 Docker）

```bash
# 1. 把 server 目录放到 /opt/ai-course-qa/server
# 2. 改 ai-course-qa.service 里的 ADMIN_TOKEN，然后：
sudo cp /opt/ai-course-qa/server/ai-course-qa.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-course-qa
curl http://127.0.0.1:8787/api/health
```

### 必须配 HTTPS

GitHub Pages 是 https 页面，浏览器会拦截它向 http 接口发起的请求，所以后端**必须对外提供 https**。

用 Caddy 最省事（自动申请续期证书）：

```bash
# 编辑 server/Caddyfile，把 qa.example.com 换成你的域名
sudo caddy reload --config /opt/ai-course-qa/server/Caddyfile
```

已有 Nginx 的话，等价配置：

```nginx
server {
    listen 443 ssl;
    server_name qa.example.com;
    ssl_certificate     /etc/letsencrypt/live/qa.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/qa.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> 没有域名时，可以用 `cloudflared tunnel` 把 `127.0.0.1:8787` 映射成一个 https 地址，无需域名和备案。
> 国内服务器绑域名对外提供 Web 服务通常需要 ICP 备案。

部署完成后验证：`curl https://qa.example.com/api/health` 返回 `{"ok":true,...}` 即可。

## 二、部署前端（GitHub Pages）

1. 把 `docs/config.js` 里的 `API_BASE` 改成你的后端地址：

   ```js
   API_BASE: 'https://qa.example.com',
   ```

2. 推送仓库后，在 GitHub 仓库 **Settings → Pages** 里选择：
   - Source: `Deploy from a branch`
   - Branch: `main` / 目录选 `/docs`

3. 等 1～2 分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

## 三、生成分享二维码

```bash
npm install
npm run qrcode -- https://<用户名>.github.io/<仓库名>/
```

会生成 `docs/qrcode.png` 和 `docs/qrcode.svg`。页面顶部的二维码区会自动读取 `docs/qrcode.png`，投屏时直接展示即可；把 png 发给听众也能直接扫码。

## 四、放课件

1. 把 PDF / PPT 拖进 `docs/files/`。
2. 修改 `docs/config.js`：

```js
COURSEWARE: [
  { title: 'AI 使用分享 · 课程课件', desc: 'PDF，约 3 MB', url: 'files/ai-course-slides.pdf' },
],
```

## 五、本地预览 / 联调

```bash
# 终端 1：起后端
npm run server

# 终端 2：起静态站点
npm run serve
# 浏览器打开 http://localhost:5173/?api=http://localhost:8787
```

## 六、现场使用

- 开讲前把页面投屏，让听众扫码。
- 每台设备最多 3 票（`config.js` 的 `MAX_VOTES` 与后端 `MAX_VOTES_PER_DEVICE` 需一致）。
- 页面每 5 秒自动刷新，票数和排行实时变化。
- 发现垃圾提问：点页面右下角「管理员」→ 输入 `ADMIN_TOKEN` → 问题右侧出现「删除」按钮。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/questions` | 问题列表 + 票数 + 统计 |
| POST | `/api/questions` | 提交问题，body `{ text, author }` |
| POST | `/api/votes` | 投票，body `{ questionId }` |
| DELETE | `/api/questions/:id` | 删除问题，需请求头 `x-admin-token` |

所有请求都带 `x-device-id` 请求头（前端自动生成），服务端据此限制票数。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `server/data` | 数据文件目录，Docker 下为 `/data` |
| `MAX_VOTES_PER_DEVICE` | `3` | 每设备最大票数 |
| `ADMIN_TOKEN` | 空 | 管理员令牌，为空则无法删除问题 |
| `ALLOWED_ORIGINS` | `*` | 允许的网页来源，多个逗号分隔，建议收紧为你的站点地址 |
| `RATE_LIMIT_PER_MIN` | `30` | 单 IP 每分钟请求上限 |

数据保存在 `DATA_DIR/data.json`，备份这个文件即可。

## 常见问题

- **页面顶部提示「后端接口还没配置」**：`docs/config.js` 的 `API_BASE` 仍是占位域名。
- **页面显示「无法连接后端接口」**：多为 https 证书、域名解析或 CORS；先用 `curl https://你的域名/api/health` 确认后端可达。
- **投票提示「票已用完」**：同一浏览器已投满 3 票；清缓存或换设备可重置（防刷强度按需自行调整）。
- **二维码不显示**：还没执行 `npm run qrcode`，或 `docs/qrcode.png` 未提交。
