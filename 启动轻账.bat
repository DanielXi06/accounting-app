@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 goto use_py
where python >nul 2>nul
if not errorlevel 1 goto use_python

echo 未检测到 Python。请先安装 Python 3.10 或更新版本，再重新启动轻账。
pause
exit /b 1

:use_py
py -3 server.py
goto stopped

:use_python
python server.py

:stopped
echo.
echo 轻账服务已停止。按任意键关闭此窗口。
pause >nul
