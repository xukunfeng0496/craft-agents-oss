# Skills Marketplace System Design

**Status**: 📋 Planning (待实施)
**Created**: 2026-03-01
**Priority**: P2 (Phase 1 完成后再考虑)

## 概述

设计一个独立的远端 Skills Marketplace 管理系统，用于企业内部 skills 的发布、管理、分发和统计。

## 背景

当前 Work Agent 支持 3-tier skills 系统（Global/Workspace/Project），但缺少统一的分发和管理机制。需要一个中心化的 marketplace 系统来：
- 统一管理企业内部 skills
- 提供审核和质量控制
- 收集使用统计和反馈
- 简化 skills 的发现和安装

## 系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│              Work Agent Desktop App (客户端)                │
│  - Marketplace Browser (浏览和安装)                         │
│  - Skill Variables Configuration (变量配置)                 │
└─────────────────────────────────────────────────────────────┘
                          ↕ REST API
┌─────────────────────────────────────────────────────────────┐
│         Marketplace Management System (服务端)              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  管理后台 (Admin Dashboard)                           │ │
│  │  - Skill 审核                                         │ │
│  │  - 用户管理                                           │ │
│  │  - 统计分析                                           │ │
│  │  - 版本管理                                           │ │
│  └───────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  公开 Web 界面 (Public Web)                          │ │
│  │  - 在线浏览 skills                                    │ │
│  │  - 搜索/筛选                                          │ │
│  │  - 文档/示例                                          │ │
│  │  - 评论/评分                                          │ │
│  └───────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  REST API                                             │ │
│  │  - Skills CRUD                                        │ │
│  │  - Search & Filter                                    │ │
│  │  - Statistics                                         │ │
│  │  - User Management                                    │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    Storage Backend                          │
│  - PostgreSQL (元数据、用户、统计)                          │
│  - S3/OSS (skill 包存储)                                    │
│  - Redis (缓存、会话)                                       │
│  - Elasticsearch (全文搜索)                                 │
└─────────────────────────────────────────────────────────────┘
```

## 核心功能

### 1. Skill 管理

#### 1.1 发布流程

```
开发者 → 打包 skill → 上传到 marketplace → 审核 → 发布
```

**Skill 包格式**：
- `.skill` 文件（实际是 zip）
- 包含：
  - `SKILL.md` (必需)
  - `icon.{png|svg|jpg}` (可选)
  - `README.md` (可选)
  - `examples/` (可选)

**元数据**：
```json
{
  "slug": "jiandaoyun",
  "name": "简道云",
  "description": "简道云私有化部署数据读写",
  "version": "1.2.0",
  "author": {
    "name": "CVTE IT Team",
    "email": "it@cvte.com"
  },
  "tags": ["database", "cvte", "internal"],
  "license": "MIT",
  "homepage": "https://wiki.cvte.com/skills/jiandaoyun",
  "repository": "https://gitlab.cvte.com/ai/skills/jiandaoyun",
  "variables": [
    {
      "name": "JDY_BASE_URL",
      "description": "简道云私有化部署地址",
      "required": true,
      "example": "https://jdy.cvte.com"
    }
  ],
  "requiredSources": ["jiandaoyun-api"],
  "dependencies": []
}
```

#### 1.2 版本管理

- 语义化版本（Semantic Versioning）
- 支持多版本共存
- 自动更新检测
- 版本回滚

#### 1.3 审核机制

**审核流程**：
```
提交 → 自动检查 → 人工审核 → 发布/拒绝
```

**自动检查项**：
- SKILL.md 格式验证
- 变量定义完整性
- 敏感信息扫描
- 恶意代码检测

**人工审核项**：
- 功能描述准确性
- 代码质量
- 安全性评估
- 企业合规性

### 2. 搜索和发现

#### 2.1 搜索功能

- 全文搜索（Elasticsearch）
- 标签筛选
- 分类浏览
- 热门推荐
- 最近更新

#### 2.2 排序方式

- 相关度
- 下载量
- 评分
- 更新时间
- 字母顺序

### 3. 统计分析

#### 3.1 Skill 统计

- 下载次数
- 安装次数
- 活跃用户数
- 评分分布
- 版本分布

#### 3.2 用户统计

- 用户活跃度
- 安装的 skills 数量
- 发布的 skills 数量
- 贡献排行

#### 3.3 趋势分析

- 热门 skills 趋势
- 新增 skills 趋势
- 用户增长趋势

### 4. 用户系统

#### 4.1 认证

**SSO 集成（推荐）**：
- 使用企业 SSO 统一身份认证
- 支持 OIDC (OpenID Connect) 协议
- 支持 SAML 2.0 协议
- 详见：[SSO Integration Design](./2026-03-01-sso-integration-design.md)

**认证流程**：
```
客户端 SSO 登录
    ↓
