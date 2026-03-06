#!/usr/bin/env python3
"""简道云 API 调用脚本"""

import json
import sys
import urllib.request
import urllib.error
import os
from pathlib import Path

API_URL = os.getenv("JDY_API_URL", "https://faas-ha.gz.cvte.cn/function/post-jdy-data")
API_KEY = os.getenv("JDY_API_KEY", "")

def load_config():
    """加载配置文件"""
    config_path = Path(__file__).parent.parent / "config.json"
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"forms": {}}

def get_form_config(form_name: str) -> dict:
    """获取表单配置"""
    config = load_config()
    if form_name not in config.get("forms", {}):
        raise ValueError(f"表单配置 '{form_name}' 不存在")
    return config["forms"][form_name]

def call_jdy_api(operations: list) -> dict:
    """调用简道云 API"""
    if not API_KEY:
        raise ValueError("JDY_API_KEY environment variable is required")
    headers = {
        "apikey": API_KEY,
        "Content-Type": "application/json"
    }
    data = json.dumps(operations).encode("utf-8")
    req = urllib.request.Request(API_URL, data=data, headers=headers)
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode("utf-8"))

def get_data(appid: str, tableid: str, fields: list = None, limit: int = 100, filter_cond: list = None) -> dict:
    """查询多条数据"""
    return call_jdy_api([{
        "operate": "get",
        "appid": appid,
        "tableid": tableid,
        "data": {
            "fields": fields or [],
            "limit": limit,
            "filter": {"rel": "and", "cond": filter_cond or []}
        }
    }])

def get_single(appid: str, tableid: str, data_id: str) -> dict:
    """查询单条数据"""
    return call_jdy_api([{
        "operate": "get",
        "appid": appid,
        "tableid": tableid,
        "data": {"data_id": data_id}
    }])

def get_table_fields(appid: str, tableid: str) -> dict:
    """查询表单字段"""
    return call_jdy_api([{
        "operate": "table_fields",
        "appid": appid,
        "tableid": tableid
    }])

def add_data(appid: str, tableid: str, data: dict, start_workflow: bool = True, start_trigger: bool = True) -> dict:
    """新增数据"""
    return call_jdy_api([{
        "operate": "add",
        "appid": appid,
        "tableid": tableid,
        "data": {
            "is_start_workflow": start_workflow,
            "is_start_trigger": start_trigger,
            "data": data
        }
    }])

def update_data(appid: str, tableid: str, data_id: str, data: dict, start_workflow: bool = True, start_trigger: bool = True) -> dict:
    """更新数据"""
    return call_jdy_api([{
        "operate": "update",
        "appid": appid,
        "tableid": tableid,
        "data": {
            "data_id": data_id,
            "is_start_workflow": start_workflow,
            "is_start_trigger": start_trigger,
            "data": data
        }
    }])

def delete_data(appid: str, tableid: str, data_id: str) -> dict:
    """删除数据"""
    return call_jdy_api([{
        "operate": "delete",
        "appid": appid,
        "tableid": tableid,
        "data": {"data_id": data_id}
    }])

def get_approval(appid: str, tableid: str, data_id: str) -> dict:
    """获取审批意见"""
    return call_jdy_api([{
        "operate": "approval",
        "appid": appid,
        "tableid": tableid,
        "data": {"data_id": data_id}
    }])

def submit_approval(appid: str, tableid: str, username: str, instance_id: str, task_id: str, comment: str) -> dict:
    """提交审批"""
    return call_jdy_api([{
        "operate": "approval_submit",
        "appid": appid,
        "tableid": tableid,
        "data": {
            "username": username,
            "instance_id": instance_id,
            "task_id": task_id,
            "comment": comment
        }
    }])

def get_approval_status(appid: str, tableid: str, instance_id: str, tasks_type: int = 1) -> dict:
    """查询流程状态"""
    return call_jdy_api([{
        "operate": "approval_get",
        "appid": appid,
        "tableid": tableid,
        "data": {"instance_id": instance_id, "tasks_type": tasks_type}
    }])

# 便捷函数：使用配置名称
def get_data_by_config(form_name: str, fields: list = None, limit: int = 100, filter_cond: list = None) -> dict:
    """使用配置名称查询数据"""
    config = get_form_config(form_name)
    return get_data(config["appid"], config["tableid"], fields, limit, filter_cond)

def add_data_by_config(form_name: str, data: dict, start_workflow: bool = True, start_trigger: bool = True) -> dict:
    """使用配置名称新增数据"""
    config = get_form_config(form_name)
    return add_data(config["appid"], config["tableid"], data, start_workflow, start_trigger)

def update_data_by_config(form_name: str, data_id: str, data: dict, start_workflow: bool = True, start_trigger: bool = True) -> dict:
    """使用配置名称更新数据"""
    config = get_form_config(form_name)
    return update_data(config["appid"], config["tableid"], data_id, data, start_workflow, start_trigger)

def delete_data_by_config(form_name: str, data_id: str) -> dict:
    """使用配置名称删除数据"""
    config = get_form_config(form_name)
    return delete_data(config["appid"], config["tableid"], data_id)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: jdy_api.py <json_operations>")
        sys.exit(1)

    operations = json.loads(sys.argv[1])
    result = call_jdy_api(operations if isinstance(operations, list) else [operations])
    print(json.dumps(result, ensure_ascii=False, indent=2))
