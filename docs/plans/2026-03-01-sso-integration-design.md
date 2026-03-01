# SSO Integration Design

**Status**: 📋 Planning (待实施)
**Created**: 2026-03-01
**Priority**: P1 (高优先级)

## 概述

为 Work Agent 引入 SSO (Single Sign-On) 统一身份认证，实现企业内部用户的无缝登录体验。

## 背景

### 当前状态

Work Agent 目前**不需要用户登录**，认证机制仅用于：
- Claude API 访问（API Key 或 OAuth）
- MCP Server 连接（OAuth/API Key）
- Source 认证（OAuth/Bearer Token）

所有认证信息存储在本地加密文件 `~/.workagent/credentials.enc` 中。

### 为什么需要 SSO

1. **企业身份管理**：统一管理用户身份和权限
2. **Marketplace 集成**：需要用户身份来管理 skills 发布、评论、统计
3. **协作功能**：未来的团队协作功能需要用户身份
4. **审计和合规**：追踪用户操作，满足企业合规要求
5. **个性化体验**：基于用户身份的个性化设置和推荐

## 设计目标

1. **无缝集成**：与现有认证系统共存，不影响现有功能
2. **企业标准**：支持主流 SSO 协议（SAML 2.0, OIDC）
3. **可选登录**：SSO 登录可选，不强制要求
4. **离线可用**：即使未登录或离线，核心功能仍可用
5. **安全可靠**：Token 安全存储，自动刷新

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│              Work Agent Desktop App                         │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  User Identity Layer (新增)                           │ │
│  │  - SSO Login                                          │ │
│  │  - User Profile                                       │ │
│  │  - Token Management                                   │ │
│  └───────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  Existing Auth Layer                                  │ │
│  │  - Claude API Auth                                    │ │
│  │  - MCP Server Auth                                    │ │
│  │  - Source Auth                                        │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              SSO Identity Provider (IdP)                    │
│  - CVTE SSO (SAML 2.0 / OIDC)                              │
│  - Azure AD / Okta / Auth0                                 │
└─────────────────────────────────────────────────────────────┘
```

### 认证流程

#### 1. OIDC (OpenID Connect) 流程（推荐）

```
1. 用户点击"登录"
   ↓
2. 桌面应用打开浏览器
   ↓
   https://sso.cvte.com/authorize?
     client_id=work-agent
     &redirect_uri=http://localhost:8888/callback
     &response_type=code
     &scope=openid profile email
     &state=random_state
     &code_challenge=...  (PKCE)
   ↓
3. 用户在浏览器中登录 SSO
   ↓
4. SSO 重定向回本地回调服务器
   ↓
   http://localhost:8888/callback?code=xxx&state=xxx
   ↓
5. 桌面应用交换 code 获取 token
   ↓
   POST https://sso.cvte.com/token
   {
     "code": "xxx",
     "client_id": "work-agent",
     "redirect_uri": "http://localhost:8888/callback",
     "code_verifier": "..."  (PKCE)
   }
   ↓
6. 获取 ID Token + Access Token
   ↓
   {
     "id_token": "eyJhbGc...",  // JWT with user info
     "access_token": "xxx",
     "refresh_token": "xxx",
     "expires_in": 3600
   }
   ↓
7. 解析 ID Token 获取用户信息
   ↓
   {
     "sub": "user123",
     "name": "张三",
     "email": "zhangsan@cvte.com",
     "department": "AI Team",
     "employee_id": "E12345"
   }
   ↓
8. 存储到本地加密存储
   ↓
   credentials.enc (使用现有 CredentialManager)
   {
     "sso_token::global": {
       "value": "access_token",
       "refreshToken": "refresh_token",
       "expiresAt": 1234567890,
       "idToken": "id_token"
     }
   }
   ↓
9. 更新 UI 显示用户信息
```

#### 2. SAML 2.0 流程（备选）

```
1. 用户点击"登录"
   ↓
2. 桌面应用生成 SAML Request
   ↓
3. 打开浏览器，POST SAML Request 到 IdP
   ↓
4. 用户在浏览器中登录
   ↓
5. IdP 返回 SAML Response
   ↓
6. 桌面应用验证 SAML Response
   ↓
7. 提取用户信息
   ↓