获取 Access Token
    ↓
调用 Marketplace API 时携带 Token
    ↓
服务端验证 Token（JWT 验证或 Token Introspection）
    ↓
提取用户信息（sub, email, name, roles）
    ↓
授权访问
```

**备选方案**：
- LDAP/AD 直接集成（如果不使用 SSO）
- API Token（CLI 工具）

#### 4.2 权限管理

**角色**：
- Admin：系统管理员
- Reviewer：审核员
- Publisher：发布者
- User：普通用户

**权限**：
- Admin：所有权限
- Reviewer：审核 skills
- Publisher：发布和管理自己的 skills
- User：浏览和安装 skills

**角色来源**：
- 从 SSO Token 的 `roles` claim 中提取
- 或在 Marketplace 系统中单独管理

#### 4.3 匿名访问

**支持匿名访问的功能**：
- ✅ 浏览 skills
- ✅ 搜索 skills
- ✅ 查看 skill 详情
- ✅ 下载 skills

**需要登录的功能**：
- ❌ 发布 skills
- ❌ 评论和评分
- ❌ 查看个人统计
- ❌ 管理自己的 skills

### 5. 评论和反馈

- 用户评论
- 评分系统（1-5 星）
- 问题反馈
- 使用案例分享

## 技术栈

### 后端

```
Runtime: Node.js 20+
Framework: NestJS (TypeScript)
Database: PostgreSQL 15+
Cache: Redis 7+
Search: Elasticsearch 8+
Storage: S3/MinIO/OSS
Queue: Bull (Redis-based)
```

### 前端

```
Framework: React 18 + Next.js 14
State: Zustand
UI: Tailwind CSS + shadcn/ui
Build: Turbopack
```

### DevOps

```
Container: Docker + Docker Compose
CI/CD: GitLab CI / GitHub Actions
Monitoring: Prometheus + Grafana
Logging: ELK Stack
```

## API 设计

### REST API Endpoints

```
# Skills
GET    /api/v1/skills              # 列出所有 skills
GET    /api/v1/skills/:slug        # 获取 skill 详情
POST   /api/v1/skills              # 发布新 skill
PUT    /api/v1/skills/:slug        # 更新 skill
DELETE /api/v1/skills/:slug        # 删除 skill
GET    /api/v1/skills/:slug/versions  # 获取版本列表
GET    /api/v1/skills/:slug/download  # 下载 skill ��

# Search
POST   /api/v1/search              # 搜索 skills
GET    /api/v1/search/suggestions  # 搜索建议

# Statistics
GET    /api/v1/stats/popular       # 热门 skills
GET    /api/v1/stats/trending      # 趋势 skills
GET    /api/v1/stats/recent        # 最近更新
GET    /api/v1/skills/:slug/stats  # Skill 统计

# Reviews
GET    /api/v1/skills/:slug/reviews     # 获取评论
POST   /api/v1/skills/:slug/reviews     # 发表评论
PUT    /api/v1/skills/:slug/reviews/:id # 更新评论
DELETE /api/v1/skills/:slug/reviews/:id # 删除评论

# Users
GET    /api/v1/users/me            # 当前用户信息
GET    /api/v1/users/:id/skills    # 用户发布的 skills
GET    /api/v1/users/:id/installed # 用户安装的 skills

# Admin
GET    /api/v1/admin/pending       # 待审核 skills
POST   /api/v1/admin/approve/:slug # 审核通过
POST   /api/v1/admin/reject/:slug  # 审核拒绝
GET    /api/v1/admin/stats         # 管理统计
```

## 数据模型

### Skills Table

```sql
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  author_id UUID REFERENCES users(id),
  current_version VARCHAR(50) NOT NULL,
  tags TEXT[] DEFAULT '{}',
  license VARCHAR(50),
  homepage TEXT,
  repository TEXT,
  icon_url TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  downloads INTEGER DEFAULT 0,
  installs INTEGER DEFAULT 0,
  rating DECIMAL(3,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  published_at TIMESTAMP,

  -- Skill 特定字段
  variables JSONB DEFAULT '[]',
  required_sources TEXT[] DEFAULT '{}',
  dependencies TEXT[] DEFAULT '{}'
);

CREATE INDEX idx_skills_slug ON skills(slug);
CREATE INDEX idx_skills_author ON skills(author_id);
CREATE INDEX idx_skills_status ON skills(status);
CREATE INDEX idx_skills_tags ON skills USING GIN(tags);
```

### Versions Table

```sql
CREATE TABLE skill_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
  version VARCHAR(50) NOT NULL,
  changelog TEXT,
  package_url TEXT NOT NULL,
  package_size BIGINT,
  package_hash VARCHAR(64),
  downloads INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(skill_id, version)
);

