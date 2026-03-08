# 浏览器自动化工具功能分析

**分析日期：** 2026-03-08
**上游版本：** v0.6.0 + v0.7.0
**分析 Agent ID：** a019ab0ca6bacfbfe

## 执行摘要

浏览器自动化工具功能在 **v0.6.0（2026-03-02）** 引入，代表了 craft-agents-oss 的重大架构增强。它提供了完全集成的基于 Chromium 的浏览器，具有 CDP（Chrome DevTools Protocol）自动化功能，使 agent 能够浏览网页、填写表单、提取数据和截图，无需外部依赖。

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户界面                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ BrowserTabStrip  │  │ BrowserToolbar   │  │ EmptyStateCard│ │
│  │  (标签管理器)     │  │  (导航栏)         │  │  (引导界面)    │ │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬───────┘ │
│           │                     │                     │          │
└───────────┼─────────────────────┼─────────────────────┼──────────┘
            │                     │                     │
            │         IPC 通道 (RPC_CHANNELS.browserPane)
            │                     │                     │
┌───────────▼─────────────────────▼─────────────────────▼──────────┐
│                      主进程 (Electron)                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              BrowserPaneManager                           │   │
│  │  - 实例生命周期（创建/销毁/聚焦）                           │   │
│  │  - 会话绑定（1:1 会话 → 浏览器映射）                       │   │
│  │  - 窗口管理（BrowserWindow + BrowserViews）               │   │
│  │  - Agent 控制覆盖层（视觉反馈）                            │   │
│  │  - 状态同步（IPC 推送事件）                                │   │
│  └────────────────────┬─────────────────────────────────────┘   │
│                       │                                           │
│  ┌────────────────────▼─────────────────────────────────────┐   │
│  │              BrowserCDP                                   │   │
│  │  - Chrome DevTools Protocol 包装器                        │   │
│  │  - 可访问性树快照（@eN 引用）                              │   │
│  │  - 元素交互（点击、填充、选择）                            │   │
│  │  - 截图捕获（带注释 + 区域截图）                           │   │
│  │  - JavaScript 执行                                        │   │
│  │  - 空闲分离（5 秒超时）                                    │   │
│  └───────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
            │
            │ BrowserPaneFns 接口
            │
┌───────────▼───────────────────────────────────────────────────────┐
│                    Agent 层 (SDK 工具)                             │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │              browser_tool                                  │   │
│  │  - 单一类 CLI 命令接口                                      │   │
│  │  - 命令解析器（字符串 + 数组模式）                          │   │
│  │  - 批量执行（分号分隔）                                     │   │
│  │  - 权限检查（安全模式允许）                                 │   │
│  └────────────────────┬──────────────────────────────────────┘   │
│                       │                                            │
│  ┌────────────────────▼──────────────────────────────────────┐   │
│  │         BrowserToolRuntime                                 │   │
│  │  - 命令标记化和解析                                         │   │
│  │  - 参数验证                                                 │   │
│  │  - 结果格式化（文本 + 图片）                                │   │
│  │  - 错误处理和用户反馈                                       │   │
│  └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心组件

### 2.1 BrowserPaneManager (3153 行)

**职责：**
- 浏览器实例生命周期管理
- 会话绑定（每个会话最多一个浏览器）
- 窗口和视图管理（工具栏 + 页面 + 覆盖层）
- 状态同步到渲染进程

**关键方法：**
```typescript
createForSession(sessionId: string, opts?: BrowserPaneCreateOptions): Promise<BrowserPaneInstance>
destroy(instanceId: string): Promise<void>
navigate(sessionId: string, url: string): Promise<void>
getAccessibilitySnapshot(sessionId: string): Promise<AccessibilitySnapshot>
screenshot(sessionId: string, opts?: ScreenshotOptions): Promise<Buffer>
```

### 2.2 BrowserCDP (1061 行)

**职责：**
- CDP 协议包装器
- 可访问性树快照和元素引用分配
- 元素交互命令执行
- 空闲分离优化（5 秒后分离调试器）

**关键方法：**
```typescript
attach(): Promise<void>
detach(): Promise<void>
getAccessibilitySnapshot(): Promise<AccessibilitySnapshot>
clickElement(ref: string): Promise<void>
fillElement(ref: string, value: string): Promise<void>
screenshot(opts?: ScreenshotOptions): Promise<Buffer>
evaluate(script: string): Promise<any>
```