8. 存储到本地
```

### 数据模型

#### User Identity

```typescript
// packages/shared/src/auth/sso-types.ts

export interface SSOUserIdentity {
  /** 用户唯一标识（来自 IdP） */
  sub: string;
  /** 用户名 */
  username: string;
  /** 显示名称 */
  displayName: string;
  /** 邮箱 */
  email: string;
  /** 头像 URL */
  avatar?: string;
  /** 部门 */
  department?: string;
  /** 工号 */
  employeeId?: string;
  /** 角色 */
  roles?: string[];
  /** 自定义属性 */
  attributes?: Record<string, any>;
}

export interface SSOTokens {
  /** Access Token (用于 API 调用) */
  accessToken: string;
  /** Refresh Token (用于刷新) */
  refreshToken?: string;
  /** ID Token (包含用户信息的 JWT) */
  idToken?: string;
  /** Token 类型 */
  tokenType: string;
  /** 过期时间（Unix timestamp ms） */
  expiresAt: number;
}

export interface SSOSession {
  /** 用户身份 */
  user: SSOUserIdentity;
  /** Token 信息 */
  tokens: SSOTokens;
  /** 登录时间 */
  loginAt: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
}
```

#### Storage

```typescript
// 存储在 credentials.enc 中
{
  // SSO Token
  "sso_token::global": {
    "value": "access_token",
    "refreshToken": "refresh_token",
    "idToken": "id_token",
    "expiresAt": 1234567890,
    "tokenType": "Bearer"
  }
}

// 存储在 config.json 中（非敏感信息）
{
  "sso": {
    "enabled": true,
    "provider": "cvte",
    "user": {
      "sub": "user123",
      "username": "zhangsan",
      "displayName": "张三",
      "email": "zhangsan@cvte.com",
      "department": "AI Team",
      "avatar": "https://avatar.cvte.com/user123.jpg"
    },
    "loginAt": 1234567890,
    "lastActiveAt": 1234567890
  }
}
```

## 实现方案

### Phase 1: 基础 SSO 集成

#### 1.1 SSO 配置

```typescript
// packages/shared/src/auth/sso-config.ts

export interface SSOConfig {
  /** SSO 提供商 */
  provider: 'cvte' | 'azure-ad' | 'okta' | 'auth0' | 'custom';
  /** 协议类型 */
  protocol: 'oidc' | 'saml';
  /** OIDC 配置 */
  oidc?: {
    issuer: string;
    clientId: string;
    clientSecret?: string;  // 可选，桌面应用通常使用 PKCE
    redirectUri: string;
    scopes: string[];
  };
  /** SAML 配置 */
  saml?: {
    entryPoint: string;
    issuer: string;
    cert: string;
    callbackUrl: string;
  };
}

// 预定义配置
export const SSO_PROVIDERS: Record<string, SSOConfig> = {
  cvte: {
    provider: 'cvte',
    protocol: 'oidc',
    oidc: {
      issuer: 'https://sso.cvte.com',
      clientId: 'work-agent',
      redirectUri: 'http://localhost:8888/callback',
      scopes: ['openid', 'profile', 'email']
    }
  }
};
```

#### 1.2 SSO Manager

```typescript
// packages/shared/src/auth/sso-manager.ts

export class SSOManager {
  private config: SSOConfig;
  private credentialManager: CredentialManager;

  constructor(config: SSOConfig) {
    this.config = config;
    this.credentialManager = getCredentialManager();
  }

  /**
   * 启动 SSO 登录流程
   */
  async login(): Promise<SSOSession> {
    if (this.config.protocol === 'oidc') {
      return this.loginOIDC();
    } else {
      return this.loginSAML();
    }
  }

