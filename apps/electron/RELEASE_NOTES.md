## v0.5.5 更新内容

### 新功能
- **Windows 工具捆绑**：Windows 版本内置 MinGit 和 Python，无需系统安装即可使用 Agent 功能
- **Hooks 管理界面**：新增 Hooks 设置页面，支持可视化管理定时任务（CRUD 操作）
- **技能变量刷新**：支持 workingDirectory 配置和技能变量 overlay 自动刷新
- **CVTE-SECRET 模型**：新增 CVTE-SECRET 模型配置，用于处理机密数据任务

### 修复
- **API 认证**：修复自定义端点连接使用 x-api-key header 的认证问题
- **设置版本同步**：修复设置页面版本号与应用版本不同步的问题
- **代码签名**：启用 macOS 代码签名和公证，提升安全性

### 改进
- **UI 组件重构**：移除旧的 schedules UI 组件，使用新的 Hooks 管理界面
- **工具检测优化**：Windows 平台优先使用捆绑工具，提升可靠性