CREATE INDEX idx_versions_skill ON skill_versions(skill_id);
```

### Reviews Table

```sql
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(skill_id, user_id)
);

CREATE INDEX idx_reviews_skill ON reviews(skill_id);
CREATE INDEX idx_reviews_user ON reviews(user_id);
```

### Install Stats Table

```sql
CREATE TABLE install_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  version VARCHAR(50),
  installed_at TIMESTAMP DEFAULT NOW(),
  uninstalled_at TIMESTAMP,

  UNIQUE(skill_id, user_id)
);

CREATE INDEX idx_install_stats_skill ON install_stats(skill_id);
CREATE INDEX idx_install_stats_user ON install_stats(user_id);
```

## 变量配置统一方案

### 设计原则

**统一配置，避免重复**：
- 变量定义：在 SKILL.md frontmatter 中（随 skill 分发）
- 变量值：只在本地配置一次（客户端 skill 详情页）
- Marketplace：只展示变量需求，不存储变量值

### 工作流程

```
1. 开发者发布 skill
   ↓
   SKILL.md 包含变量定义：
   ---
   vars:
     - name: JDY_BASE_URL
       required: true
       example: "https://jdy.cvte.com"
   ---

2. Marketplace 存储元数据
   ↓
   {
     "variables": [
       {
         "name": "JDY_BASE_URL",
         "required": true,
         "example": "https://jdy.cvte.com"
       }
     ]
   }
   (仅用于展示，不存储实际值)

3. 用户在客户端浏览 skill
   ↓
   UI 显示：⚙️ 需要配置 1 个变量

4. 用户安装 skill
   ↓
   如果有必需变量：
   - 提示：此 skill 需要配置变量才能使用
   - 选项：[立即配置] [稍后配置]

5. 用户配置变量（仅一次）
   ↓
   在客户端 Skill 详情页配置
   ↓
   保存到本地加密存储：
   ~/.workagent/credentials.enc
   (使用 CredentialManager)

6. Agent 加载 skill
   ↓
   从本地读取变量值
   ↓
   substituteSkillVars() 替换占位符
   ↓
   Skill 可用
```

### 关键点

1. **变量定义**：在 SKILL.md 中，随 skill 一起分发
2. **变量值**：只在客户端本地配置和存储
3. **Marketplace**：
   - ✅ 展示变量需求（从 SKILL.md 提取）
   - ✅ 提示用户需要配置
   - ❌ 不存储变量值
   - ❌ 不提供配置界面
4. **客户端**：
   - ✅ 唯一的变量配置入口
   - ✅ 加密存储变量值
   - ✅ 变量替换

### 数据流

```
Marketplace (服务端)
  ↓ 只存储变量定义（元数据）
  {
    "variables": [
      { "name": "JDY_BASE_URL", "required": true }
    ]
  }
  ↓ 用户安装
Desktop App (客户端)
  ↓ 下载 skill 包（包含 SKILL.md）
  ↓ 解析变量定义
  ↓ 提示用户配置
  ↓ 用户填写变量值
  ↓ 加密存储到本地
credentials.enc
  {
    "skill_var::workspace-id::jiandaoyun::JDY_BASE_URL": {
      "value": "https://jdy.cvte.com"
    }
  }
