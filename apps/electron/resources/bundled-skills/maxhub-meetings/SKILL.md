---
name: maxhub-meetings
description: 查询 MAXHUB Teams (mini-teams.maxhub.com) 的会议记录。当用户询问"我今天/本周有什么会议"、"帮我查一下会议安排"、"查看 MAXHUB 会议记录"、"我有哪些会议"等时触发。支持登录获取 token、查询指定时间范围的会议列表。
---

# MAXHUB Teams 会议记录

脚本: `scripts/meetings.py`，依赖 `requests`（`pip install requests`）。

凭证保存在 `~/.maxhub_config.json`（权限 600），登录后自动读取，无需每次传参。

## 首次使用：登录

`company_id` 和 `staff_id` 有内置默认值。登录时需要用户提供手机号和密码：

```bash
python3 /Users/kun/.claude/skills/maxhub-meetings/scripts/meetings.py login 手机号 --password 密码
```

## 工作流

1. 检查 `~/.maxhub_config.json` 是否存在且有 token
2. 若无，直接在对话中告知用户需要提供手机号和密码（不使用 AskUserQuestion 工具），等用户回复后执行 login 命令
3. 执行 `meetings` 命令获取结果并展示给用户

## 查询会议

```bash
SCRIPT=/Users/kun/.claude/skills/maxhub-meetings/scripts/meetings.py

# 指定日期范围（推荐）
python3 $SCRIPT meetings --start 2026-02-04 --end 2026-02-18

# 只指定开始日期（到今天）
python3 $SCRIPT meetings --start 2026-02-01

# 过去 N 天（默认 7）
python3 $SCRIPT meetings --days 14

# 未来 N 天（负数）
python3 $SCRIPT meetings --days -7

# 输出原始 JSON
python3 $SCRIPT meetings --start 2026-02-01 --end 2026-02-28 --json
```

日期格式：`YYYY-MM-DD`。`--start`/`--end` 优先于 `--days`。



| 状态 | 含义 |
|------|------|
| PENDING | 待开始 |
| FINISH | 已完成 |
| CANCEL | 已取消 |

Token 过期后重新执行 `login`。