### 2.3 browser_tool (Agent 工具)

**职责：**
- 单一命令接口（类似 CLI）
- 命令解析和批量执行
- 权限检查（安全模式允许）

**支持的命令：**
```
open [url]                    - 打开浏览器并导航到 URL
navigate <url>                - 导航到新 URL
snapshot                      - 获取可访问性树快照（@eN 引用）
click <ref>                   - 点击元素
fill <ref> <value>            - 填充输入字段
select <ref> <value>          - 选择下拉选项
upload <ref> <path>           - 上传文件
screenshot [--png] [--region] - 截图
evaluate <script>             - 执行 JavaScript
console                       - 获取控制台日志
network                       - 获取网络请求
release                       - 释放浏览器控制
close                         - 关闭浏览器
```

---

## 3. 新增 IPC 通道

所有浏览器 IPC 通道定义在 `RPC_CHANNELS.browserPane` 下：

```typescript
// 生命周期
CREATE: 'browserPane:create'
DESTROY: 'browserPane:destroy'
LIST: 'browserPane:list'
FOCUS: 'browserPane:focus'
LAUNCH: 'browserPane:launch'

// 导航
NAVIGATE: 'browserPane:navigate'
GO_BACK: 'browserPane:goBack'
GO_FORWARD: 'browserPane:goForward'
RELOAD: 'browserPane:reload'
STOP: 'browserPane:stop'

// 交互
SNAPSHOT: 'browserPane:snapshot'
CLICK: 'browserPane:click'
FILL: 'browserPane:fill'
SELECT: 'browserPane:select'
UPLOAD: 'browserPane:upload'
SCROLL: 'browserPane:scroll'

// 检查
SCREENSHOT: 'browserPane:screenshot'
EVALUATE: 'browserPane:evaluate'
CONSOLE: 'browserPane:console'
NETWORK: 'browserPane:network'

// 事件（主进程 → 渲染进程推送）
STATE_CHANGED: 'browserPane:stateChanged'
REMOVED: 'browserPane:removed'
INTERACTED: 'browserPane:interacted'
```

---

## 4. 文件树（30+ 文件）

### 主进程
```
apps/electron/src/main/
├── browser-cdp.ts                          (1061 行)
├── browser-pane-manager.ts                 (3153 行)
├── handlers/browser.ts                     (184 行)
└── __tests__/
    ├── browser-cdp.test.ts                 (487 行)
    ├── browser-pane-manager.test.ts        (1118 行)
    ├── browser-tool-detection.test.ts      (69 行)
    └── sessions-browser-release.test.ts    (26 行)
```

### Preload 脚本
```
apps/electron/src/preload/
└── browser-toolbar.ts                      (53 行)
```

### 渲染进程
```
apps/electron/src/renderer/
├── browser-toolbar.html                    (28 行)
├── browser-toolbar.tsx                     (232 行)
├── browser-empty-state.html                (28 行)
├── browser-empty-state.tsx                 (46 行)
├── atoms/
│   ├── browser-pane.ts                     (82 行)
│   └── __tests__/browser-pane.test.ts      (56 行)
└── components/browser/
    ├── BrowserTabBadge.tsx                 (97 行)
    ├── BrowserTabStrip.tsx                 (306 行)
    ├── BrowserToolbar.tsx                  (50 行)
    ├── empty-state-prompts.ts              (44 行)
    ├── utils.ts                            (71 行)
    └── __tests__/utils.test.ts             (28 行)
```

### 共享 UI 组件
```
packages/ui/src/components/ui/
├── BrowserControls.tsx                     (400+ 行)
├── BrowserEmptyStateCard.tsx               (70 行)
└── BrowserShader.tsx
```

### Agent 集成
```
packages/shared/src/agent/
├── browser-tools.ts                        (300+ 行)
├── browser-tool-runtime.ts                 (1000+ 行)
├── browser-tool-names.ts                   (70 行)
└── __tests__/
    ├── browser-tools.test.ts
    ├── browser-tools-permissions.test.ts   (40 行)
    └── browser-tool-names.test.ts
```

---

## 5. 依赖变更

