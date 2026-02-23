# Work Agents 问题排查与修复总结

> **日期：** 2026-02-23  
> **平台：** macOS 12.6 (Darwin 21.6.0) / Apple Silicon (arm64)  
> **版本：** 0.5.1

---

## 问题一：应用启动后界面空白

### 现象

安装打包后的 DMG 或运行开发模式，Electron 窗口打开但内容完全空白，无任何 UI 渲染。

### 根因

三个问题叠加导致：

#### 1.1 Vite 预打包 `electron-log` 失败

`apps/electron/vite.config.ts` 中 `electron-log` 被排除在 `optimizeDeps` 之外，导致浏览器环境尝试直接加载包含 Node.js `require()` 调用的代码。重新纳入预打包后，又暴露了更深层问题：`electron-log` 的 Node.js 传输模块（`remote.js`）引用了 `https`、`fs` 等 Node.js 内置模块，使 esbuild 预打包崩溃。

**修复：** 在 `vite.config.ts` 的 `optimizeDeps.esbuildOptions.plugins` 中添加 `node-builtins-external` 插件，将 Node.js 内置模块标记为 external 并提供空 stub：

```typescript
// apps/electron/vite.config.ts
optimizeDeps: {
  esbuildOptions: {
    plugins: [
      {
        name: 'node-builtins-external',
        setup(build) {
          const builtins = new Set([
            'https', 'http', 'fs', 'path', 'os', 'util', 'events',
            'stream', 'electron', 'original-fs', 'child_process', 'net',
          ])
          build.onResolve({ filter: /^node:/ }, ({ path }) => {
            const moduleName = path.replace(/^node:/, '')
            if (builtins.has(moduleName)) {
              return { path: moduleName, external: true }
            }
            return null
          })
          build.onResolve({
            filter: new RegExp(`^(${Array.from(builtins).join('|')})$`)
          }, ({ path }) => {
            return { path, external: true }
          })
          build.onLoad({
            filter: new RegExp(`^(${Array.from(builtins).join('|')})$`)
          }, () => ({
            contents: 'export default {}',
            loader: 'js',
          }))
        },
      },
    ],
  }
}
```

#### 1.2 `window-state.json` 中保存了畸形 URL

窗口状态持久化文件 `window-state.json` 存储了一个混合了 `file://` 路径和 `http://localhost:5173` 的畸形 URL（形如 `http://localhost:5173/Users/caoyong/.../dist/renderer/index.html`）。开发模式下恢复该 URL 导致 Vite 加载失败。

**修复：**
1. 删除损坏的 `window-state.json` 文件
2. 修改 `apps/electron/src/main/window-manager.ts` 中的 URL 恢复逻辑，开发模式下仅继承 URL 的查询参数（`search`），不继承路径名（`pathname`）：

```typescript
// apps/electron/src/main/window-manager.ts — createWindow()
if (restoreUrl && VITE_DEV_SERVER_URL) {
  try {
    const savedUrl = new URL(restoreUrl)
    const devUrl = new URL(VITE_DEV_SERVER_URL)
    // 仅保留查询参数，丢弃可能过时的路径
    devUrl.search = savedUrl.search
    window.loadURL(devUrl.toString())
  } catch {
    // 解析失败时回退到默认参数
    const params = new URLSearchParams({ workspaceId }).toString()
    window.loadURL(`${VITE_DEV_SERVER_URL}?${params}`)
  }
}
```

#### 1.3 `handleWhatsNewClick` 未定义导致渲染崩溃

修复前两个问题后，应用显示 Sentry ErrorBoundary 的崩溃回退页面（"Something went wrong. Please restart the app."）。控制台报错：

```
Uncaught ReferenceError: handleWhatsNewClick is not defined
```

`AppShell.tsx` 中 `unifiedSidebarItems` 引用了 `handleWhatsNewClick`，但该回调函数未被定义。

**修复：** 在 `apps/electron/src/renderer/components/app-shell/AppShell.tsx` 中添加缺失的 `useCallback`：

```typescript
const handleWhatsNewClick = useCallback(() => {
  navigate(routes.view.whatsNew())
}, [])
```

---

## 问题二：打包后的 `afterPack.cjs` 应用名不匹配

### 现象

打包脚本 `afterPack.cjs` 中硬编码了 `'Craft Agents.app'`，但 `electron-builder.yml` 的 `productName` 为 `Work Agents`，导致 Liquid Glass 图标无法正确复制到 `.app` 包中。

### 修复

