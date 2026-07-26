# CVTE 企业版迭代历程

CVTE 企业定制版（"Work Agents"）基于上游 [`craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss) 的重基线与持续交付记录。

- **基线**：上游 v0.4.8 → 重基线至 **v0.10.3**
- **当前发布**：**0.10.318**（已签名+公证，OTA stable 全量上线）
- **决策与定制清单事实源**：[`CUSTOMIZATIONS.md`](./CUSTOMIZATIONS.md)
- **跟随上游的流程**：[`upstream-sync-playbook.md`](./upstream-sync-playbook.md)

## 关键步骤（里程碑）

### 1. 重基线 + 品牌/配置（M0–M1）
- 在独立 git worktree 切到上游 v0.10.3，隔离实施。
- 品牌 Craft → **Work Agent**；`appId=com.workagent.app`；deep-link scheme `workagents://`。
- 企业配置进 `apps/electron/resources/config-defaults.json`（网关、SSO、viewer、Sentry、NO_PROXY 等）。

### 2. OTA 接入（M2）
- 移植 **fast-update-server** 客户端：自定义 `check` API + **版本化 feed**（非渠道根 manifest）。
- 上传脚本 `scripts/upload-fast-update-release.ts` + 双平台 CI。

### 3. 核心能力收口（M3–M4）
- MVP 链路；`hooks.json → automations v2` 转换器；Skill Variables 编辑器；上游核心能力冒烟。

### 4. 企业定制四件套
- **网关零配置**：`enforceCvteGatewayShape` 不变量，把连接定形为 Anthropic 兼容 @ `token.cvte.com`。
- **门户 SSO 闭环**：`packages/portal-key-relay` 中继（持 admin key，服务端代理 list/reveal）→ 门户登录换个人网关 key。⚠️ 修复过 **P0 越权串号**（弃 `parseInt(simUid)`，改门户 username 精确匹配 + 启用态过滤）。
- **会话分享内网化**：`packages/session-share-server`（可插拔 fs/S3 存储 + HMAC 写鉴权）；`apps/viewer` 拔除一切外链（杜绝 craft.do 外流）。
- **技能市场重集成**：skills.gz.cvte.cn 新 header 鉴权（`X-CSkills-User-Account`），复用门户 SSO 身份，未登录安装一键触发登录。

### 5. 稳定性 / 可观测性
- 内网 Sentry 故障上报（DSN 走 config-defaults）。
- Unknown Error 可诊断化：SDK stderr 落盘 + 分类；瞬态错误 turn 成功时不再误弹。
- 移除明文兜底 key，接入改 SSO/relay/手填。

### 6. 跨平台
- **macOS**：Apple Developer-ID 签名 + 公证（Team `2ZNMX3X6V3`）——OTA 无缝换包的前提。
- **Windows**：内置工具链 git(MinGit) / python(embed) / **node** / **uv**，打包 + 运行时注入 agent 子进程 PATH。

### 7. 发布闭环（0.10.317 → 0.10.318）
- Windows SSO/市场登录卡死修复（preload `shell.openExternal` 受 user-activation 门控 → 改主进程开链 + 回调超时）。
- 制品命名带版本号 `Work-Agent-<ver>-<os>-<arch>`（对齐 v0.7.1）；release note 精简为单版本能力 summary。
- 签名+公证构建（fork CI）→ OTA **beta 灰度 → 真机验证 → stable 全量**。
- **真机 OTA 验证通过**：v0.7.1 → 0.10.318，下载 + Squirrel 签名换包 + 数据零损。

## 已知尾巴 / 后续

- 另 3 条 OAuth（Claude / ChatGPT / source）有与门户 SSO 同源的 `shell.openExternal` Windows 隐患，待同法修。
- Windows 缺 `bash`（MinGit 不含）；agent 在 Windows 用 PowerShell，硬调 `bash xxx.sh` 的技能会失败。
- OTA 代理旁路：electron-updater 读系统代理，开系统代理且够不到内网 rxpc 的用户 OTA 会 502；正解是给 updater 加 `*.gz.cvte.cn` 旁路（当前以"关代理"规避）。
- 生产 SSO：`config-defaults` 仍 op-fat 测试门户，发版前回填 `home.cvte.com` + 生产 client_id + 内网生产 relay。
- 分支策略：`cvte/rebase-0.10.3-rc` 待大多数用户测试通过后再 merge 到 `cvte/main`。