**无新增外部依赖！** 浏览器功能使用 Electron 的内置 Chromium 和 CDP 支持：

- `electron.BrowserWindow` - 原生浏览器窗口
- `electron.BrowserView` - 嵌入式浏览器视图
- `electron.webContents.debugger` - CDP 协议访问
- `electron.session` - Cookie/存储分区

避免了以下依赖：
- ❌ puppeteer-core
- ❌ chrome-remote-interface
- ❌ playwright

---

## 6. 关键设计决策

### 6.1 会话范围的浏览器实例

每个 agent 会话可以有**一个绑定的浏览器实例**。映射是 1:1：
- 会话通过 `BrowserPaneManager.createForSession(sessionId)` 创建浏览器
- 浏览器通过 `boundSessionId` 属性绑定到会话
- 会话终止自动释放浏览器所有权

### 6.2 基于 CDP 的元素引用

不使用脆弱的 CSS 选择器，系统使用**可访问性树引用**：
- `snapshot` 命令返回 `@e1`, `@e2`, `@e3` 等
- 引用在页面加载期间保持稳定
- 引用通过 `BrowserCDP.refMap` 映射到后端 DOM 节点 ID
- 过期引用被检测并清晰报告

### 6.3 工具栏作为独立 BrowserView

浏览器工具栏实现为**独立的 BrowserView** 覆盖在页面上：
- 工具栏：通过 `browser-toolbar.html` 加载的 React 应用
- 页面：用户导航内容在独立视图中
- 原生覆盖层：Agent 控制指示器（第三个视图）
- 所有三个视图由 `BrowserPaneManager` 管理

### 6.4 权限模型

浏览器工具默认**在安全/探索模式下允许**：
- 理由：浏览器交互不会改变本地文件系统
- Agent 可以浏览、截图和提取数据无需批准
- 敏感操作（文件上传）仍需验证

### 6.5 Agent 控制覆盖层

Agent 控制浏览器的视觉反馈系统：
- 带发光效果的强调色边框
- 会话名称 + 意图显示
- 平台特定的圆角半径（macOS: 16px, Windows: 8px, Linux: 6px）
- 在 `release` 命令时自动消失

---

## 7. 安全考虑

### ✅ 已实施的安全措施

1. **会话分区**
   - 所有浏览器使用 `persist:browser-pane` 会话分区
   - Cookie/存储与主应用隔离
   - 防止凭证泄漏

2. **文件上传验证**
   - 需要绝对路径
   - 阻止敏感路径（凭证、SSH 密钥等）
   - 上传前验证文件存在

3. **URL 验证**
   - `file://` URL 限制在安全目录
   - Deep link scheme (`craftagents://`) 单独处理
   - 外部 URL 通过 `shell.openExternal` 打开并确认

4. **CDP 空闲分离**
   - 调试器在 5 秒不活动后分离
   - 防止资源泄漏
   - 下次命令时重新附加

5. **权限检查**
   - 浏览器命令遵守权限模式
   - 安全模式允许只读操作
   - 询问模式提示敏感操作

### ⚠️ 安全审查清单

- [ ] **验证会话分区隔离** - 确保浏览器 cookie 不泄漏到主应用
- [ ] **审计文件上传路径** - 审查阻止路径列表的完整性
- [ ] **测试 deep link 处理** - 验证 `craftagents://` URL 不绕过安全
- [ ] **审查 JavaScript 执行** - 确保 `evaluate` 命令不能逃逸沙箱
- [ ] **检查截图数据处理** - 验证图片不包含敏感元数据
- [ ] **测试跨域限制** - 确保 CDP 不能访问跨域框架
- [ ] **验证剪贴板操作** - 确保剪贴板不在会话间泄漏
- [ ] **审查下载处理** - 验证下载遵守工作区边界
- [ ] **测试窗口焦点窃取** - 确保浏览器不能意外劫持焦点
- [ ] **审计主题颜色提取** - 验证注入的 JS 不能泄露数据

---

## 8. 集成步骤

### 8.1 Window Manager 集成

**文件：** `apps/electron/src/main/window-manager.ts`

