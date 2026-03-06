#!/usr/bin/env python3
"""MAXHUB Teams 会议记录查询工具"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta

try:
    import requests
except ImportError:
    print("缺少依赖: pip install requests", file=sys.stderr)
    sys.exit(1)

BASE_URL = "https://mini-teams.maxhub.com"
CONFIG_FILE = os.path.expanduser("~/.maxhub_config.json")

# 默认凭证（可通过登录覆盖）
DEFAULT_COMPANY_ID = "3476991a-6605-4f5b-8f5b-3de65e41b9c7"
DEFAULT_STAFF_ID = "3f416335-3463-494c-8403-5e26b18aa64b"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}


def save_config(config: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)
    os.chmod(CONFIG_FILE, 0o600)


def get_session_id() -> str:
    """获取 sessionId（无需认证）"""
    url = f"{BASE_URL}/api-pivot/api/pauth/token/session"
    resp = requests.post(url, json={"scope": "basic"},
                         headers={"Content-Type": "application/json"})
    resp.raise_for_status()
    return resp.json()["sessionId"]


def login(username: str, password: str) -> dict:
    """登录并返回 token 信息"""
    session_id = get_session_id()
    url = f"{BASE_URL}/pivot/api/pauth/token/password"
    resp = requests.post(url, json={
        "username": username,
        "password": sha256(password),
        "graphicCaptcha": ""
    }, headers={
        "Accept": "application/json",
        "Content-Type": "application/json",
        "x-session-id": session_id,
    })
    resp.raise_for_status()
    data = resp.json()
    if "access_token" not in data:
        raise RuntimeError(f"登录失败: {data}")
    return data


def get_meetings(token: str, company_id: str, user_id: str, staff_id: str,
                 begin_ts: int, end_ts: int) -> list:
    """获取会议列表"""
    url = f"{BASE_URL}/meeting/api/user/meeting-records/list"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "x-company-id": company_id,
        "x-auth-userId": user_id,
        "x-staff-id": staff_id,
        "x-user-id": user_id,
    }
    params = {
        "beginTime": begin_ts,
        "endTime": end_ts,
        "markConflict": "true",
        "needMeetingAuditRecord": "true",
    }
    resp = requests.get(url, headers=headers, params=params)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"获取会议失败: {data}")
    return data.get("data", [])


def format_ts(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M")


def print_meetings(meetings: list):
    if not meetings:
        print("没有找到会议记录")
        return
    print(f"共 {len(meetings)} 个会议:\n")
    for item in meetings:
        m = item.get("meeting", {})
        status_map = {"FINISH": "已完成", "CANCEL": "已取消", "PENDING": "待开始"}
        status = status_map.get(m.get("status", ""), m.get("status", ""))
        print(f"[{status}] {m.get('subject', '(无主题)')}")
        print(f"  时间: {format_ts(m['beginTime'])} ~ {format_ts(m['endTime'])}")
        if m.get("address"):
            print(f"  地点: {m['address']}")
        if m.get("content"):
            print(f"  描述: {m['content'][:80]}")
        print()


def cmd_login(args):
    if args.password:
        password = args.password
    else:
        import getpass
        password = getpass.getpass("密码: ")
    print("正在登录...")
    data = login(args.username, password)
    config = load_config()
    config.update({
        "token": data["access_token"],
        "user_id": data["userId"],
        "company_id": args.company_id or DEFAULT_COMPANY_ID,
        "staff_id": args.staff_id or DEFAULT_STAFF_ID,
        "username": args.username,
        "password_hash": sha256(password),  # 保存哈希，不保存明文
    })
    save_config(config)
    print(f"登录成功，token 已保存到 {CONFIG_FILE}")
    print(f"Token 有效期 14 天，到期时间约: {datetime.now() + timedelta(seconds=data['expires_in']):%Y-%m-%d}")


def login_with_hash(username: str, password_hash: str) -> dict:
    """用已哈希的密码登录"""
    session_id = get_session_id()
    url = f"{BASE_URL}/pivot/api/pauth/token/password"
    resp = requests.post(url, json={
        "username": username,
        "password": password_hash,
        "graphicCaptcha": ""
    }, headers={
        "Accept": "application/json",
        "Content-Type": "application/json",
        "x-session-id": session_id,
    })
    resp.raise_for_status()
    data = resp.json()
    if "access_token" not in data:
        raise RuntimeError(f"登录失败: {data}")
    return data


def cmd_meetings(args):
    config = load_config()
    token = args.token or config.get("token")
    company_id = args.company_id or config.get("company_id")
    user_id = args.user_id or config.get("user_id")
    staff_id = args.staff_id or config.get("staff_id")

    # 无 token 但有存储的凭证，自动重新登录
    if not token and config.get("username") and config.get("password_hash"):
        print("Token 不存在，使用存储凭证自动登录...")
        data = login_with_hash(config["username"], config["password_hash"])
        config.update({"token": data["access_token"], "user_id": data["userId"]})
        save_config(config)
        token = config["token"]
        user_id = config["user_id"]

    if not all([token, company_id, user_id, staff_id]):
        print("缺少凭证，请先运行 login 子命令，或通过参数传入", file=sys.stderr)
        sys.exit(1)

    now = datetime.now()
    if args.start:
        begin = datetime.strptime(args.start, "%Y-%m-%d")
        end = datetime.strptime(args.end, "%Y-%m-%d").replace(hour=23, minute=59, second=59) if args.end else now
    elif args.days > 0:
        begin = (now - timedelta(days=args.days)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = now
    else:
        begin = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = (now + timedelta(days=-args.days)).replace(hour=23, minute=59, second=59, microsecond=0)

    begin_ts = int(begin.timestamp() * 1000)
    end_ts = int(end.timestamp() * 1000)

    print(f"查询范围: {begin:%Y-%m-%d} ~ {end:%Y-%m-%d}\n")
    meetings = get_meetings(token, company_id, user_id, staff_id, begin_ts, end_ts)

    if args.json:
        print(json.dumps(meetings, ensure_ascii=False, indent=2))
    else:
        print_meetings(meetings)


def main():
    parser = argparse.ArgumentParser(description="MAXHUB Teams 会议记录查询")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # login
    p_login = sub.add_parser("login", help="登录并保存凭证")
    p_login.add_argument("username", help="手机号")
    p_login.add_argument("--password", help="密码（明文，登录后不保存）")
    p_login.add_argument("--company-id", help=f"x-company-id (默认: {DEFAULT_COMPANY_ID})")
    p_login.add_argument("--staff-id", help=f"x-staff-id (默认: {DEFAULT_STAFF_ID})")

    # meetings
    p_meet = sub.add_parser("meetings", help="查询会议记录")
    p_meet.add_argument("--start", help="开始日期 YYYY-MM-DD（与 --end 配合使用）")
    p_meet.add_argument("--end", help="结束日期 YYYY-MM-DD（与 --start 配合使用）")
    p_meet.add_argument("--days", type=int, default=7,
                        help="正数=过去N天，负数=未来N天 (默认: 7，--start/--end 优先)")
    p_meet.add_argument("--token", help="Bearer token (覆盖配置文件)")
    p_meet.add_argument("--company-id", dest="company_id", help="x-company-id")
    p_meet.add_argument("--user-id", dest="user_id", help="x-user-id")
    p_meet.add_argument("--staff-id", dest="staff_id", help="x-staff-id")
    p_meet.add_argument("--json", action="store_true", help="输出原始 JSON")

    args = parser.parse_args()
    if args.cmd == "login":
        cmd_login(args)
    elif args.cmd == "meetings":
        cmd_meetings(args)


if __name__ == "__main__":
    main()
