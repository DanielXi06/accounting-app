@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

call :detect_python
if defined PYTHON_RUN goto run_server

echo 未检测到 Python 3.10 或更新版本。轻账需要 Python 才能运行。
where winget >nul 2>nul
if errorlevel 1 goto ask_official_installer

echo.
choice /C YN /N /M "是否通过 winget 为当前 Windows 用户自动安装 Python 3.14？[Y/N] "
if errorlevel 2 goto install_cancelled
echo.
echo 正在安装 Python。请保持此窗口打开...
winget install --id Python.Python.3.14 --exact --scope user --accept-package-agreements --accept-source-agreements
if not errorlevel 1 goto python_installed

echo.
echo winget 安装未成功。
choice /C YN /N /M "是否改为从 Python 官网下载并自动安装？[Y/N] "
if errorlevel 2 goto startup_failed
goto install_from_python_org

:ask_official_installer
echo 未检测到 winget，将改用 Python 官网的 Windows 安装程序。
choice /C YN /N /M "是否自动下载并为当前用户安装 Python？[Y/N] "
if errorlevel 2 goto install_cancelled

:install_from_python_org
echo.
echo 正在从 Python 官网下载并安装，请保持此窗口打开...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0安装Python.ps1"
if errorlevel 1 goto startup_failed

:python_installed
rem Refresh this process PATH because newly installed user tools are not visible yet.
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%~fD\python.exe" set "PATH=%%~fD;%PATH%"
)
call :detect_python
if defined PYTHON_RUN goto run_server
echo Python 已安装，但当前窗口无法找到可用的 Python 3.10+。请重新双击启动脚本。
goto startup_failed

:run_server
echo.
echo 正在启动轻账，浏览器会自动打开...
%PYTHON_RUN% server.py --open-browser
if errorlevel 1 goto startup_failed
goto stopped

:detect_python
set "PYTHON_RUN="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if not errorlevel 1 (set "PYTHON_RUN=py -3"& exit /b 0)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if not errorlevel 1 (set "PYTHON_RUN=python"& exit /b 0)
exit /b 1

:install_cancelled
echo 已取消安装。安装 Python 3.10+ 后再次双击此文件即可启动。
goto startup_failed

:startup_failed
echo.
echo 轻账启动失败。请查看上方提示；如需手动获取安装程序，可访问 https://www.python.org/downloads/windows/ 。
pause
exit /b 1

:stopped
echo.
echo 轻账服务已停止。按任意键关闭此窗口。
pause >nul
exit /b 0