```typescript
import { BrowserPaneManager } from './browser-pane-manager'

class WindowManager {
  private browserPaneManager: BrowserPaneManager | null = null

  async init() {
    // 初始化浏览器面板管理器
    this.browserPaneManager = new BrowserPaneManager(this)

    // 注册浏览器 IPC 处理器
    registerBrowserHandlers(this.rpcServer, {
      browserPaneManager: this.browserPaneManager,
      platform: this.platform,
    })
  }

  getBrowserPaneManager(): BrowserPaneManager | null {
    return this.browserPaneManager
  }
}
```

### 8.2 Session Manager 集成

**文件：** `apps/electron/src/main/sessions.ts`

```typescript
import { releaseBrowserOwnershipOnForcedStop } from '@work-agent/server-core/domain'

class SessionManager {
  private createBrowserPaneFns(sessionId: string): BrowserPaneFns {
    const browserMgr = this.windowManager.getBrowserPaneManager()
    if (!browserMgr) {
      throw new Error('Browser pane manager not available')
    }

    return {
      openPanel: (opts) => browserMgr.createForSession(sessionId, opts),
      navigate: (url) => browserMgr.navigate(sessionId, url),
      snapshot: () => browserMgr.getAccessibilitySnapshot(sessionId),
      // ... 映射所有 BrowserPaneFns 方法
    }
  }

  async createAgent(sessionId: string) {
    const browserFns = this.createBrowserPaneFns(sessionId)

    const agent = new CraftAgent({
      // ... 现有配置
      getBrowserPaneFns: () => browserFns,
    })

    return agent
  }

  async stopSession(sessionId: string, forced: boolean) {
    if (forced) {
      await releaseBrowserOwnershipOnForcedStop(
        this.windowManager.getBrowserPaneManager(),
        sessionId
      )
    }
    // ... 现有停止逻辑
  }
}
```

### 8.3 构建配置

**文件：** `apps/electron/package.json`

```json
{
  "scripts": {
    "build:preload-toolbar": "esbuild src/preload/browser-toolbar.ts --bundle --platform=node --format=cjs --outfile=dist/browser-toolbar-preload.cjs --external:electron",
    "build": "... && bun run build:preload-toolbar && ..."
  }
}
```

**文件：** `apps/electron/vite.config.ts`

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        'browser-toolbar': resolve(__dirname, 'src/renderer/browser-toolbar.html'),
        'browser-empty-state': resolve(__dirname, 'src/renderer/browser-empty-state.html'),
      }
    }
  }
})
```

---

## 9. 测试计划

### 单元测试
- BrowserCDP 测试（可访问性快照解析、元素引用分配、CDP 命令执行）
- BrowserPaneManager 测试（实例创建/销毁、会话绑定、导航、截图）
- Browser Tools 测试（命令解析、批量执行、参数验证）
- 权限测试（安全模式允许 browser_tool）

### 集成测试
- 会话 → 浏览器绑定（创建会话 → 浏览器实例创建）
- 多窗口管理（多个会话与独立浏览器）
- CDP 交互流程（导航 → 快照 → 点击 → 验证导航）
- 工具栏通信（用户通过工具栏导航 → 页面更新）

### E2E 测试
- 基本浏览工作流（agent 打开浏览器 → 导航 → 截图 → 关闭）
- 表单填充工作流（导航到表单 → 快照 → 填充字段 → 提交 → 验证）
- Canvas 交互（Google Sheets）
- 多步骤自动化（登录 → 导航 → 提取数据 → 填充报告 → 提交）

---

## 10. 工程复杂度评估

**工程评估：** 恰到好处

**理由：** 实现恰好解决了陈述的问题（agent 控制的浏览器自动化），具有适当的抽象。CDP 包装器、实例管理器和工具接口都是具有明确职责的必要组件。没有过度工程（没有为一个用例设计插件系统），没有工程不足（适当的错误处理、测试和安全检查）。多视图架构（工具栏 + 页面 + 覆盖层）由 UX 需求证明合理。

---

## 11. 预计工作量

**开发时间：** 2-3 天（对于熟悉代码库的高级工程师）

**风险等级：** 中 - 功能隔离良好，具有清晰的接口和全面的测试

**关键里程碑：**
- 第 1 天：集成 BrowserPaneManager 和 IPC 处理器
- 第 2 天：连接 SessionManager 和 Agent 工具
- 第 3 天：测试、调试和文档

