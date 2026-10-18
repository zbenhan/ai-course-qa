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

## 一、后端部署（VPS，systemd）

后端零依赖，**不需要 `npm install`**，只要有 Node.js ≥ 18 即可。当前部署实况：

| 项目 | 值 |
| --- | --- |
| 代码目录 | `/opt/ai-course-qa/server` |
| 数据目录 | `/opt/ai-course-qa/data`（`data.json`，备份这个文件即可） |
| systemd 服务 | `ai-course-qa`，监听 `127.0.0.1:8787`，开机自启 |
| 对外地址 | `https://aiqa.valuegu.com` |
| nginx 配置 | `/etc/nginx/sites-available/qa-aiqa.conf` |
| 证书 | `/etc/letsencrypt/live/aiqa.valuegu.com/`，由 `certbot.timer` 自动续期 |

常用运维命令：

```bash
systemctl status ai-course-qa     # 查看状态
systemctl restart ai-course-qa    # 重启
journalctl -u ai-course-qa -f     # 实时日志
curl https://aiqa.valuegu.com/api/health
```

### 换一台服务器重新部署

```bash
# 1. 上传 server/src/index.js 到 /opt/ai-course-qa/server/src/
# 2. 用 server/ai-course-qa.service 建服务（改掉 ADMIN_TOKEN），然后：
sudo cp ai-course-qa.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ai-course-qa
# 3. 建 nginx vhost（模板 server/nginx-aiqa.conf.example），再签证书：
sudo certbot --nginx -d aiqa.你的域名.com --non-interactive --agree-tos --redirect
```

> 也可以用 Docker，`server/docker-compose.yml` 一条命令起容器，与 systemd 二选一即可。

### 必须配 HTTPS

GitHub Pages 是 https 页面，浏览器会拦截它向 http 接口发起的请求，所以后端**必须对外提供 https**。

本项目用 nginx + certbot：vhost 先只监听 80 端口并反代到 `127.0.0.1:8787`（模板见 `server/nginx-aiqa.conf.example`），然后执行

```bash
sudo certbot --nginx -d aiqa.valuegu.com --non-interactive --agree-tos --redirect
```

certbot 会自动补上 443 监听、证书路径，并添加 80 → 443 跳转。

> 子域名的 DNS 必须设为 **仅 DNS（灰云）**，走 Cloudflare 橙云会拦截 HTTP-01 校验。
> 不想用 certbot 也可以改用 Caddy 自动 HTTPS，见 `server/Caddyfile`。

部署完成后验证：`curl https://aiqa.valuegu.com/api/health` 返回 `{"ok":true,...}` 即可。

## 二、部署前端（GitHub Pages）

1. 把 `docs/config.js` 里的 `API_BASE` 改成你的后端地址：

   ```js
   API_BASE: 'https://aiqa.valuegu.com',
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

会生成 `docs/qrcode.png` 和 `docs/qrcode.svg`。网页本身不显示二维码，把 png 单独发给听众、或另外投屏展示即可扫码。

## 四、放课件

1. 把 PDF / PPT 拖进 `docs/files/`。
2. 修改 `docs/config.js`：

```js
COURSEWARE: [
  { title: '分行批发业务 AI 赋能与行内外系统实战', desc: 'PPTX，约 26 MB', url: 'files/ai-course-slides.pptx' },
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
