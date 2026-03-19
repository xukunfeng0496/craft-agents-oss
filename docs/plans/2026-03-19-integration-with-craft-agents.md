# Skills-Manage 内置到 Craft-Agents-CVTE 集成方案

**创建日期**: 2026-03-19
**状态**: 方案设计

## 1. 两个项目概述

### 1.1 skills-manage

Skills 注册中心和分发平台，核心能力：

- **存储后端**：GitLab 仓库 `ai/skills`，每个 skill 一个子目录，根目录 `registry.json` 索引
- **Web 服务**：Next.js，提供 `/api/registry`（索引）、`/api/skills/:name/files`（文件下载）等 API
- **CLI 工具**：Go 二进制 `cskills`，支持 `find`、`add`、`publish`、`info` 命令
- **多 Agent 支持**：安装时可选 cursor / claude-code / codex / gemini / workagent 等目标
- **WorkAgent 安装逻辑**：读取 `~/.workagent/config.json` 中的 `workspaces` 列表，向每个工作区的 `skills/` 目录写入真实文件（不使用符号链接）

### 1.2 craft-agents-cvte (Work Agents)

Electron 桌面 AI Agent 应用，skills 体系：

- **三层优先级**：Global (`~/.workagent/skills/`) < Workspace (`{workspaceRoot}/skills/`) < Project (`{projectRoot}/.agents/skills/`)
- **内置 Skills 机制**：`apps/electron/resources/bundled-skills/` 目录中的 skills 在新建工作区或应用启动时自动复制到工作区
- **SDK 集成**：Claude Agent SDK 通过 `plugins` 数组发现 skills
- **UI 管理**：侧边栏 SkillsListPanel、SkillInfoPage 详情页、变量配置、添加/删除
- **Marketplace**：已有设计文档但尚未实施

## 2. 集成目标

将 skills-manage 中发布的 skills **内置到 craft-agents-cvte 的 bundled-skills 中**，实现：
1. 用户安装 Work Agents 后，工作区自动拥有来自 skills-manage 的高质量 skills
2. 构建时从 skills-manage 拉取最新 skills，打包进 Electron 应用
3. 无需用户手动运行 `cskills add`

## 3. 集成方案

### 方案 A：构建时同步（推荐）

在 craft-agents-cvte 的构建流程中增加一步，从 skills-manage API 拉取指定 skills 到 `bundled-skills/` 目录。

#### 3.1 新增配置文件

在 `apps/electron/resources/bundled-skills/` 下新增 `bundled-skills.json`：

```json
{
  "registryUrl": "https://skills.gz.cvte.cn",
  "skills": [
    "changelog",
    "git-commit",
    "prd-doc-writer",
    "weekly-report",
    "thinking-partner"
  ],
  "autoUpdate": true
}
```

#### 3.2 新增同步脚本

在 `scripts/sync-bundled-skills.ts` 中实现：

```typescript
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

interface SkillFile {
  path: string;
  content: string;
}

const BUNDLED_SKILLS_DIR = join(__dirname, '../apps/electron/resources/bundled-skills');
const CONFIG_PATH = join(BUNDLED_SKILLS_DIR, 'bundled-skills.json');

async function fetchSkillFiles(registryUrl: string, name: string): Promise<SkillFile[]> {
  const res = await fetch(`${registryUrl}/api/skills/${name}/files`);
  if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
  const data = await res.json();
  return data.files;
}

async function syncSkills() {
  const config = JSON.parse(require('fs').readFileSync(CONFIG_PATH, 'utf-8'));
  const { registryUrl, skills } = config;

  for (const name of skills) {
    console.log(`Syncing ${name}...`);
    const files = await fetchSkillFiles(registryUrl, name);
    const skillDir = join(BUNDLED_SKILLS_DIR, name);

    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }

    for (const file of files) {
      const filePath = join(skillDir, file.path);
      const dir = join(filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, file.content, 'utf-8');
    }
    console.log(`  -> ${files.length} files`);
  }
}

syncSkills().catch(console.error);
```

#### 3.3 集成到构建流程

在 `craft-agents-cvte/package.json` 中添加脚本：

```json
{
  "scripts": {
    "sync-skills": "bun run scripts/sync-bundled-skills.ts",
    "electron:build": "bun run sync-skills && bun run electron:build:original"
  }
}
```

#### 3.4 工作流程

