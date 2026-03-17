## v0.6.0 更新内容

### 新功能
- **Browser 工具正式集成**：新增内置浏览器能力，Agent 可直接打开网页、导航、读取页面结构、点击元素、填写表单、截图和抓取控制台/网络信息
- **聊天页浏览器入口**：在聊天页头部加入 Browser 标签栏与快捷打开入口，方便在会话中随时调起浏览器窗口
- **Claude Browser Tool 接入**：`browser_tool` 已接入 Claude Agent，并支持在 safe mode 下使用

### 修复
- **浏览器窗口稳定性**：修复 browser pane 的 IPC、preload 路由、首次显示行为和空状态本地化问题
- **会话恢复与附件跟进**：修复中断 session 恢复和附件 follow-up 场景的可靠性问题
- **标题与输入体验**：修复 Codex 标题生成与 shared prompt 不一致问题，并修复 structured input 高度同步异常

### 改进
- **Streaming 性能优化**：减少冗余 session work，缩小 renderer 更新范围，提升长时间流式输出稳定性
- **平台兼容性增强**：Windows 优先使用 bundled MinGit shell，macOS 为 Claude runtime 增加 per-request fallback
- **界面细节打磨**：减少重复 workspace 图标查找，并补齐 browser 相关 UI 组件与交互细节