```

## 实施计划

### Phase 1: MVP（最小可行产品）- 2-3 周

**目标**：基础功能，内部测试

- [ ] 基础 REST API
- [ ] PostgreSQL 数据模型
- [ ] Skill 上传和下载
- [ ] 简单的 Web 界面（列表、详情）
- [ ] 基础搜索（PostgreSQL FTS）
- [ ] 客户端集成（浏览、安装）

### Phase 2: 核心功能 - 3-4 周

**目标**：完整的发布和管理流程

- [ ] 审核工作流
- [ ] 版本管理
- [ ] 用户认证（LDAP）
- [ ] 管理后台
- [ ] 统计分析（基础）
- [ ] Elasticsearch 集成

### Phase 3: 增强功能 - 2-3 周

**目标**：提升用户体验

- [ ] 评论和评分
- [ ] 高级搜索和筛选
- [ ] 推荐算法
- [ ] 详细统计仪表板
- [ ] 邮件通知
- [ ] Webhook 集成

### Phase 4: 优化和扩展 - 持续

**目标**：性能优化和新功能

- [ ] 性能优化
- [ ] CDN 集成
- [ ] 多语言支持
- [ ] API 文档（Swagger）
- [ ] CLI 工具
- [ ] 监控和告警

## 部署架构

### 生产环境

```
┌─────────────────────────────────────────────┐
│              Load Balancer (Nginx)          │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│         Application Servers (3x)            │
│         (NestJS + Next.js)                  │
└─────────────────────────────────────────────┘
                    ↓
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ PostgreSQL   │  │    Redis     │  │ Elasticsearch│
│  (Primary +  │  │   (Cluster)  │  │   (Cluster)  │
│   Replica)   │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│         Object Storage (S3/MinIO)           │
└─────────────────────────────────────────────┘
```

### 资源需求（初期）

- **应用服务器**：2-4 核 CPU，8-16GB RAM，3 实例
- **PostgreSQL**：4 核 CPU，16GB RAM，500GB SSD
- **Redis**：2 核 CPU，8GB RAM
- **Elasticsearch**：4 核 CPU，16GB RAM，1TB SSD
- **对象存储**：1TB（可扩展）

## 安全考虑

### 1. 认证和授权

**SSO Token 验证**：
```typescript
// 验证 JWT Token
async function verifyToken(token: string): Promise<UserInfo> {
  // 1. 从 SSO 获取 JWKS (JSON Web Key Set)
  const jwks = await fetchJWKS(ssoConfig.issuer);

  // 2. 验证 JWT 签名
  const payload = await jose.jwtVerify(token, jwks);

  // 3. 验证 claims
  if (payload.iss !== ssoConfig.issuer) {
    throw new Error('Invalid issuer');
  }
  if (payload.exp < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  // 4. 提取用户信息
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    roles: payload.roles || []
  };
}
```

**权限控制**：
- RBAC (Role-Based Access Control)
- 基于 SSO Token 中的 roles claim
- API Rate Limiting（按用户限流）
- CORS 配置

### 2. 数据安全

- HTTPS 强制
- 数据库加密
- 敏感信息脱敏
- 定期备份

### 3. Skill 安全

- 代码扫描（恶意代码检测）
- 依赖检查（已知漏洞）
- 沙箱执行（客户端）
- 审核机制

### 4. 审计日志

- 操作日志
- 访问日志
- 审核日志
- 异常日志

## 成本估算

### 开发成本

- **Phase 1 (MVP)**：2-3 人周
- **Phase 2 (核心)**：3-4 人周
- **Phase 3 (增强)**：2-3 人周
- **总计**：7-10 人周

### 运维成本（月）

- **服务器**：¥3,000 - ¥5,000
- **存储**：¥500 - ¥1,000
- **带宽**：¥1,000 - ¥2,000
- **监控**：¥500
- **总计**：¥5,000 - ¥8,500/月

## 成功指标

### 用户指标

- 注册用户数 > 100
- 活跃用户数 > 50
- 用户留存率 > 60%

### Skill 指标

- 发布 skills 数 > 50
- 平均下载量 > 10/skill
- 平均评分 > 4.0

### 系统指标

- API 响应时间 < 200ms (P95)
- 系统可用性 > 99.5%
- 错误率 < 0.1%

## 风险和挑战

### 技术风险

- **性能瓶颈**：大量并发下载
  - 缓解：CDN + 对象存储
- **搜索性能**：大规模 skills 搜索
  - 缓解：Elasticsearch 优化
- **数据一致性**：分布式系统
  - 缓解：事务管理 + 幂等性设计

### 业务风险

- **用户采用率低**：推广不足
  - 缓解：内部培训 + 激励机制
- **内容质量差**：审核不严
  - 缓解：严格审核 + 质量标准
- **维护成本高**：资源不足
  - 缓解：自动化 + 监控

## 参考资料

- [npm Registry Architecture](https://github.com/npm/registry)
- [VS Code Marketplace](https://marketplace.visualstudio.com/)
- [Chrome Web Store](https://chrome.google.com/webstore)
- [Homebrew Formulae](https://formulae.brew.sh/)

## 附录

### A. 客户端集成示例

```typescript
// packages/shared/src/marketplace/client.ts

export class MarketplaceClient {
  constructor(private baseUrl: string, private apiToken: string) {}

  async searchSkills(query: string): Promise<Skill[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });
    return response.json();
  }

  async downloadSkill(slug: string, version: string): Promise<Buffer> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/skills/${slug}/download?version=${version}`,
      {
        headers: { 'Authorization': `Bearer ${this.apiToken}` }
      }
    );
    return Buffer.from(await response.arrayBuffer());
  }
}
```

### B. CLI 工具示例

```bash
# 发布 skill
workagent-cli publish ./my-skill --registry https://marketplace.cvte.com

# 搜索 skill
workagent-cli search "database"

# 安装 skill
workagent-cli install jiandaoyun

# 更新 skill
workagent-cli update jiandaoyun
```

---

**最后更新**: 2026-03-01
**维护者**: AI Team
**状态**: 📋 Planning