  /**
   * OIDC 登录
   */
  private async loginOIDC(): Promise<SSOSession> {
    // 1. 生成 PKCE challenge
    const { codeVerifier, codeChallenge } = generatePKCE();

    // 2. 生成 state
    const state = generateRandomState();

    // 3. 构建授权 URL
    const authUrl = buildAuthorizationUrl(
      this.config.oidc!,
      codeChallenge,
      state
    );

    // 4. 启动本地回调服务器
    const callbackServer = new CallbackServer(8888);
    await callbackServer.start();

    // 5. 打开浏览器
    await openBrowser(authUrl);

    // 6. 等待回调
    const { code, state: returnedState } = await callbackServer.waitForCallback();

    // 7. 验证 state
    if (state !== returnedState) {
      throw new Error('State mismatch');
    }

    // 8. 交换 code 获取 token
    const tokens = await this.exchangeCodeForTokens(code, codeVerifier);

    // 9. 解析 ID Token 获取用户信息
    const user = parseIDToken(tokens.idToken!);

    // 10. 存储 token
    await this.saveTokens(tokens);

    // 11. 存储用户信息
    await this.saveUserInfo(user);

    // 12. 关闭回调服务器
    await callbackServer.stop();

    return {
      user,
      tokens,
      loginAt: Date.now(),
      lastActiveAt: Date.now()
    };
  }

  /**
   * 刷新 Token
   */
  async refreshToken(): Promise<SSOTokens> {
    const currentTokens = await this.getTokens();
    if (!currentTokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const newTokens = await this.requestTokenRefresh(currentTokens.refreshToken);
    await this.saveTokens(newTokens);

    return newTokens;
  }

  /**
   * 登出
   */
  async logout(): Promise<void> {
    // 1. 清除本地 token
    await this.credentialManager.delete({ type: 'sso_token' });

    // 2. 清除用户信息
    await this.clearUserInfo();

    // 3. 可选：调用 IdP 的登出端点
    if (this.config.oidc?.issuer) {
      const logoutUrl = `${this.config.oidc.issuer}/logout`;
      await openBrowser(logoutUrl);
    }
  }

  /**
   * 获取当前会话
   */
  async getSession(): Promise<SSOSession | null> {
    const tokens = await this.getTokens();
    if (!tokens) return null;

    const user = await this.getUserInfo();
    if (!user) return null;

    // 检查 token 是否过期
    if (this.isTokenExpired(tokens)) {
      // 尝试刷新
      try {
        const newTokens = await this.refreshToken();
        return {
          user,
          tokens: newTokens,
          loginAt: user.loginAt,
          lastActiveAt: Date.now()
        };
      } catch {
        return null;
      }
    }

    return {
      user,
      tokens,
      loginAt: user.loginAt,
      lastActiveAt: Date.now()
    };
  }

  /**
   * 检查是否已登录
   */
  async isLoggedIn(): Promise<boolean> {
    const session = await this.getSession();
    return session !== null;
  }
}
```

#### 1.3 Credential Type 扩展

```typescript
// packages/shared/src/credentials/types.ts

export type CredentialType =
  | ... // 现有类型
  | 'sso_token';  // 新增：SSO token
```

### Phase 2: UI 集成

#### 2.1 登录界面

```typescript
// apps/electron/src/renderer/components/auth/SSOLoginButton.tsx

export function SSOLoginButton() {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await window.electron.ssoLogin();
      // 登录成功，刷新 UI
    } catch (error) {
      console.error('SSO login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleLogin} disabled={loading}>
      {loading ? '登录中...' : '使用 SSO 登录'}
    </Button>
  );
}
```

#### 2.2 用户信息显示

```typescript
// apps/electron/src/renderer/components/auth/UserProfile.tsx

export function UserProfile() {
  const [session, setSession] = useState<SSOSession | null>(null);

  useEffect(() => {
    window.electron.getSSOSession().then(setSession);
  }, []);

  if (!session) {
    return <SSOLoginButton />;
  }

  return (
    <div className="flex items-center gap-2">
      <Avatar src={session.user.avatar} />
      <div>
        <div className="font-medium">{session.user.displayName}</div>
        <div className="text-sm text-muted">{session.user.email}</div>
      </div>
      <Button variant="ghost" onClick={() => window.electron.ssoLogout()}>
        登出
      </Button>
    </div>
  );
}
```

#### 2.3 Settings 页面

```
Settings → Account
─────────────────────────────────────────────────
SSO Login

┌─────────────────────────────────────────────┐
│ ✓ 已登录                                     │
│                                             │
│ 👤 张三 (zhangsan@cvte.com)                 │
│ 🏢 AI Team                                  │
│ 🆔 E12345                                   │
│                                             │
│ 登录时间: 2026-03-01 10:00:00               │
│ Token 过期: 2026-03-01 11:00:00             │
│                                             │
│ [刷新 Token] [登出]                         │
└─────────────────────────────────────────────┘

SSO Configuration

Provider: [CVTE SSO ▼]
Protocol: OIDC
Status: ✓ Connected

[Test Connection] [Advanced Settings]
```

### Phase 3: Marketplace 集成

#### 3.1 API 认证

```typescript
// packages/shared/src/marketplace/client.ts

export class MarketplaceClient {
  private ssoManager: SSOManager;

