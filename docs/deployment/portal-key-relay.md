# 部署：portal-key-relay（HTTPS）

把用户门户 token 换成其个人 CCH（token.cvte.com）网关 key 的内网中继。桌面 app 的
SSO 闭环（`enterprise.sso.relayUrl`）调用它。源码：`packages/portal-key-relay/`。

## 架构

```
桌面 app(Node undici fetch, HTTPS)
        │  POST https://key-relay.<内网域>/api/resolve-key  { accessToken }
        ▼
   nginx/caddy（TLS 终止，内网证书）
        │  proxy_pass http://127.0.0.1:8788
        ▼
   portal-key-relay（仅监听 127.0.0.1:8788，持 CCH admin 凭据）
        │  ① GET  home.cvte.com/portal/oauth2/user   (Bearer 用户token)
        │  ② GET  token.cvte.com/api/v1/users/{id}/keys      (admin 凭据)
        │  ③ GET  token.cvte.com/api/v1/keys/{kid}:reveal    (admin 凭据)
        ▼  → { apiKey, identity }
```

**为什么必须 HTTPS**：`relayUrl` 由 app 主进程的 Node fetch(undici) 调用，会校验 TLS。
证书必须被桌面机器信任 —— 用**企业内网 CA 签发**的证书（已在桌面系统信任库），不能用
自签证书（否则 app 端 `fetch failed`）。

## 前置：用可吊销的 admin-用户 key（不要用裸 ADMIN_TOKEN）

裸 `ADMIN_TOKEN` 静态、不可吊销。改用 CCH 的「admin 用户 API key」（可吊销/审计/轮换）：

1. CCH 上把某服务账号 `users.role = 'admin'`。
2. 给它建一把 API key。
3. CCH 开 `ENABLE_API_KEY_ADMIN_ACCESS=true`。
4. 中继用这把 key + `CCH_AUTH_SCHEME=bearer`（见下）。

## 步骤

### 1. 部署中继（二选一）

**systemd（裸机/VM）** —— 用 `deploy/craft-key-relay.service`：

```bash
sudo cp -r packages/portal-key-relay /opt/craft-key-relay
curl -fsSL https://bun.sh/install | bash   # 或离线装 bun 到 /usr/local/bin
# 凭据放 chmod-600 的 EnvironmentFile，绝不进 unit 文件：
sudo tee /etc/craft-key-relay.env >/dev/null <<'EOF'
CCH_ADMIN_KEY=<admin-用户 API key>
EOF
sudo chmod 600 /etc/craft-key-relay.env
sudo cp packages/portal-key-relay/deploy/craft-key-relay.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now craft-key-relay
```

unit 已预置 `PORTAL_HOST=home.cvte.com`、`CCH_BASE=https://token.cvte.com`、
`CCH_AUTH_SCHEME=bearer`。中继仅监听本机 `127.0.0.1:8788`（由 nginx 反代）。

**Docker** —— 用 `Dockerfile`（监听 8788）：

```bash
docker build -t craft-key-relay packages/portal-key-relay
docker run -d --name craft-key-relay --restart=always \
  -p 127.0.0.1:8788:8788 \
  -e PORTAL_HOST=home.cvte.com -e CCH_BASE=https://token.cvte.com \
  -e CCH_AUTH_SCHEME=bearer -e CCH_ADMIN_KEY=<admin-用户 API key> \
  craft-key-relay
```

### 2. nginx 前置 TLS（`deploy/nginx.conf`）

把内网证书 + 私钥放好，反代到 `127.0.0.1:8788`：

```bash
sudo cp packages/portal-key-relay/deploy/nginx.conf /etc/nginx/conf.d/key-relay.conf
# 改 server_name + ssl_certificate / ssl_certificate_key 路径
sudo nginx -t && sudo systemctl reload nginx
```

### 3. 网络收口

- 中继 8788 只绑 `127.0.0.1`（systemd/docker 都已如此），外部只能经 nginx 443 访问。
- 防火墙限制 443 仅桌面机网段可达（中继无应用层鉴权，靠网络层保护）。
- 中继到 `home.cvte.com` / `token.cvte.com` 出站放通。

### 4. 回填 app 配置

`apps/electron/resources/config-defaults.json` 的 `enterprise.sso.relayUrl` 改成
`https://key-relay.<内网域>`（无尾斜杠），并把 `portalHost`/`clientId` 一并改为生产值。
改完 `bun run check:release-config` 应通过（不再需要 `CRAFT_ALLOW_TEST_CONFIG`）。

### 5. 验证

```bash
curl https://key-relay.<内网域>/healthz          # → ok
# app 内：设置→AI→网关行「CVTE 门户登录」→ 门户登录 → 应配好个人 key（无 fetch failed）
```

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| app 端 `fetch failed` | relayUrl 不可达 / TLS 证书不被桌面信任 / 中继没起。先 `curl .../healthz`，再查证书链是否在系统信任库。 |
| `404 user has no key` | 用户在 CCH 无可用 key。`AUTO_CREATE_KEY=true` 可自动建一把，或让用户自助建。 |
| `403` / `auth.api_key_admin_disabled` | CCH 没开 `ENABLE_API_KEY_ADMIN_ACCESS`，或凭据不是 admin 用户的 key / scheme 不对（应 `CCH_AUTH_SCHEME=bearer`）。 |
| `502 ... simUid` | 门户返回的 simUid 非纯数字，无法映射 CCH userId。 |

## 退役路径（最优）

请 CCH 团队加一个「凭门户 access_token 取自己 key」的 self 端点；届时桌面可直连，
中继与任何 admin 凭据都可下线。
