# TODO List

## 2026-02-21

### [UI] AI 设置页 - 自定义 API 模型选择改造

**位置:** `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx`

**需求描述:**

当用户配置「自定义 Claude API」时，将原来的模型 ID 文本输入框改造为可点击选择的模型选择器，同时保留手动输入的能力。

**详细功能点:**

1. **预设模型列表（可点击选择）**
   - 展示推荐模型列表，每个模型附带推荐理由说明
   - 默认预设模型：
     - `claude-sonnet-4-6` — 推荐：Claude 最新旗舰模型，能力强，速度均衡
     - `glm-4-5` — 推荐：国内可用，兼容 OpenAI API 格式，成本低
   - 选中状态高亮显示

2. **手动添加模型 ID**
   - 在列表底部提供输入框，允许用户手动输入任意模型 ID
   - 手动添加的模型出现在列表中，可选择

3. **逐个验证（Validate）**
   - 点击 Validate 按钮后，对已选/配置的模型列表**逐个**发送测试请求
   - 每个模型显示独立的验证状态（加载中 / 可用 ✓ / 不可用 ✗）
   - 验证通过的模型自动标记为可用

**相关文件:**
- `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` — 主要改动
- `apps/electron/src/renderer/components/settings/SearchableModelInput.tsx` — 可能需要改造或替换
- `packages/shared/src/config/llm-connections.ts` — 模型配置存储
- `apps/electron/src/main/ipc.ts` — validate 接口可能需要扩展支持批量测试

---

### [UI] AI 设置页 - Claude API 秘钥配置，将 Custom 移到第一选项

**位置:** `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx`

**需求描述:**

在配置 Claude API 秘钥的选项列表中，将「Custom（自定义）」选项调整为**第一个**，作为默认展示项。

**相关文件:**
- `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` — 调整选项排序