  async request(endpoint: string, options?: RequestInit): Promise<Response> {
    // 1. 获取 SSO session
    const session = await this.ssoManager.getSession();

    // 2. 如果已登录，添加 Authorization header
    const headers = new Headers(options?.headers);
    if (session) {
      headers.set('Authorization', `Bearer ${session.tokens.accessToken}`);
    }

    // 3. 发送请求
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers
    });

    // 4. 如果 401，尝试刷新 token
    if (response.status === 401 && session) {
      try {
        await this.ssoManager.refreshToken();
        // 重试请求
        return this.request(endpoint, options);
      } catch {
        // 刷新失败，需要重新登录
        throw new Error('Authentication required');
      }
    }

    return response;
  }
}
```

#### 3.2 用户相关功能

```typescript
// 发布 skill（需要登录）
async publishSkill(skill: Skill): Promise<void> {
  const session = await this.ssoManager.getSession();
  if (!session) {
    throw new Error('Please login to publish skills');
  }

  await this.client.request('/api/v1/skills', {
    method: 'POST',
    body: JSON.stringify({
      ...skill,
      author: {
        id: session.user.sub,
        name: session.user.displayName,
        email: session.user.email
      }
    })
  });
}

// 评论 skill（需要登录）
async addReview(slug: string, rating: number, comment: string): Promise<void> {
  const session = await this.ssoManager.getSession();
  if (!session) {
    throw new Error('Please login to add reviews');
  }

  await this.client.request(`/api/v1/skills/${slug}/reviews`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment })
  });
}

// 浏览 skills（不需要登录）
async searchSkills(query: string): Promise<Skill[]> {
  const response = await this.client.request('/api/v1/search', {
    method: 'POST',
    body: JSON.stringify({ query })
  });
  return response.json();
}
```

### Phase 4: 高级功能

#### 4.1 自动刷新 Token

```typescript
// packages/shared/src/auth/token-refresher.ts

export class TokenRefresher {
  private refreshTimer: NodeJS.Timeout | null = null;

  start(ssoManager: SSOManager) {
    // 每 5 分钟检查一次
    this.refreshTimer = setInterval(async () => {
      const session = await ssoManager.getSession();
      if (!session) return;

      // 如果 token 将在 10 分钟内过期，刷新它
      const expiresIn = session.tokens.expiresAt - Date.now();
      if (expiresIn < 10 * 60 * 1000) {
        try {
          await ssoManager.refreshToken();
        } catch (error) {
          console.error('Failed to refresh token:', error);
        }
      }
    }, 5 * 60 * 1000);
  }

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
```

#### 4.2 离线模式

```typescript
// 即使未登录或离线，核心功能仍可用
export class OfflineCapableFeature {
  async performAction() {
    const session = await ssoManager.getSession();

    if (session) {
      // 在线模式：同步到服务器
      await this.syncToServer(session.tokens.accessToken);
    } else {
      // 离线模式：仅本地操作
      await this.performLocalAction();
    }
  }
}
```

#### 4.3 多账号支持（可选）

```typescript
// 支持多个 SSO 账号切换
export interface SSOAccount {
  id: string;
  provider: string;
  user: SSOUserIdentity;
  active: boolean;
}

export class MultiAccountManager {
  async addAccount(config: SSOConfig): Promise<SSOAccount> {
    // 添加新账号
  }

  async switchAccount(accountId: string): Promise<void> {
    // 切换活跃账号
  }

  async removeAccount(accountId: string): Promise<void> {
    // 移除账号
  }

