# CVTE 门户 SSO 对接契约（OAuth 2.0）

> 来源：技能市场 `portal-sso` 技能（作者 huangweihong，v1.0.0，2026-04-10）。
> `https://skills.gz.cvte.cn/skill/portal-sso`（下载需登录，故关键契约在此固化）。
> 用途：Work Agents 启动时走统一门户登录 → 拿用户身份 → 换取个人网关 API Key → 自动完成配置闭环（§二.1 / §六）。

## 门户环境

| 环境 | host | 域名校验 | 注册方式 |
|------|------|----------|----------|
| 测试 fat/uat | `op-fat.cvte.com` | **不生效**（本地开发可用 `localhost`/loopback 回调） | 联系 **huangweihong** 注册业务系统拿 `client_id` |
| 生产 | `home.cvte.com` | **生效**（回调域名必须与门户注册一致，否则 `4000004`） | [ITSM](https://itsm.cvte.com/servicedesk/customer/portals) 提单给 IT 客服 |

## OAuth 2.0 authorization_code 流程（桌面端选这个，无需 client_secret）

**Step 1 — 授权**（浏览器打开）：
```
GET https://{host}/portal/oauth2/authorize
  ?client_id={clientId}
  &redirect_uri={callback}      # URLSearchParams 自动编码，勿手动二次 encode
  &response_type=code
  &state={state}                # 门户原样返回
```
用户门户登录授权后，门户重定向到 `redirect_uri?code=xxx`。

**Step 3 — 换 access_token**（无 client_secret！）：
```
POST https://{host}/portal/oauth2/token
Content-Type: application/json
{ "grant_type":"authorization_code", "code":"<code，120s 有效>", "redirect_uri":"<与 Step1 一致>" }
→ { "access_token":"...", "expires_in":120 }
```

**Step 4 — 取用户信息**：
```
GET https://{host}/portal/oauth2/user
Authorization: Bearer <access_token>   # 120s 有效
→ { "id":"99a16d1c...(hex)", "account":"<域账号>", "name":"...", "email":"...@cvte.com",
    "telephone":"...", "gender":"1", "accountType":"2", "simUid":"00005452", "username":"..." }
```

错误码：authorize `4000001` client_id 缺、`4000002` 无权限、`4000003` app 不存在、`4000004` 业务域名无权限、`5000001/2` 服务端；token `4000004` code 无效/过期（120s）。

## 桌面端接入要点（Work Agents）

- **模式选 OAuth 2.0**（非 CAS）：标准 authorization_code，**无 client_secret**，public client，适合桌面；CAS 模式需 IAC 凭证（`x-iac-token`，`itapis.cvte.com/iac/app/access_token`），更重。
- **回调方式**：复用现有 loopback OAuth 模式（`packages/shared/src/auth/` 的 Claude/ChatGPT OAuth 已用 loopback `http://127.0.0.1:{port}/callback`）。测试环境 op-fat 允许 localhost/loopback；**生产 home.cvte.com 域名校验生效**——loopback 是否被接受需向门户确认，否则改用 `workagents://auth/callback` 自定义 scheme（app 已注册该 scheme）或托管中继回调（仿 Craft OAuth relay）。
- **token/userinfo 都是服务端调用**（无 CORS 约束），在 Electron 主进程做。

## ✅ 闭环已全程实测打通（2026-06-13，用户真实身份 luoxiaowei）

| 步 | 接口 | 实测 |
|----|------|------|
| OAuth 登录 | op-fat：`client_id=e1fe00c2088543f3b7ade4d7fb7f4e5c` + loopback `http://127.0.0.1:8799/callback` → authorize→token→user | ✅ 用户真实门户登录，拿到 `simUid:"00001528"`、account、name、email、org 路径等 |
| **userId 映射** | `parseInt(simUid)` = token.cvte.com userId | ✅ `00001528`→`1528`（`account`/hex-`id` 走该接口都 400；**只有 simUid 数字化可用**） |
| 列 key | `GET https://token.cvte.com/api/v1/users/{userId}/keys`（X-Api-Key） | ✅ 返回 key 元信息：`{id(keyId), userId, name, isEnabled, providerGroup, maskedKey, …}`，**只给掩码** |
| **取完整 key** | `GET https://token.cvte.com/api/v1/keys/{keyId}:reveal`（X-Api-Key） | ✅ `{"key":"sk-…"}` 完整可用 key |
| 自动配置 | `setupLlmConnection` + `ensureEnterpriseDefaultConnection`（已就绪） | 个人 key 写 credentials.enc + 配网关 → 闭环 |

CCH（claude-code-hub = token.cvte.com）OpenAPI：`GET https://token.cvte.com/api/v1/openapi.json`。关键 key 接口：`GET /users/{userId}/keys`（列，掩码）、`POST /users/{userId}/keys`（建，应返回完整 key 一次）、`GET /keys/{keyId}:reveal`（取完整）、`GET /keys/{keyId}`、`PATCH/DELETE`、`:enable`/`:renew`。`users:self` 不存在（404，故必须 simUid→userId）。

## 🔴 生产安全结论（架构必须照此）

`X-Api-Key`（`TG5…`）是 **CCH 管理员级服务凭证**——能 reveal **任意用户**的 key。**绝不能进桌面客户端**。因此 **步骤"列 key + reveal" 必须服务端代理**：

```
桌面 App ──OAuth──> 门户（access_token + simUid）
   │  把 access_token 交给内网中继
   ▼
内网中继（持 X-Api-Key，服务端）：
   校验 access_token（GET /portal/oauth2/user 拿 simUid）
   → userId=parseInt(simUid)
   → GET /users/{userId}/keys 取 keyId → GET /keys/{keyId}:reveal 取完整 key
   → 只把【该用户自己的】key 返回桌面
桌面 App ──> setupLlmConnection 配网关 → 闭环
```

中继可用刚建的 `packages/session-share-server` 同款 Bun 服务，或请 CCH 团队加一个"凭门户 token 取自己 key"的 self 端点（最干净）。

## 仍待 CVTE 侧确认（小项）

1. **生产 client_id**：op-fat 测试用通用 `e1fe00c2…` 已通；生产 `home.cvte.com` 需 Work Agents 正式注册（ITSM）+ 回调域名白名单（loopback 在生产域名校验下是否接受待确认，否则用 `workagents://` scheme 或中继托管回调）。
2. **X-Api-Key 的正式分发**：给中继用的服务凭证（当前 `TG5…` 是测试/共享值，须轮换 + 经安全渠道发，绝不入库/入客户端）。
3. **建 key 兜底**：用户首次无 key 时是否由中继 `POST /users/{userId}/keys` 自动建一个（返回完整 key 一次）。

## 实现路径（拿到测试 client_id 即可落地+验证）

1. 主进程 OAuth：开系统浏览器 → op-fat authorize → loopback 收 `code` → POST token → GET user。复用 `packages/shared/src/auth/` 现有 loopback 模式。可对 **op-fat.cvte.com + localhost 回调**端到端实测。
2. 身份 → 个人 key：用 userinfo 的身份换 token.cvte.com 个人 key（待映射契约）。
3. 自动配置：把个人 key 写 credentials.enc + `setupLlmConnection` 配网关连接（**自动配置逻辑 `ensureEnterpriseDefaultConnection` 已就绪**，SSO 只是把兜底 key 换成个人 key）。取不到则回退兜底 key（既有行为）。
4. 技能市场登录复用：门户会话建立后（同 `home.cvte.com`），marketplace 的 `/auth/login` 走 SSO 免二次登录（需共享浏览器会话/分区）。
