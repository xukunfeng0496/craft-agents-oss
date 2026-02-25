# Work Agents 官网设计方案

## 概述

为 Work Agents 创建一个静态官网，面向普通办公用户，展示产品价值、提供下载、托管帮助文档。

## 需求确认

| 项目 | 选择 |
|------|------|
| 目标用户 | 普通办公用户 |
| 首页 | 单一长页面 |
| 帮助文档 | 子页面（多页面文档站） |
| 托管 | GitHub Pages |
| 技术栈 | Astro + Tailwind |
| 视觉风格 | 跟随应用 UI |
| 下载交互 | 自动检测 + 下拉选择 |
| 案例管理 | YAML 配置文件 |

## 站点结构

```
/
├── index.html              # 首页
├── docs/                   # 帮助文档
│   ├── getting-started/    # 入门指南
│   ├── features/           # 功能介绍
│   └── faq/                # 常见问题
└── download/               # 下载页面（可选）
```

## 首页区块

1. **Hero 区** - 品牌标语 + 智能下载按钮 + 产品截图
2. **特性亮点** - 4 个核心功能卡片
3. **使用案例** - 案例卡片网格（YAML 配置驱动）
4. **工作原理** - 简单流程图
5. **下载区** - 再次下载按钮 + 版本信息
6. **Footer** - 链接、开源声明

## 设计系统

复用应用主题色：
- 品牌色（绿色）：`oklch(0.52 0.13 148)` / `#2e6e44`
- 背景色：`oklch(0.98 0.003 265)` / `#f8f8fa`
- 文字色：`oklch(0.185 0.01 270)` / `#26242a`
- 阴影：精致边框阴影

## 技术实现

- Astro 静态站点生成
- Tailwind CSS 样式
- 构建时从 GitHub Releases API 获取版本
- GitHub Actions 自动部署到 GitHub Pages

## 文件结构

```
website/
├── src/
│   ├── components/         # UI 组件
│   ├── content/            # 内容文件
│   │   ├── cases.yaml      # 案例配置
│   │   └── docs/           # Markdown 文档
│   ├── layouts/            # 布局模板
│   ├── pages/              # 页面路由
│   └── styles/             # 样式文件
├── scripts/                # 构建脚本
└── package.json
```