```diff
- const resourcesDir = path.join(appPath, 'Craft Agents.app', 'Contents', 'Resources');
+ const resourcesDir = path.join(appPath, 'Work Agents.app', 'Contents', 'Resources');
```

**文件：** `apps/electron/scripts/afterPack.cjs`

---

## 问题三：对话发送后模型回复卡住

### 现象

在对话框输入文字后，API 请求成功发出，但模型回复始终不返回，界面一直显示加载状态。日志显示：

```
Session completed without assistant response - possible context overflow or API issue
```

### 根因

查看拦截器日志 (`~/.workagent/logs/interceptor.log`) 发现 API 返回 **401 认证错误**：

```json
{
  "error": {
    "message": "提供了多个冲突的 API 密钥。请仅使用一种认证方式。",
    "type": "authentication_error"
  }
}
```

请求同时携带了两个认证头：
- `x-api-key: [REDACTED]` — 来自 `ANTHROPIC_API_KEY` 环境变量
- `authorization: Bearer [REDACTED]` — 来自 Claude Code SDK 内部读取的 macOS 钥匙串 OAuth token

自定义 API 端点（`navimaxx-cc.test.seewo.com`）检测到两种认证方式并发冲突，拒绝了请求。

### 原因链

```
1. SessionManager.reinitializeAuth() 设置 ANTHROPIC_API_KEY（正确）
2. SDK 子进程继承该环境变量 → Anthropic SDK 设置 x-api-key 头（正确）
3. SDK 子进程内部同时从 macOS 钥匙串读取了残留的 OAuth token（不可控）
4. Anthropic SDK 同时设置 authorization: Bearer 头（多余）
5. 自定义端点收到两个认证头 → 返回 401
6. 主进程收到空响应 → "completed without assistant response"
```

### 修复

在网络拦截器 `packages/shared/src/network-interceptor.ts` 中添加 `stripConflictingAuthHeaders` 函数：

```typescript
/**
 * 检查是否为自定义（非 Anthropic 官方）端点
 */
function isCustomEndpoint(): boolean {
  const baseUrl = getConfiguredBaseUrl();
  return !baseUrl.includes('anthropic.com');
}

/**
 * 为自定义 API 端点去除冲突的认证头。
 *
 * Claude Code SDK 可能同时设置 x-api-key（来自 ANTHROPIC_API_KEY）
 * 和 authorization（来自 OAuth 钥匙串）。自定义端点会拒绝双重认证。
 *
 * 当两个头同时存在且目标是非 Anthropic 端点时，移除 authorization 头。
 */
function stripConflictingAuthHeaders(
  headers: HeadersInitType | undefined
): HeadersInitType | undefined {
  if (!headers || !isCustomEndpoint()) return headers;

  // 归一化为对象以检查
  let headerObj: Record<string, string> = {};
  // ... (处理 Headers / string[][] / Record 三种类型)

  // 仅在两种认证方式同时存在时才去除
  if (headerObj['x-api-key'] && headerObj['authorization']) {
    debugLog('[Auth Fix] Stripping conflicting authorization header');
    // 重建 headers，移除 authorization
    // ...
  }
  return headers;
}
```

在 `interceptedFetch` 中，API 请求发出前调用该函数：

```typescript
if (isApiMessagesUrl(url) && init) {
  init = {
    ...init,
    headers: stripConflictingAuthHeaders(init.headers)
  };
}
```

**设计考量：**
- 仅对自定义端点生效，不影响 Anthropic 官方 API（官方 API 支持 OAuth）
- 仅在两个认证头同时存在时才去除，单一认证方式不受影响
- 优先保留 `x-api-key`（用户显式配置的 API Key）

---

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `apps/electron/vite.config.ts` | 添加 esbuild 插件处理 Node.js 内置模块 |
| `apps/electron/src/main/window-manager.ts` | 修复开发模式下窗口 URL 恢复逻辑 |
| `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | 添加缺失的 `handleWhatsNewClick` 回调 |
| `apps/electron/scripts/afterPack.cjs` | 修正应用名 `Craft Agents` → `Work Agents` |
| `packages/shared/src/network-interceptor.ts` | 添加自定义端点双重认证头冲突修复 |

---

## 验证

修复后重新打包生成的 DMG：

```
apps/electron/release/Work-Agent-osx-arm64.dmg (159MB, arm64)
```

安装后验证：
1. ✅ 应用正常启动，界面完整渲染
2. ✅ 侧边栏导航正常工作（`handleWhatsNewClick` 不再报错）
3. ✅ 窗口状态恢复不再产生畸形 URL
4. ✅ 自定义 API 端点认证正常（仅发送 `x-api-key`）
