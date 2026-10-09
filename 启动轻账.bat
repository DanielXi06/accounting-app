@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

where py >nul 2>nul
if not errorlevel 1 goto use_py
where python >nul 2>nul
if not errorlevel 1 goto use_python

echo 未检测到 Python。请先安装 Python 3.10 或更新版本，再重新启动轻账。
goto startup_failed

:use_py
py -3 server.py
if errorlevel 1 goto startup_failed
goto stopped

:use_python
python server.py
if errorlevel 1 goto startup_failed
goto stopped

:startup_failed
echo.
echo 轻账启动失败，请检查上方错误信息。确认端口 4173 未被占用，并已安装 Python 3.10 或更新版本。
pause
exit /b 1

:stopped
echo.
echo 轻账服务已停止。按任意键关闭此窗口。
pause >nul
exit /b 0