```
开发者 publish skill → skills-manage GitLab
                              ↓
              craft-agents-cvte CI/CD 构建时
                              ↓
              bun run sync-skills 从 API 拉取
                              ↓
              写入 resources/bundled-skills/
                              ↓
              electron-builder 打包进应用
                              ↓
              用户启动应用 → initializeBundledSkills()
                              ↓
              自动复制到各工作区 skills/
```

### 方案 B：运行时在线安装

在 Work Agents 应用中集成 skills-manage API，用户在 UI 中一键安装。

#### 3.5 新增 Marketplace 客户端

在 `packages/shared/src/marketplace/` 下新增：

```typescript
// client.ts
export class SkillsMarketplaceClient {
  constructor(private registryUrl: string) {}

  async getRegistry() {
    const res = await fetch(`${this.registryUrl}/api/registry`);
    return res.json();
  }

  async getSkillFiles(name: string) {
    const res = await fetch(`${this.registryUrl}/api/skills/${name}/files`);
    return res.json();
  }

  async installSkill(name: string, workspaceSkillsDir: string) {
    const { files } = await this.getSkillFiles(name);
    const skillDir = join(workspaceSkillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    for (const file of files) {
      const filePath = join(skillDir, file.path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.content, 'utf-8');
    }
  }
}
```

#### 3.6 新增 IPC 通道

在 `apps/electron/src/shared/types.ts` 中添加：

```typescript
MARKETPLACE_GET_REGISTRY: 'marketplace:getRegistry',
MARKETPLACE_INSTALL_SKILL: 'marketplace:installSkill',
MARKETPLACE_SEARCH: 'marketplace:search',
```

#### 3.7 新增 UI 组件

在 SkillsListPanel 中添加"浏览 Marketplace"入口，新增 MarketplaceBrowser 页面展示可安装的 skills。

### 方案对比

| 维度 | 方案 A（构建时同步） | 方案 B（运行时安装） |
|------|---------------------|---------------------|
| 实现复杂度 | 低（一个脚本） | 高（API 客户端 + IPC + UI） |
| 用户体验 | 开箱即用 | 需要手动浏览安装 |
| 离线可用 | 是 | 否 |
| 更新频率 | 随应用版本 | 实时 |
| 网络依赖 | 仅构建时 | 运行时需要网络 |
| 推荐场景 | 核心 skills 内置分发 | 长尾 skills 按需安装 |

**建议**：先实施方案 A 保证核心 skills 开箱即用，后续实施方案 B 作为 Marketplace 功能补充。

## 4. 方案 A 详细实施步骤

### Step 1：确定内置 Skills 列表

从 skills-manage 的 `registry.json` 中筛选高质量、高通用性的 skills。建议初始列表：

| Skill | 用途 |
|-------|------|
| changelog | 生成变更日志 |
| git-commit | 智能 Git 提交 |
| prd-doc-writer | PRD 文档撰写 |
| weekly-report | 周报生成 |
| thinking-partner | 思考拍档 |
| writing-assistant | 写作助手 |
| project-map-builder | 项目地图生成 |

### Step 2：创建同步脚本

路径：`craft-agents-cvte/scripts/sync-bundled-skills.ts`

核心逻辑：
1. 读取 `bundled-skills.json` 配置
2. 调用 `GET /api/skills/:name/files` 获取每个 skill 的文件
3. 写入 `apps/electron/resources/bundled-skills/{name}/`
4. 跳过手动维护的 skills（如 `find-skills` 等已存在的）

### Step 3：配置 CI/CD

在构建 pipeline 中，打包前先执行 `sync-skills`：

```yaml
# .gitlab-ci.yml 或 GitHub Actions
build:
  steps:
    - run: bun install
    - run: bun run sync-skills  # 从 skills-manage 拉取
    - run: bun run electron:dist
```

### Step 4：处理版本和更新

`bundled-skills.json` 可选锁定版本：

```json
{
  "skills": [
    { "name": "changelog", "version": "1.0.0" },
    { "name": "git-commit" }
  ]
}
```

不指定 version 时取最新版。构建后将实际版本写入 `bundled-skills-lock.json`，便于追踪。

### Step 5：与现有 bundled-skills 机制融合

现有 `bundled-skills.ts` 的 `initializeBundledSkills()` 已能处理：
- 新建工作区时自动复制
- 应用启动时检查并安装到已有工作区
- 跳过已存在的 skill（保护用户修改）
- 使用 marker 文件追踪安装状态

**无需修改** `bundled-skills.ts`，同步脚本的产物直接放入 `resources/bundled-skills/` 即可被现有机制识别。

