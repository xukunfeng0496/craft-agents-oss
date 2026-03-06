---
name: jiandaoyun
description: 简道云（JianDaoYun）数据查询。专门用于查询表单数据和获取字段结构。
---

# 简道云数据查询 Skill

这个 skill 专门用于**简道云数据查询**操作，不支持数据修改（新增、更新、删除）。

## 触发场景

当用户提到以下内容时，应使用此 skill：
- "查询简道云"
- "获取简道云数据"
- "简道云表单数据"
- "JDY 查询"
- "jiandaoyun"
- "jdy.cvte.com"

## API 配置

需要设置环境变量：

```bash
export JDY_API_KEY="your-api-key-here"
export JDY_API_URL="https://faas-ha.gz.cvte.cn/function/post-jdy-data"
```

## 表单配置

在 `config.json` 中配置常用的表单：

```json
{
  "forms": {
    "机器人市场问题登记": {
      "appid": "63db6790aaed630008532362",
      "tableid": "68ac26e569fecbcfc5b8ac88"
    }
  }
}
```

## 支持的查询操作

### 1. 查询多条数据

```python
from scripts.jdy_api import get_data, get_data_by_config

# 使用配置名称查询（推荐）
result = get_data_by_config("机器人市场问题登记", limit=100)

# 直接使用 appid 和 tableid
result = get_data(appid, tableid, limit=100, filter_cond=[
    {"field": "字段名", "method": "eq", "value": "值"}
])
```

筛选方法 (method):
- `eq` 等于, `ne` 不等于
- `in` 包含, `nin` 不包含
- `range` 范围 (value 为 [min, max])
- `empty` 为空, `not_empty` 不为空

### 2. 查询单条数据

```python
from scripts.jdy_api import get_single

result = get_single(appid, tableid, data_id)
```

### 3. 查询表单字段结构

```python
from scripts.jdy_api import get_table_fields

fields = get_table_fields(appid, tableid)
```

### 4. 获取审批信息

```python
from scripts.jdy_api import get_approval

approval = get_approval(appid, tableid, data_id)

# 查询流程状态
from scripts.jdy_api import get_approval_status
status = get_approval_status(appid, tableid, instance_id)
```

## 不支持的操作

此 skill **仅用于查询**，不支持以下操作：
- ❌ 新增数据 (add)
- ❌ 更新数据 (update)
- ❌ 删除数据 (delete)
- ❌ 提交审批 (approval_submit)

如需数据修改操作，请告知用户此 skill 仅支持查询。

## 从 URL 提取 ID

简道云 URL 格式: `https://jdy.cvte.com/dashboard/app/{appid}/...`

- `appid`: URL 中 `/app/` 后的 ID
- `tableid`: 需要通过 `table_fields` 操作或用户提供
