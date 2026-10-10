#!/usr/bin/env python3
"""Local web server and private SQLite account store for 轻账."""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from datetime import date
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PRIVATE_DIR = ROOT / ".qingzhang-data"
DEFAULT_DB = PRIVATE_DIR / "accounts.sqlite3"
SESSION_COOKIE = "qingzhang_session"
SESSION_SECONDS = 60 * 60 * 24 * 30
PBKDF2_ROUNDS = 310_000
MAX_BODY_BYTES = 16 * 1024 * 1024
MAX_RECORDS = 50_000
MAX_AVATAR_BYTES = 8 * 1024 * 1024
AVATAR_PRESETS = {"person", "leaf", "sun", "moon", "star", "flower", "heart", "music", "wave", "mountain"}
ASSET_KINDS = {"cash", "bank", "credit", "wallet", "investment", "brokerage", "property", "receivable", "other", "custom"}
DEBT_KINDS = {"personal", "mortgage", "auto", "consumer", "education", "business", "family", "other", "custom"}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def initialize_database(db_path: Path) -> None:
    with connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                created_at INTEGER NOT NULL,
                avatar TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS account_data (
                account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
                payload TEXT NOT NULL,
                revision INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
            """
        )
        account_columns = {row["name"] for row in conn.execute("PRAGMA table_info(accounts)")}
        if "avatar" not in account_columns:
            conn.execute("ALTER TABLE accounts ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(account_data)")}
        if "revision" not in columns and "updated_at" in columns:
            conn.execute("ALTER TABLE account_data RENAME COLUMN updated_at TO revision")
            conn.execute("UPDATE account_data SET revision=1")


def empty_state() -> dict:
    return {"version": 1, "categories": [], "transactions": [], "monthBudgets": {}, "dayBudgets": {}, "assets": [], "debts": [], "debtPayments": []}


def _text(obj: dict, key: str, limit: int, *, required: bool = True) -> str:
    value = obj.get(key, "")
    if not isinstance(value, str):
        raise ApiError(400, f"字段 {key} 格式不正确。")
    value = value.strip() if required else value
    if required and not value:
        raise ApiError(400, f"字段 {key} 不能为空。")
    if len(value) > limit:
        raise ApiError(400, f"字段 {key} 超出长度限制。")
    return value


def _safe_cents(value, *, positive: bool) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ApiError(400, "账目金额必须是整数分。")
    if value < (1 if positive else 0) or value > 9_000_000_000_000:
        raise ApiError(400, "账目金额超出有效范围。")
    return value


def _validated_avatar(value) -> str:
    if not isinstance(value, str) or len(value) > 12_000_000:
        raise ApiError(400, "头像数据格式不正确或文件过大。")
    if not value:
        return ""
    if value.startswith("preset:"):
        if value[7:] not in AVATAR_PRESETS:
            raise ApiError(400, "请选择有效的默认头像。")
        return value
    match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})", value)
    if not match:
        raise ApiError(400, "头像仅支持 PNG、JPG 或 WebP 图片。")
    mime, encoded = match.groups()
    try:
        image = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ApiError(400, "头像图片数据无效。") from None
    if not image or len(image) > MAX_AVATAR_BYTES:
        raise ApiError(400, "头像图片不能超过 8 MB。")
    signatures = {
        "png": image.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpeg": image.startswith(b"\xff\xd8\xff"),
        "webp": len(image) >= 12 and image.startswith(b"RIFF") and image[8:12] == b"WEBP",
    }
    if not signatures[mime]:
        raise ApiError(400, "图片内容与文件类型不匹配。")
    return value


def validate_state(value) -> dict:
    if not isinstance(value, dict):
        raise ApiError(400, "账本数据格式不正确。")
    categories = value.get("categories", [])
    transactions = value.get("transactions", [])
    month_budgets = value.get("monthBudgets", {})
    day_budgets = value.get("dayBudgets", {})
    if not isinstance(categories, list) or len(categories) > 500:
        raise ApiError(400, "分类数量超出限制。")
    if not isinstance(transactions, list) or len(transactions) > MAX_RECORDS:
        raise ApiError(400, "记录数量超出限制。")
    if not isinstance(month_budgets, dict) or len(month_budgets) > 2400:
        raise ApiError(400, "月度预算数据格式不正确。")
    if not isinstance(day_budgets, dict) or len(day_budgets) > 100_000:
        raise ApiError(400, "单日预算数据格式不正确。")

    clean_categories = []
    category_ids = set()
    category_types = {}
    for item in categories:
        if not isinstance(item, dict):
            raise ApiError(400, "分类数据格式不正确。")
        category = {
            "id": _text(item, "id", 100),
            "type": _text(item, "type", 16),
            "group": _text(item, "group", 48),
            "name": _text(item, "name", 48),
            "icon": _text(item, "icon", 24),
            "builtin": bool(item.get("builtin", False)),
        }
        if category["type"] not in ("expense", "income") or category["id"] in category_ids:
            raise ApiError(400, "分类类型无效或分类 ID 重复。")
        category_ids.add(category["id"])
        category_types[category["id"]] = category["type"]
        clean_categories.append(category)

    raw_assets = value.get("assets", [])
    if not isinstance(raw_assets, list) or len(raw_assets) > 5_000:
        raise ApiError(400, "资产账户数量超出限制。")
    clean_assets = []
    asset_ids = set()
    for item in raw_assets:
        if not isinstance(item, dict):
            raise ApiError(400, "资产账户数据格式不正确。")
        asset = {
            "id": _text(item, "id", 100),
            "kind": _text(item, "kind", 24),
            "category": _text(item, "category", 48),
            "name": _text(item, "name", 48),
            "detail": _text(item, "detail", 80, required=False),
            "icon": _text(item, "icon", 24),
            "tone": _text(item, "tone", 16),
            "balanceCents": _safe_cents(item.get("balanceCents"), positive=False),
            "createdAt": item.get("createdAt", 0),
            "updatedAt": item.get("updatedAt", 0),
        }
        if asset["kind"] not in ASSET_KINDS or asset["id"] in asset_ids:
            raise ApiError(400, "资产类别无效或账户 ID 重复。")
        for timestamp in (asset["createdAt"], asset["updatedAt"]):
            if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)):
                raise ApiError(400, "资产账户时间格式不正确。")
        asset_ids.add(asset["id"])
        clean_assets.append(asset)

    raw_debts = value.get("debts", [])
    if not isinstance(raw_debts, list) or len(raw_debts) > 5_000:
        raise ApiError(400, "债务数量超出限制。")
    clean_debts = []
    debt_ids = set()
    for item in raw_debts:
        if not isinstance(item, dict):
            raise ApiError(400, "债务数据格式不正确。")
        debt = {
            "id": _text(item, "id", 100),
            "kind": _text(item, "kind", 24),
            "category": _text(item, "category", 48),
            "name": _text(item, "name", 48),
            "detail": _text(item, "detail", 80, required=False),
            "icon": _text(item, "icon", 24),
            "tone": _text(item, "tone", 16),
            "totalCents": _safe_cents(item.get("totalCents"), positive=True),
            "remainingCents": _safe_cents(item.get("remainingCents"), positive=False),
            "periodic": item.get("periodic"),
            "firstDueDate": _text(item, "firstDueDate", 10),
            "nextDueDate": _text(item, "nextDueDate", 10),
            "frequency": item.get("frequency"),
            "unit": _text(item, "unit", 8),
            "installmentCents": _safe_cents(item.get("installmentCents"), positive=True),
            "expectedPayoffDate": item.get("expectedPayoffDate"),
            "createdAt": item.get("createdAt", 0),
            "updatedAt": item.get("updatedAt", 0),
        }
        if debt["kind"] not in DEBT_KINDS or debt["id"] in debt_ids:
            raise ApiError(400, "债务类别无效或债务 ID 重复。")
        if not isinstance(debt["periodic"], bool) or debt["remainingCents"] > debt["totalCents"]:
            raise ApiError(400, "债务金额或还款周期设置无效。")
        if not isinstance(debt["frequency"], int) or isinstance(debt["frequency"], bool) or not 1 <= debt["frequency"] <= 3650:
            raise ApiError(400, "还款周期频率无效。")
        if debt["unit"] not in {"day", "week", "month"} or (not debt["periodic"] and debt["installmentCents"] > debt["totalCents"]):
            raise ApiError(400, "还款周期单位或单次金额无效。")
        for key in ("firstDueDate", "nextDueDate"):
            try:
                if date.fromisoformat(debt[key]).isoformat() != debt[key]:
                    raise ValueError
            except ValueError:
                raise ApiError(400, "债务还款日期无效。") from None
        payoff = debt["expectedPayoffDate"]
        if payoff is not None:
            if not isinstance(payoff, str):
                raise ApiError(400, "预计还清日期格式不正确。")
            try:
                if date.fromisoformat(payoff).isoformat() != payoff:
                    raise ValueError
            except ValueError:
                raise ApiError(400, "预计还清日期无效。") from None
        for timestamp in (debt["createdAt"], debt["updatedAt"]):
            if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)):
                raise ApiError(400, "债务时间格式不正确。")
        debt_ids.add(debt["id"])
        clean_debts.append(debt)

    clean_transactions = []
    transaction_ids = set()
    for item in transactions:
        if not isinstance(item, dict):
            raise ApiError(400, "收支记录格式不正确。")
        tx = {
            "id": _text(item, "id", 100),
            "type": _text(item, "type", 16),
            "date": _text(item, "date", 10),
            "amountCents": _safe_cents(item.get("amountCents"), positive=True),
            "categoryId": _text(item, "categoryId", 100),
            "content": _text(item, "content", 160),
            "note": _text(item, "note", 320, required=False),
            "createdAt": item.get("createdAt", 0),
            "updatedAt": item.get("updatedAt", 0),
        }
        account_id = item.get("accountId", "")
        payment_id = item.get("debtPaymentId", "")
        if account_id:
            tx["accountId"] = _text(item, "accountId", 100)
            if tx["accountId"] not in asset_ids:
                raise ApiError(400, "收支记录关联的账户不存在。")
        if payment_id:
            tx["debtPaymentId"] = _text(item, "debtPaymentId", 100)
        if tx["type"] not in ("expense", "income") or tx["id"] in transaction_ids:
            raise ApiError(400, "收支类型无效或记录 ID 重复。")
        if category_types.get(tx["categoryId"]) != tx["type"]:
            raise ApiError(400, "收支记录引用的分类不存在或类型不匹配。")
        try:
            if date.fromisoformat(tx["date"]).isoformat() != tx["date"]:
                raise ValueError
        except ValueError:
            raise ApiError(400, "收支日期无效。") from None
        for timestamp in (tx["createdAt"], tx["updatedAt"]):
            if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)):
                raise ApiError(400, "记录时间格式不正确。")
        if item.get("voidedAt") is not None:
            if isinstance(item["voidedAt"], bool) or not isinstance(item["voidedAt"], (int, float)):
                raise ApiError(400, "记录撤销时间格式不正确。")
            tx["voidedAt"] = item["voidedAt"]
        transaction_ids.add(tx["id"])
        clean_transactions.append(tx)

    raw_payments = value.get("debtPayments", [])
    if not isinstance(raw_payments, list) or len(raw_payments) > MAX_RECORDS:
        raise ApiError(400, "还款记录数量超出限制。")
    clean_payments = []
    payment_ids = set()
    tx_by_id = {item["id"]: item for item in clean_transactions}
    for item in raw_payments:
        if not isinstance(item, dict):
            raise ApiError(400, "还款记录格式不正确。")
        payment = {
            "id": _text(item, "id", 100),
            "debtId": _text(item, "debtId", 100),
            "transactionId": _text(item, "transactionId", 100),
            "date": _text(item, "date", 10),
            "amountCents": _safe_cents(item.get("amountCents"), positive=True),
            "createdAt": item.get("createdAt", 0),
            "updatedAt": item.get("updatedAt", 0),
            "reversedAt": item.get("reversedAt"),
        }
        account_id = item.get("accountId", "")
        if account_id:
            payment["accountId"] = _text(item, "accountId", 100)
            if payment["accountId"] not in asset_ids:
                raise ApiError(400, "还款记录关联的账户不存在。")
        if payment["id"] in payment_ids or payment["debtId"] not in debt_ids:
            raise ApiError(400, "还款记录 ID 重复或引用的债务不存在。")
        tx = tx_by_id.get(payment["transactionId"])
        if not tx or tx.get("debtPaymentId") != payment["id"] or tx["type"] != "expense" or tx["amountCents"] != payment["amountCents"]:
            raise ApiError(400, "还款记录关联的支出记录无效。")
        try:
            if date.fromisoformat(payment["date"]).isoformat() != payment["date"]:
                raise ValueError
        except ValueError:
            raise ApiError(400, "还款日期无效。") from None
        for timestamp in (payment["createdAt"], payment["updatedAt"]):
            if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)):
                raise ApiError(400, "还款记录时间格式不正确。")
        if payment["reversedAt"] is not None and (isinstance(payment["reversedAt"], bool) or not isinstance(payment["reversedAt"], (int, float))):
            raise ApiError(400, "还款撤回时间格式不正确。")
        payment_ids.add(payment["id"])
        clean_payments.append(payment)

    clean_month_budgets = {}
    for key, amount in month_budgets.items():
        if not isinstance(key, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", key):
            raise ApiError(400, "月份预算日期无效。")
        clean_month_budgets[key] = _safe_cents(amount, positive=False)

    clean_day_budgets = {}
    for key, amount in day_budgets.items():
        if not isinstance(key, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", key):
            raise ApiError(400, "单日预算日期无效。")
        try:
            if date.fromisoformat(key).isoformat() != key:
                raise ValueError
        except ValueError:
            raise ApiError(400, "单日预算日期无效。") from None
        clean_day_budgets[key] = _safe_cents(amount, positive=False)

    return {
        "version": 1,
        "categories": clean_categories,
        "transactions": clean_transactions,
        "monthBudgets": clean_month_budgets,
        "dayBudgets": clean_day_budgets,
        "assets": clean_assets,
        "debts": clean_debts,
        "debtPayments": clean_payments,
    }


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "QingzhangLocal/1.0"

    def __init__(self, *args, db_path: Path, **kwargs):
        self.db_path = db_path
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        if not urlsplit(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def _json(self, status: int, value: dict, *, cookie: str | None = None):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "请求内容长度无效。") from None
        if length < 0 or length > MAX_BODY_BYTES:
            raise ApiError(413, "请求数据过大。")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "请求内容必须是有效 JSON。") from None
        if not isinstance(value, dict):
            raise ApiError(400, "请求内容格式不正确。")
        return value

    def _token_cookie(self, token: str) -> str:
        return f"{SESSION_COOKIE}={token}; Path=/; Max-Age={SESSION_SECONDS}; HttpOnly; SameSite=Strict"

    def _clear_cookie(self) -> str:
        return f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"

    def _session_account(self, conn: sqlite3.Connection):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        cookie = jar.get(SESSION_COOKIE)
        if not cookie or not cookie.value:
            return None
        token_hash = hashlib.sha256(cookie.value.encode("utf-8")).hexdigest()
        row = conn.execute(
            "SELECT a.id, a.username, a.avatar FROM sessions s JOIN accounts a ON a.id=s.account_id "
            "WHERE s.token_hash=? AND s.expires_at>?",
            (token_hash, int(time.time())),
        ).fetchone()
        return row

    def _require_account(self, conn: sqlite3.Connection):
        row = self._session_account(conn)
        if row is None:
            raise ApiError(401, "请先登录个人账户。")
        return row

    def _new_session(self, conn: sqlite3.Connection, account_id: int) -> str:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        conn.execute("DELETE FROM sessions WHERE expires_at<=?", (now,))
        conn.execute(
            "INSERT INTO sessions(token_hash,account_id,expires_at,created_at) VALUES(?,?,?,?)",
            (hashlib.sha256(token.encode("utf-8")).hexdigest(), account_id, now + SESSION_SECONDS, now),
        )
        return token

    def _account_payload(self, row) -> dict:
        return {"id": row["id"], "username": row["username"], "avatar": row["avatar"] or ""}

    def _api_get(self, path: str):
        with connect(self.db_path) as conn:
            if path == "/api/session":
                account = self._session_account(conn)
                return self._json(200, {"authenticated": bool(account), "user": self._account_payload(account) if account else None})
            if path == "/api/data":
                account = self._require_account(conn)
                row = conn.execute("SELECT payload,revision FROM account_data WHERE account_id=?", (account["id"],)).fetchone()
                data = json.loads(row["payload"]) if row else empty_state()
                return self._json(200, {"data": data, "revision": row["revision"] if row else 0})
        return self._json(404, {"error": "未找到接口。"})

    def _api_post(self, path: str):
        body = self._body()
        if path == "/api/profile":
            avatar = _validated_avatar(body.get("avatar", ""))
            with connect(self.db_path) as conn:
                account = self._require_account(conn)
                conn.execute("UPDATE accounts SET avatar=? WHERE id=?", (avatar, account["id"]))
                row = conn.execute("SELECT id,username,avatar FROM accounts WHERE id=?", (account["id"],)).fetchone()
            return self._json(200, {"user": self._account_payload(row)})

        if path == "/api/register":
            username = _text(body, "username", 64).casefold()
            allowed_punctuation = set("._@+-")
            if len(username) < 3 or not username[0].isalnum() or any(not (char.isalnum() or char in allowed_punctuation) for char in username):
                raise ApiError(400, "账户名须为 3 到 64 位中文、字母或数字，可包含 . _ @ + -。")
            password = body.get("password")
            if not isinstance(password, str) or len(password) < 8 or len(password) > 256:
                raise ApiError(400, "密码长度须为 8 到 256 个字符。")
            initial = validate_state(body.get("initialData", empty_state()))
            salt = secrets.token_bytes(16)
            password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
            now = int(time.time())
            try:
                with connect(self.db_path) as conn:
                    cursor = conn.execute(
                        "INSERT INTO accounts(username,salt,password_hash,created_at) VALUES(?,?,?,?)",
                        (username, salt, password_hash, now),
                    )
                    account_id = cursor.lastrowid
                    conn.execute(
                        "INSERT INTO account_data(account_id,payload,revision) VALUES(?,?,?)",
                        (account_id, json.dumps(initial, ensure_ascii=False, separators=(",", ":")), 1),
                    )
                    token = self._new_session(conn, account_id)
                    row = conn.execute("SELECT id,username,avatar FROM accounts WHERE id=?", (account_id,)).fetchone()
            except sqlite3.IntegrityError:
                raise ApiError(409, "这个账户名已注册，请直接登录。") from None
            return self._json(201, {"user": self._account_payload(row)}, cookie=self._token_cookie(token))

        if path == "/api/login":
            username = _text(body, "username", 64).casefold()
            password = body.get("password")
            if not isinstance(password, str) or len(password) > 256:
                raise ApiError(401, "账户名或密码不正确。")
            with connect(self.db_path) as conn:
                row = conn.execute("SELECT id,username,salt,password_hash,avatar FROM accounts WHERE username=?", (username,)).fetchone()
                valid = False
                if row:
                    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), row["salt"], PBKDF2_ROUNDS)
                    valid = hmac.compare_digest(candidate, row["password_hash"])
                if not valid:
                    raise ApiError(401, "账户名或密码不正确。")
                token = self._new_session(conn, row["id"])
            return self._json(200, {"user": self._account_payload(row)}, cookie=self._token_cookie(token))

        if path == "/api/logout":
            with connect(self.db_path) as conn:
                cookie = SimpleCookie()
                try:
                    cookie.load(self.headers.get("Cookie", ""))
                except Exception:
                    cookie = SimpleCookie()
                token = cookie.get(SESSION_COOKIE)
                if token:
                    token_hash = hashlib.sha256(token.value.encode("utf-8")).hexdigest()
                    conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
            return self._json(200, {"ok": True}, cookie=self._clear_cookie())

        return self._json(404, {"error": "未找到接口。"})

    def _api_put(self, path: str):
        if path != "/api/data":
            return self._json(404, {"error": "未找到接口。"})
        body = self._body()
        data = validate_state(body.get("data"))
        expected = body.get("expectedRevision")
        if expected is not None and (isinstance(expected, bool) or not isinstance(expected, int) or expected < 0):
            raise ApiError(400, "账本版本号无效。")
        with connect(self.db_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            account = self._require_account(conn)
            row = conn.execute("SELECT revision FROM account_data WHERE account_id=?", (account["id"],)).fetchone()
            current_revision = row["revision"] if row else 0
            if expected is not None and expected != current_revision:
                return self._json(409, {"error": "其他浏览器刚刚更新了账本，请稍候重试。", "revision": current_revision})
            next_revision = current_revision + 1
            conn.execute(
                "INSERT INTO account_data(account_id,payload,revision) VALUES(?,?,?) "
                "ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision",
                (account["id"], json.dumps(data, ensure_ascii=False, separators=(",", ":")), next_revision),
            )
        return self._json(200, {"ok": True, "revision": next_revision})

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            try:
                return self._api_get(path)
            except ApiError as exc:
                return self._json(exc.status, {"error": str(exc)})
            except (sqlite3.Error, OSError):
                return self._json(500, {"error": "账户数据服务暂时不可用。"})
        decoded = unquote(path).replace("\\", "/").lower()
        if ".qingzhang-data" in decoded.split("/"):
            return self._json(404, {"error": "未找到页面。"})
        return super().do_GET()

    def do_POST(self):
        try:
            return self._api_post(urlsplit(self.path).path)
        except ApiError as exc:
            return self._json(exc.status, {"error": str(exc)})
        except (sqlite3.Error, OSError):
            return self._json(500, {"error": "账户数据服务暂时不可用。"})

    def do_PUT(self):
        try:
            return self._api_put(urlsplit(self.path).path)
        except ApiError as exc:
            return self._json(exc.status, {"error": str(exc)})
        except (sqlite3.Error, OSError):
            return self._json(500, {"error": "账户数据服务暂时不可用。"})

    def do_DELETE(self):
        return self._json(405, {"error": "不支持此请求。"})

    def log_message(self, fmt: str, *args):
        # Keep access logs local and avoid printing request bodies or credentials.
        super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description="运行轻账本地服务")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认仅本机访问）")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB, help=argparse.SUPPRESS)
    args = parser.parse_args()
    db_path = args.db_path.resolve()
    initialize_database(db_path)
    handler = lambda *h_args, **h_kwargs: AppHandler(*h_args, db_path=db_path, **h_kwargs)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"轻账服务已启动：http://{args.host}:{args.port}")
    print("账户数据保存在当前电脑的 SQLite 文件中。按 Ctrl+C 停止服务。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("正在停止轻账服务…")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
