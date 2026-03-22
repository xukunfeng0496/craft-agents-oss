# OTA 测试方案

**Engineering Assessment:** Just right
**Reason:** OTA 模块代码量小、改动频率低，用一个测试脚本 + 开发模式验证即可覆盖真实场景，不需要 mock 框架或 E2E 基础设施。

---

## 测试手段

### 1. API 契约验证脚本

**文件**: `scripts/test-ota-flow.ts`

直接请求真实或 mock 的 fast-update-server，验证 API 响应格式与客户端预期一致。

```bash
bun run scripts/test-ota-flow.ts check   # 验证真实服务器的 check API
bun run scripts/test-ota-flow.ts mock    # 启动 mock server 用于本地测试
```

**check 子命令** 验证：
- check API 返回格式 (`updateAvailable`, `version`, `files`, `sha512`)
- versioned download URL 返回 `latest-mac.yml`
- blockmap 文件可下载
- 429 限流响应头

**mock 子命令** 提供：
- 可控的 mock server（端口 8888）
- 支持模拟 有更新 / 无更新 / 429 限流 / 服务器错误
- 配合 `electron:dev` 验证端到端流程

### 2. 开发模式端到端验证

使用已有的 `AUTO_UPDATE_ENABLE_DEV=1` 机制：

```bash
# 连接真实 fast-update-server
AUTO_UPDATE_ENABLE_DEV=1 \
AUTO_UPDATE_SERVER_URL=http://127.0.0.1:8080 \
bun run electron:dev

# 连接 mock server
bun run scripts/test-ota-flow.ts mock &
AUTO_UPDATE_ENABLE_DEV=1 \
AUTO_UPDATE_SERVER_URL=http://127.0.0.1:8888 \
bun run electron:dev
```

**验证点（查看日志）：**
- `[auto-update] Using fast-update-server compatibility mode`
- `[auto-update] fast-update-server update X.X.X available`
- `[auto-update] Cache cleanup: removed N file(s), freed X MB`
- UI toast 显示 "Update downloaded, will install on quit"
- 限流时出现 `Rate limited (429), retry in Xms`

---

## 测试检查清单

### 正常流程
- [ ] check API 返回有更新 → electron-updater 下载 → toast 提示
- [ ] check API 返回无更新 → 状态保持 idle
- [ ] 退出时自动安装（`autoInstallOnAppQuit`）

### 异常流程
- [ ] fast-update-server 不可达 → 状态变为 error，不阻塞 app 使用
- [ ] 429 限流 → 自动重试，日志有记录
- [ ] 下载中断 → 下次启动重新检查

### 缓存清理
- [ ] 启动时清理旧版本缓存文件
- [ ] 不清理当前版本和正在下载的文件

---

## 实施

| 步骤 | 内容 |
|------|------|
| 1 | 创建 `scripts/test-ota-flow.ts`（check + mock 两个子命令）|
| 2 | 在 `package.json` 添加 `test:ota` 脚本 |
