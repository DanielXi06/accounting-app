import http.cookiejar
import base64
import json
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

ROOT = Path(__file__).resolve().parent


def reserve_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(opener, url, method="GET", body=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with opener.open(req, timeout=5) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def start_server(port, db_path):
    return subprocess.Popen(
        [sys.executable, str(ROOT / "server.py"), "--host", "127.0.0.1", "--port", str(port), "--db-path", str(db_path)],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def wait_until_ready(base_url, process):
    for _ in range(80):
        if process.poll() is not None:
            details = process.stdout.read().decode("utf-8", errors="replace") if process.stdout else ""
            raise RuntimeError("server.py exited before becoming ready: " + details)
        try:
            return request(build_opener(), base_url + "/api/session")
        except (OSError, URLError):
            time.sleep(0.1)
    raise TimeoutError("server.py did not start")


def run():
    launcher = (ROOT / "启动轻账.bat").read_bytes()
    assert launcher.count(b"\n") == launcher.count(b"\r\n"), "Windows launcher must use CRLF line endings"
    db_path = ROOT / ".qingzhang-data" / f"verify-{uuid.uuid4().hex}.sqlite3"
    port = reserve_port()
    base_url = f"http://127.0.0.1:{port}"
    server = start_server(port, db_path)
    try:
        wait_until_ready(base_url, server)
        with urlopen(base_url + "/app.js", timeout=5) as asset_response:
            assert asset_response.headers.get("Cache-Control") == "no-cache, must-revalidate"
        browser_a = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        initial = {
            "version": 1,
            "categories": [{"id": "custom_food", "type": "expense", "group": "生活", "name": "午餐", "icon": "🍜", "builtin": False}],
            "transactions": [{"id": "tx_1", "type": "expense", "date": "2026-10-09", "amountCents": 1234, "categoryId": "custom_food", "content": "测试午餐", "note": "迁移", "createdAt": 1, "updatedAt": 1}],
            "monthBudgets": {"2026-10": 310000},
            "dayBudgets": {"2026-10-09": 15000},
        }
        status, registered = request(browser_a, base_url + "/api/register", "POST", {"username": "小明.账本", "password": "correct horse 7", "initialData": initial})
        assert status == 201 and registered["user"]["username"] == "小明.账本"
        assert registered["user"]["avatar"] == ""
        data_a = request(browser_a, base_url + "/api/data")[1]
        assert data_a["data"] == {**initial, "assets": [], "debts": [], "debtPayments": []} and data_a["revision"] == 1

        status, profile = request(browser_a, base_url + "/api/profile", "POST", {"avatar": "preset:sun"})
        assert status == 200 and profile["user"]["avatar"] == "preset:sun"

        browser_b = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        request(browser_b, base_url + "/api/login", "POST", {"username": "小明.账本", "password": "correct horse 7"})
        assert request(browser_b, base_url + "/api/session")[1]["user"]["avatar"] == "preset:sun"
        uploaded_avatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZcAAAAASUVORK5CYII="
        status, profile = request(browser_a, base_url + "/api/profile", "POST", {"avatar": uploaded_avatar})
        assert status == 200 and profile["user"]["avatar"] == uploaded_avatar
        try:
            request(browser_a, base_url + "/api/profile", "POST", {"avatar": "javascript:alert(1)"})
            raise AssertionError("unsafe avatar source should be rejected")
        except HTTPError as error:
            assert error.code == 400
        assert request(browser_b, base_url + "/api/session")[1]["user"]["avatar"] == uploaded_avatar
        large_image = b"\x89PNG\r\n\x1a\n" + b"x" * 1_100_000
        large_avatar = "data:image/png;base64," + base64.b64encode(large_image).decode("ascii")
        status, profile = request(browser_a, base_url + "/api/profile", "POST", {"avatar": large_avatar})
        assert status == 200 and profile["user"]["avatar"] == large_avatar, "uploads larger than 1 MB should be accepted"
        data_b = request(browser_b, base_url + "/api/data")[1]
        assert data_b["data"]["transactions"][0]["amountCents"] == 1234
        changed = {**initial, "transactions": [{**initial["transactions"][0], "amountCents": 2500}]}
        request(browser_a, base_url + "/api/data", "PUT", {"data": changed, "expectedRevision": data_a["revision"]})
        try:
            request(browser_b, base_url + "/api/data", "PUT", {"data": initial, "expectedRevision": data_b["revision"]})
            raise AssertionError("a stale browser write should be rejected")
        except HTTPError as error:
            assert error.code == 409
        assert request(browser_b, base_url + "/api/data")[1]["data"]["transactions"][0]["amountCents"] == 2500

        category = {"id": "seed_e_debt", "type": "expense", "group": "财务", "name": "债务还款", "icon": "💳", "builtin": True}
        financial_state = {
            **changed,
            "categories": [*initial["categories"], category],
            "assets": [{"id": "asset_bank", "kind": "bank", "category": "储蓄卡", "name": "工资卡", "detail": "尾号 1234", "icon": "🏦", "tone": "blue", "balanceCents": 97500, "createdAt": 1, "updatedAt": 2}],
            "debts": [{"id": "debt_home", "kind": "mortgage", "category": "房贷", "name": "住房贷款", "detail": "测试银行", "icon": "🏠", "tone": "blue", "totalCents": 10000, "remainingCents": 7500, "periodic": True, "firstDueDate": "2026-10-09", "nextDueDate": "2026-11-09", "frequency": 1, "unit": "month", "installmentCents": 2500, "expectedPayoffDate": "2027-01-09", "archived": True, "createdAt": 1, "updatedAt": 2}],
            "transactions": [*changed["transactions"], {"id": "tx_repayment", "type": "expense", "date": "2026-10-09", "amountCents": 2500, "categoryId": "seed_e_debt", "content": "偿还债务 · 住房贷款", "note": "债务还款", "accountId": "asset_bank", "debtPaymentId": "pay_home_1", "createdAt": 2, "updatedAt": 2}],
            "debtPayments": [{"id": "pay_home_1", "debtId": "debt_home", "transactionId": "tx_repayment", "date": "2026-10-09", "amountCents": 2500, "accountId": "asset_bank", "createdAt": 2, "updatedAt": 2, "reversedAt": None}],
        }
        current = request(browser_a, base_url + "/api/data")[1]
        request(browser_a, base_url + "/api/data", "PUT", {"data": financial_state, "expectedRevision": current["revision"]})
        persisted_finance = request(browser_b, base_url + "/api/data")[1]["data"]
        assert persisted_finance["assets"][0]["balanceCents"] == 97500
        assert persisted_finance["debts"][0]["nextDueDate"] == "2026-11-09"
        assert persisted_finance["debts"][0]["archived"] is True
        assert persisted_finance["debtPayments"][0]["amountCents"] == 2500

        try:
            request(build_opener(), base_url + "/api/data")
            raise AssertionError("unauthenticated account data should not be readable")
        except HTTPError as error:
            assert error.code == 401

        status, logged_out = request(browser_a, base_url + "/api/logout", "POST", {})
        assert status == 200 and logged_out["ok"]
        assert request(browser_a, base_url + "/api/session")[1]["authenticated"] is False

        server.terminate()
        server.wait(timeout=5)
        server = start_server(port, db_path)
        wait_until_ready(base_url, server)
        session = request(browser_b, base_url + "/api/session")[1]
        assert session["authenticated"] is True and session["user"]["avatar"] == large_avatar
        assert request(browser_b, base_url + "/api/data")[1]["data"]["transactions"][0]["amountCents"] == 2500

        try:
            request(browser_b, base_url + "/.qingzhang-data/accounts.sqlite3")
            raise AssertionError("private SQLite file should not be served as a static asset")
        except HTTPError as error:
            assert error.code == 404
        print("Account service checks passed: register/login, cross-browser ledger and avatar sync, avatar validation, logout, restart persistence, and private database protection.")
    finally:
        if server.poll() is None:
            server.terminate()
            server.wait(timeout=5)
        for suffix in ("", "-journal", "-shm", "-wal"):
            try:
                Path(str(db_path) + suffix).unlink(missing_ok=True)
            except OSError:
                pass


if __name__ == "__main__":
    run()
