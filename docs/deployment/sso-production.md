# SSO 生产接入清单（CVTE 统一门户登录）

把「CVTE 门户登录」从 op-fat 测试环境切到生产（home.cvte.com）需要的全部步骤。
代码已就绪，本文是**运维 + ITSM 接入清单**。相关代码：
- 门户 OAuth：`packages/shared/src/auth/cvte-portal-oauth.ts`
- loopback 回调：`packages/shared/src/auth/callback-server.ts`
- 主流程 handler：`packages/server-core/src/handlers/rpc/llm-connections.ts`（`cvte.START_OAUTH`）
- 中继：`packages/portal-key-relay/`（另见 `portal-key-relay.md`）
- 配置：`apps/electron/resources/config-defaults.json` → `enterprise.sso`

## 一、运行时流程（端到端）

```
1. 用户点「CVTE 门户登录」(设置→AI 网关行 或 onboarding)
2. App(preload) 起 loopback 回调服务：http://localhost:{6477-6576}/callback  ← 端口动态扫描
3. App 打开浏览器：
     https://home.cvte.com/portal/oauth2/authorize
       ?client_id={生产 clientId}
       &redirect_uri=http://localhost:{port}/callback
       &response_type=code
       &state={随机}
4. 用户在浏览器登录门户 → 门户回调 http://localhost:{port}/callback?code=…&state=…
5. App 回调服务收 code（校验 state）
6. App 换 token：POST https://home.cvte.com/portal/oauth2/token
     body(JSON)：{ grant_type:"authorization_code", code, redirect_uri }
     ⚠️ public client：无 client_secret、无 client_id、无 PKCE code_verifier
     → { access_token, expires_in(~120s) }
7. App 调中继：POST {生产relay}/api/resolve-key  { accessToken }
8. 中继(内网，持 CCH admin key)：
     a. GET  https://home.cvte.com/portal/oauth2/user  (Bearer access_token) → { account(用户名), simUid, … }
     b. GET  https://token.cvte.com/api/v1/users?q={account}&status=active → 精确匹配 name && isEnabled → userId
     c. GET  …/api/v1/users/{userId}/keys → 取 enabled key；无则(AUTO_CREATE_KEY=true) POST 自动建一把
     d. GET  …/api/v1/keys/{keyId}:reveal → 完整个人 key
     → { apiKey, identity }
9. App 用个人 key 配置网关连接 → 浏览器 deep-link workagents://settings/ai 回焦 App → 完成
```

## 二、接入清单

### ① 门户 client_id（走 ITSM 申请）

| 项 | 值 |
|---|---|
| 门户 host | `home.cvte.com`（生产）|
| 应用类型 | Desktop / Native App（**public client，无 client_secret**）|
| 授权类型 | authorization_code |
| **回调地址 redirect_uri** | `http://localhost:{port}/callback`，端口 **6477–6576 动态**（loopback，RFC 8252）|
| PKCE | 当前**未启用** |
| scope | 能访问 `/portal/oauth2/user`（拿 account/simUid）|

→ 回调地址是最大决策点，见 **三、回调地址**。

### ② 中继（portal-key-relay）生产部署

| env | 生产值 |
|---|---|
| `PORTAL_HOST` | `home.cvte.com` |
| `CCH_BASE` | `https://token.cvte.com` |
| `CCH_ADMIN_KEY` | 生产 admin-用户 API key（可吊销）|
| `CCH_AUTH_SCHEME` | `bearer` |
| `AUTO_CREATE_KEY` | `true`（用户无 key 时自动建）|

- **HTTPS**：用内网 CA 签发、桌面系统信任的证书（自签会让 App `fetch failed`）。
- **出站放通**：`home.cvte.com`（门户）+ `token.cvte.com`（CCH）。
- 仅内网可达（中继无应用层鉴权，靠网络层保护；用户身份由其 access_token 证明）。
- 部署细节见 `portal-key-relay.md`。

### ③ config-defaults.json 回填

```json
"enterprise": {
  "sso": {
    "portalHost": "home.cvte.com",
    "clientId":   "{生产 client_id}",
    "relayUrl":   "https://{生产中继内网域}"
  }
}
```

回填生产值后 `bun run check:release-config` 应通过（不再需要 `CRAFT_ALLOW_TEST_CONFIG=1`）。

### ④ 验证

真机点「CVTE 门户登录」→ 浏览器 home 登录 → 自动配好个人 key；查 `identity.userId` = 本人在 CCH 的真实 user id（不是工号 simUid）。

## 三、回调地址（关键决策，需门户/ITSM 确认）

当前实现 = **loopback 动态端口** `http://localhost:{6477-6576}/callback`。门户注册的 redirect_uri 必须接受它。四种方案：

| 方案 | 门户要求 | App 改动 |
|---|---|---|
| **A. loopback 任意端口（推荐，RFC 8252）** | 门户对 `http://localhost` / `http://127.0.0.1` 豁免端口精确匹配 | 无（当前实现）|
| **B. 固定 loopback 端口** | 门户精确匹配 `http://localhost:6477/callback` | 回调服务改固定端口（仿 ChatGPT `CALLBACK_PORT`）；端口被占用有失败风险 |
| **C. 自定义 scheme** | 门户支持 `workagents://auth/callback` | 改 deep-link 回调（deep-link 基建已有）|
| **D. 中继托管回调** | 门户回调到中继 HTTPS URL，中继把 code 中继回 App | 中继 + App 改动较大 |

> **op-fat 测试环境下方案 A（loopback 动态端口）已实测通过。** 生产 `home.cvte.com` 是否同样对 loopback 端口豁免精确匹配，**需向门户/ITSM 确认**——这是决定走 A 还是 B/C 的唯一前置。

## 四、待确认 / 决策点

1. **回调地址**（最关键）：home 门户对 loopback 动态端口的策略 → 决定 client_id 注册方式与是否改 App。
2. **PKCE**：当前 public client 无 PKCE。生产门户是否强制？（安全上推荐；需门户支持 + App 加 `code_challenge`/`code_verifier`）。
3. **生产中继**：新部署 vs 复用 test 中继改 `PORTAL_HOST`（op-fat→home，且 CCH 是同一生产 `token.cvte.com`）。
4. **回退**：SSO 失败时 App 走「手动配置 API Key」（已移除明文 fallback key，无静默兜底）。