  async listAccounts(): Promise<SSOAccount[]> {
    // 列出所有账号
  }
}
```

## 与现有系统的关系

### 认证层次

```
┌─────────────────────────────────────────────┐
│  Layer 1: User Identity (SSO)              │  ← 新增
│  - 用户身份认证                             │
│  - Marketplace 用户功能                     │
│  - 协作功能                                 │
└─────────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  Layer 2: Service Auth (现有)              │
│  - Claude API (API Key / OAuth)            │
│  - MCP Servers (OAuth / API Key)           │
│  - Sources (OAuth / Bearer Token)          │
└─────────────────────────────────────────────┘
```

### 独立性

- **SSO 登录是可选的**：未登录时，核心功能仍可用
- **不影响现有认证**：Claude API、MCP、Sources 的认证独立
- **渐进增强**：登录后解锁更多功能（Marketplace、协作）

### 功能矩阵

| 功能 | 未登录 | 已登录 |
|------|--------|--------|
| 使用 Agent | ✅ | ✅ |
| 本地 Skills | ✅ | ✅ |
| 浏览 Marketplace | ✅ | ✅ |
| 安装 Skills | ✅ | ✅ |
| 发布 Skills | ❌ | ✅ |
| 评论/评分 | ❌ | ✅ |
| 查看统计 | ❌ | ✅ |
| 团队协作 | ❌ | ✅ |

## 安全考虑

### 1. Token 存储

- ✅ 使用现有 CredentialManager（AES-256-GCM 加密）
- ✅ Token 存储在 credentials.enc
- ✅ 机器绑定（基于硬件 UUID）

### 2. PKCE (Proof Key for Code Exchange)

- ✅ 桌面应用使用 PKCE 而非 client_secret
- ✅ 防止授权码拦截攻击

### 3. Token 刷新

- ✅ 自动刷新过期 token
- ✅ Refresh token rotation（可选）

### 4. 登出

- ✅ 清除本地 token
- ✅ 可选：调用 IdP 登出端点

### 5. 会话管理

- ✅ Token 过期检查
- ✅ 自动重新认证提示

## 实施计划

### Phase 1: 基础 SSO（2-3 周）

- [ ] SSO Manager 实现
- [ ] OIDC 协议支持
- [ ] Token 存储和刷新
- [ ] 基础 UI（登录/登出）

### Phase 2: UI 集成（1-2 周）

- [ ] 用户信息显示
- [ ] Settings 页面
- [ ] 登录状态管理

### Phase 3: Marketplace 集成（1 周）

- [ ] API 认证
- [ ] 用户相关功能
- [ ] 权限控制

### Phase 4: 高级功能（1-2 周）

- [ ] 自动刷新
- [ ] 离线模式
- [ ] 多账号支持（可选）

## 配置示例

### CVTE SSO 配置

```json
// config.json
{
  "sso": {
    "enabled": true,
    "provider": "cvte",
    "config": {
      "protocol": "oidc",
      "issuer": "https://sso.cvte.com",
      "clientId": "work-agent",
      "redirectUri": "http://localhost:8888/callback",
      "scopes": ["openid", "profile", "email", "groups"]
    }
  }
}
```

### Azure AD 配置

```json
{
  "sso": {
    "enabled": true,
    "provider": "azure-ad",
    "config": {
      "protocol": "oidc",
      "issuer": "https://login.microsoftonline.com/{tenant-id}/v2.0",
      "clientId": "xxx",
      "redirectUri": "http://localhost:8888/callback",
      "scopes": ["openid", "profile", "email"]
    }
  }
}
```

## 测试计划

### 单元测试

- [ ] Token 解析和验证
- [ ] PKCE 生成
- [ ] Token 刷新逻辑

### 集成测试

- [ ] 完整登录流程
- [ ] Token 刷新流程
- [ ] 登出流程

### E2E 测试

- [ ] 用户登录并使用 Marketplace
- [ ] Token 过期自动刷新
- [ ] 离线模式切换

## 依赖

### NPM 包

```json
{
  "dependencies": {
    "jose": "^5.0.0",           // JWT 解析和验证
    "openid-client": "^5.0.0",  // OIDC 客户端
    "pkce-challenge": "^4.0.0"  // PKCE 生成
  }
}
```

## 参考资料

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 for Native Apps (RFC 8252)](https://tools.ietf.org/html/rfc8252)
- [PKCE (RFC 7636)](https://tools.ietf.org/html/rfc7636)
- [Azure AD OIDC](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-protocols-oidc)

---

**最后更新**: 2026-03-01
**维护者**: AI Team
**状态**: 📋 Planning