## 5. 关键兼容性问题

### 5.1 SKILL.md 格式差异

| 字段 | skills-manage | craft-agents-cvte |
|------|--------------|-------------------|
| frontmatter.name | 必填 | 必填 |
| frontmatter.description | 必填 | 必填 |
| frontmatter.version | 必填 | 无 |
| frontmatter.author | 必填 | 无 |
| frontmatter.tags | 可选 | 无 |
| frontmatter.globs | 无 | 可选 |
| frontmatter.alwaysAllow | 无 | 可选 |
| frontmatter.vars | 无 | 可选 |

**兼容性结论**：skills-manage 的 SKILL.md 是 craft-agents-cvte 的超集，多余字段会被忽略，完全兼容。

### 5.2 目录结构

两个项目的 skill 目录结构一致：

```
{skill-name}/
├── SKILL.md        # 必需
├── icon.{png|svg}  # 可选
└── ...其他文件      # 可选
```

### 5.3 安装路径

skills-manage 的 `cskills add --agent workagent` 和 craft-agents-cvte 的 bundled-skills 最终都写入同一位置：

```
~/.workagent/workspaces/{id}/skills/{skill-name}/
```

## 6. 方案 B 后续 Marketplace 集成路线

craft-agents-cvte 已有 Marketplace 设计文档（`docs/plans/2026-03-01-marketplace-system-design.md`），可复用 skills-manage 作为后端：

### 6.1 短期（直接对接 skills-manage API）-- 已实现

已在 craft-agents-cvte 中实现完整的 Marketplace 集成，直接复用 skills-manage 现有 API：

```
Work Agents App (Electron 渲染进程)
      ↓ IPC: marketplace:getRegistry / marketplace:installSkill
Work Agents App (Electron 主进程)
      ↓ GET /api/registry, GET /api/skills/:name/files
skills-manage Web (skills.gz.cvte.cn)
      ↓ 读取
GitLab ai/skills 仓库
```

**变更文件清单**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/shared/src/marketplace/types.ts` | 新增 | Marketplace 类型定义 |
| `packages/shared/src/marketplace/client.ts` | 新增 | API 客户端，封装 registry 和 files 请求 |
| `packages/shared/src/marketplace/index.ts` | 新增 | 模块导出 |
| `packages/shared/package.json` | 修改 | 添加 `./marketplace` 和 `./skills` 导出 |
| `apps/electron/src/shared/types.ts` | 修改 | 添加 IPC 通道和 ElectronAPI 类型 |
| `apps/electron/src/preload/index.ts` | 修改 | 暴露 marketplace API 到渲染进程 |
| `apps/electron/src/main/ipc.ts` | 修改 | 添加 marketplace IPC handlers |
| `apps/electron/src/renderer/components/skills/MarketplaceDialog.tsx` | 新增 | Marketplace 弹窗 UI |
| `apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx` | 修改 | 添加 Marketplace 入口按钮 |

**功能说明**：

1. 侧边栏 Skills 面板新增「Marketplace」按钮（空态和列表态均有）
2. 点击打开 Dialog，从 skills-manage 拉取 registry 展示可安装的 skills
3. 支持关键词搜索（名称、描述、标签模糊匹配）
4. 已安装的 skill 显示 Installed 状态，未安装的可一键 Install
5. 安装后 ConfigWatcher 自动检测文件变化并广播更新

### 6.2 中期（skills-manage 增加 Marketplace API）

在 skills-manage 中新增面向 Work Agents 的专用接口：

```
GET /api/marketplace/workagent         # WorkAgent 专用索引
GET /api/marketplace/workagent/featured # 推荐 skills
GET /api/marketplace/workagent/search?q=xxx
```

### 6.3 长期（独立 Marketplace 服务）

按 craft-agents-cvte 的设计文档，建设独立 Marketplace 系统，skills-manage 作为其中一个数据源。

## 7. 文件变更清单

### craft-agents-cvte 项目需要变更的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `scripts/sync-bundled-skills.ts` | 新增 | 同步脚本 |
| `apps/electron/resources/bundled-skills/bundled-skills.json` | 新增 | 内置 skills 配置 |
| `package.json` | 修改 | 添加 `sync-skills` 脚本 |
| CI/CD 配置 | 修改 | 构建前执行同步 |

### skills-manage 项目无需变更

现有 `/api/skills/:name/files` 接口已满足需求，无需额外开发。
