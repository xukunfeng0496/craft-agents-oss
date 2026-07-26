# 内网会话分享 viewer 部署指南（D11）

> 目标：让 Work Agents 的"分享会话"功能把 transcript 存到 **CVTE 内网**，而不是公网 `agents.craft.do`。
> 决策依据：`docs/CUSTOMIZATIONS.md` D11。代码侧机制已就位（`enterprise.viewerUrl` + `resolveViewerUrl()`），本文档是**运维部署部分**。

## 0. 必须先理解：这是两个部署件

开源仓库里的 `apps/viewer` **只有前端**（Vite + React SPA）。真正存 transcript 的 `/s/api` 后端是 Craft 用 Cloudflare Pages Functions（R2 对象存储）实现的，**不在仓库里**。`apps/viewer/public/_redirects` 那句注释就是铁证：

```
# API routes are handled by functions (automatic in Cloudflare Pages)
```

所以内网部署 = **前端（仓库构建）+ 后端（自建）**，同源服务在一个域名下：

```
https://agents-viewer.gz.cvte.cn
├── /s/                  → 前端 SPA（apps/viewer 构建产物）
├── /s/{id}             → 前端 SPA 路由（渲染某个分享）
├── /s/assets/*         → 前端静态资源
└── /s/api[/{id}]       → 后端存储服务（自建，本文档 §2）
```

> 域名建议挂在 `*.gz.cvte.cn` 或 `*.cvte.com` 下——这两个后缀已在 `config-defaults.json` 的 `enterprise.noProxyDomains` 里，客户端上传时自动绕过代理，无需额外配置。

## 1. 后端必须实现的 API 契约（从代码实测提取）

客户端（`SessionManager`）与前端（`apps/viewer/src/App.tsx`）对后端的全部期望：

| 方法 | 路径 | 请求体 | 成功响应 | 调用方 |
|------|------|--------|----------|--------|
| `POST` | `/s/api` | `StoredSession` JSON（整段会话） | `201` + `{ "id": string, "url": string }`，`url` 是用户点开的完整分享链接 | 客户端 `shareToViewer` |
| `PUT` | `/s/api/{id}` | `StoredSession` JSON | `200` | 客户端 `updateShare` |
| `DELETE` | `/s/api/{id}` | — | `200` | 客户端 `revokeShare` + 删除会话时清理 |
| `GET` | `/s/api/{id}` | — | `200` + `StoredSession` JSON；不存在返回 `404` | 前端渲染分享页 |

约束（同样来自代码）：

- **`id` 字符集**：前端路由正则是 `^/s/([a-zA-Z0-9_-]+)$`，所以后端生成的 id 只能用 `[A-Za-z0-9_-]`。
- **`POST` 返回的 `url`**：客户端原样存为分享链接展示给用户，应为 `{viewerUrl}/s/{id}`。
- **413**：transcript 可能很大，客户端对 `413` 有专门提示（"会话文件太大无法分享"），后端应在超限时返回 `413`。
- **无鉴权头**：客户端 `fetch` **不发任何 Authorization/Cookie**。所以后端默认是无鉴权的——靠**网络层限制**（仅内网可达 / IP 白名单）来保护，**不要**加"必须带 token"的强制鉴权，否则客户端直接 403。
- **后端不需要理解 `StoredSession` 结构**：原样存原样取即可（可选做 `id`+`messages` 字段的基础校验，对齐前端的合法性判断）。

## 2. 后端实现：`packages/session-share-server`（已实现，开箱即用）

> **✅ 已落地为真实的可部署包**：`packages/session-share-server/`。Bun.serve + 可插拔存储（文件系统 / S3·MinIO，env 选择）；9 个 handler 单测 + 文件系统&MinIO 双存储本地实测 + 前端同源端到端实测（渲染分享 + 零外部请求）均通过。
>
> - 跑起来：`cd packages/session-share-server && bun install && PUBLIC_BASE=https://你的内网域名 bun run src/index.ts`
> - 部署产物：`Dockerfile`、`deploy/docker-compose.yml`（nginx+backend turnkey）、`deploy/craft-share.service`（systemd）、`deploy/nginx.conf` / `deploy/nginx.compose.conf`
> - 配置与契约：见 `packages/session-share-server/README.md`
> - **存储选型**：单 VM / CCloud+持久卷 用 `STORAGE=fs`；CCloud 临时 Pod / 多副本用 `STORAGE=s3`（配 `S3_*`，MinIO 需 `S3_ENDPOINT`+`S3_FORCE_PATH_STYLE=true`）

