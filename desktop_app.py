"""Windows desktop window for the existing local Qingzhang application."""
from __future__ import annotations

import ctypes
import os
import sys
import threading
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# pythonw.exe has no console streams. The HTTP handler and third-party GUI code
# may still write diagnostic output, so provide harmless sinks for those streams.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

import server


def show_error(message: str) -> None:
    try:
        ctypes.windll.user32.MessageBoxW(0, message, "轻账启动失败", 0x10)
    except Exception:
        pass


def run_desktop() -> None:
    import webview

    server.initialize_database(server.DEFAULT_DB)
    handler = lambda *args, **kwargs: server.AppHandler(
        *args, db_path=server.DEFAULT_DB, **kwargs
    )
    http_server = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    server_thread.start()

    local_app_data = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    webview_storage = local_app_data / "Qingzhang" / "webview"
    webview_storage.mkdir(parents=True, exist_ok=True)

    try:
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False
        webview.create_window(
            "轻账",
            f"http://127.0.0.1:{http_server.server_port}",
            width=1440,
            height=960,
            min_size=(980, 680),
        )
        webview.start(private_mode=False, storage_path=str(webview_storage))
    finally:
        if server_thread.is_alive():
            http_server.shutdown()
        http_server.server_close()
        server_thread.join(timeout=3)


def main() -> int:
    try:
        run_desktop()
        return 0
    except Exception as exc:
        details = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        show_error(
            "桌面窗口未能启动。\n\n"
            f"{details}\n\n"
            "请重新运行“启动轻账.bat”，并按提示配置所需组件。"
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