下方为同等逻辑的最小内联参考（与包内实现一致，便于快速理解）；**实际部署请用上面的包**。

```ts
// session-share-server.ts
// 运行：PUBLIC_BASE=https://agents-viewer.gz.cvte.cn DATA_DIR=/var/lib/craft-share bun session-share-server.ts
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.PORT ?? 8787)
// 用户点开分享时的公网/内网根（必须与 enterprise.viewerUrl 一致），结尾不带斜杠
const PUBLIC_BASE = (process.env.PUBLIC_BASE ?? `http://localhost:${PORT}`).replace(/\/$/, '')
const DATA_DIR = process.env.DATA_DIR ?? './session-store'
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 25 * 1024 * 1024) // 超过 → 413

mkdirSync(DATA_DIR, { recursive: true })

// id 字符集必须匹配前端路由正则 [a-zA-Z0-9_-]
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
function newId(len = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let s = ''
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return s
}
const fileFor = (id: string) => join(DATA_DIR, `${id}.json`)
// 防路径穿越：只接受已知 id 字符集
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

Bun.serve({
  port: PORT,
  maxRequestBodySize: MAX_BYTES + 1024,
  async fetch(req) {
    const { pathname } = new URL(req.url)

    // POST /s/api —— 新建分享
    if (pathname === '/s/api' && req.method === 'POST') {
      const body = await req.arrayBuffer()
      if (body.byteLength > MAX_BYTES) return new Response('Too large', { status: 413 })
      let parsed: any
      try { parsed = JSON.parse(new TextDecoder().decode(body)) } catch { return new Response('Bad JSON', { status: 400 }) }
      if (!parsed?.id || !Array.isArray(parsed?.messages)) return new Response('Invalid session', { status: 400 })
      const id = newId()
      writeFileSync(fileFor(id), Buffer.from(body))
      return Response.json({ id, url: `${PUBLIC_BASE}/s/${id}` }, { status: 201 })
    }

    // GET|PUT|DELETE /s/api/:id
    const m = pathname.match(/^\/s\/api\/([^/]+)$/)
    if (m) {
      const id = m[1]
      if (!validId(id)) return new Response('Bad id', { status: 400 })
      const f = fileFor(id)
      if (req.method === 'GET') {
        if (!existsSync(f)) return new Response('Not found', { status: 404 })
        return new Response(readFileSync(f), { headers: { 'Content-Type': 'application/json' } })
      }
      if (req.method === 'PUT') {
        const body = await req.arrayBuffer()
        if (body.byteLength > MAX_BYTES) return new Response('Too large', { status: 413 })
        if (!existsSync(f)) return new Response('Not found', { status: 404 })
        writeFileSync(f, Buffer.from(body))
        return new Response(null, { status: 200 })
      }
      if (req.method === 'DELETE') {
        if (existsSync(f)) rmSync(f)
        return new Response(null, { status: 200 }) // 幂等：不存在也算成功
      }
    }
    return new Response('Not found', { status: 404 })
  },
})
console.log(`[session-share] :${PORT} store=${DATA_DIR} public=${PUBLIC_BASE}`)
```

用 systemd 常驻（示例）：

```ini
# /etc/systemd/system/craft-share.service
[Unit]
Description=Work Agents session-share backend
After=network.target
[Service]
Environment=PORT=8787
Environment=PUBLIC_BASE=https://agents-viewer.gz.cvte.cn
Environment=DATA_DIR=/var/lib/craft-share
ExecStart=/usr/local/bin/bun /opt/craft-share/session-share-server.ts
Restart=always
[Install]
WantedBy=multi-user.target
```

## 3. 构建前端（外部依赖已拔，自包含）

> **✅ 已加固**：`apps/viewer` 的 CVTE 构建已移除全部外部依赖——Plausible 分析、Google Fonts、Header 里的 `agents.craft.do` 外链。代码块改用系统等宽字体兜底。端到端实测加载分享页时**零外部网络请求**（CDP 抓包确认）。

```bash
# 仓库根
cd apps/viewer
bun install
bun run build        # 产物在 apps/viewer/dist/（需 monorepo，依赖 @craft-agent/core+ui）
```

产物结构（注意 `base:'/s/'`，资源引用是 `/s/assets/*` 但文件物理在 `dist/assets/`，需要在服务层做前缀重写）：

```
dist/
├── index.html        # 引用 /s/assets/index-*.js、/s/assets/index-*.css
├── assets/*          # JS/CSS 分块
└── _redirects        # Cloudflare 约定（自托管用 nginx 时改写成 §4）
```

把 `dist/` 同步到 web 根，例如 `/var/www/craft-viewer/dist/`。

## 4. nginx 反代 + 静态服务（把 `_redirects` 翻成 nginx）

```nginx
server {
  listen 443 ssl;
  server_name agents-viewer.gz.cvte.cn;
  # ssl_certificate / ssl_certificate_key ...

  root /var/www/craft-viewer/dist;
  client_max_body_size 25m;            # 与后端 MAX_BYTES 对齐，否则大会话被 nginx 先拦成 413

  # 1) API → 后端（必须在 SPA 兜底之前）
  location = /s/api      { proxy_pass http://127.0.0.1:8787; proxy_set_header Host $host; }
  location ^~ /s/api/    { proxy_pass http://127.0.0.1:8787; proxy_set_header Host $host; }

  # 2) 构建资源：/s/assets/* 物理在 dist/assets/*，去掉 /s 前缀
  location ^~ /s/assets/ { rewrite ^/s/assets/(.*)$ /assets/$1 break; }

  # 3) 其余 /s/* 一律回 index.html（SPA 路由，含 /s/{id} 分享页）
  location ^~ /s/        { try_files $uri /index.html; }
}
```

## 5. 接通客户端：回填 `enterprise.viewerUrl`

编辑 `apps/electron/resources/config-defaults.json`，在 `enterprise` 块加一行：

```jsonc
{
  "enterprise": {
    // ... 现有字段 ...
    "viewerUrl": "https://agents-viewer.gz.cvte.cn"   // 结尾不带斜杠或 /s
  }
}
```

机制（`resolveViewerUrl()`）：

- **配了** `viewerUrl` → 分享走这个内网地址（`POST {viewerUrl}/s/api`）。
- **没配**（当前状态）→ 企业版分享**禁用**，点分享报"未配置内网 viewer"，**杜绝默认外流到 craft.do**。
- 非企业构建 → 保留上游 craft.do 行为。

改完随新版本下发即可生效（`config-defaults.json` 每次启动从 bundled 同步覆盖到 `~/.workagent/`）。**不需要改代码、不需要重新验证客户端逻辑**——只是从"禁用"切到"指向内网"。

## 6. 安全 / 加固清单（上线前过一遍）

- [ ] **网络层限制**：`/s/api` 无鉴权（客户端不发凭证），必须靠"仅内网可达 / IP 白名单 / mTLS"保护，别让公网摸到。
- [x] ~~**前端的外部依赖要拔**~~ **已完成**：`apps/viewer` 已移除 Plausible + Google Fonts + craft.do 外链，端到端实测零外部请求。
- [x] ~~**存储后端选型**~~ **已实现两套**：`packages/session-share-server` 的 `STORAGE=fs|s3`（文件系统 + S3/MinIO，env 切换，均已本地验证）。
- [ ] **容量与清理**：transcript 累积无上限，加定期清理或 TTL（业务自定，比如 90 天）。
- [ ] **`client_max_body_size` 与后端 `MAX_BYTES` 必须一致**，否则一端 413、另一端放行，行为不一致。
- [ ] **HTTPS**：客户端 `fetch` 不强制，但 transcript 含内部数据，内网也建议 TLS。

## 7. 验证（部署后自检）

```bash
BASE=https://agents-viewer.gz.cvte.cn
# 1) POST 新建（用一个最小合法会话）
ID_URL=$(curl -s -X POST "$BASE/s/api" -H 'Content-Type: application/json' \
  -d '{"id":"t","messages":[]}')
echo "$ID_URL"                       # 期望 {"id":"...","url":"https://.../s/..."}
ID=$(echo "$ID_URL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
# 2) GET 取回
curl -s "$BASE/s/api/$ID" | head -c 120   # 期望回原 JSON
# 3) 浏览器打开 $BASE/s/$ID —— 应渲染出会话
# 4) DELETE 撤销
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/s/api/$ID"   # 期望 200
# 5) 再 GET —— 期望 404
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/s/api/$ID"            # 期望 404
```

客户端侧：配好 `viewerUrl` 重打包后，在 App 里对任一会话点"分享"，应返回内网 `/s/{id}` 链接并能打开。
