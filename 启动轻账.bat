@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

call :detect_python
if defined PYTHON_RUN goto run_server

echo 未检测到 Python 3.10 或更新版本。轻账本地服务需要 Python 才能运行。
where winget >nul 2>nul
if errorlevel 1 goto ask_official_installer

echo.
set "ANSWER="
set /p "ANSWER=是否通过 winget 为当前 Windows 用户自动安装 Python 3.14？[Y/N] "
if /I not "%ANSWER%"=="Y" goto install_cancelled
echo.
echo 正在安装 Python...
winget install --id Python.Python.3.14 --exact --scope user --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto ask_official_installer
call :detect_python
if defined PYTHON_RUN goto run_server
goto winget_install_unverified

:winget_install_unverified
echo.
echo winget 已结束，但没有检测到可运行的 Python。
set "ANSWER="
set /p "ANSWER=是否改用 Python 官方安装程序自动安装？[Y/N] "
if /I not "%ANSWER%"=="Y" goto startup_failed
goto install_from_python_org

:ask_official_installer
echo 未检测到 winget，将改用 Python 官网的 Windows 安装程序。
set "ANSWER="
set /p "ANSWER=是否自动下载并为当前 Windows 用户安装 Python？[Y/N] "
if /I not "%ANSWER%"=="Y" goto install_cancelled

:install_from_python_org
echo.
echo 正在从 Python 官网下载并安装，请保持窗口打开...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0安装Python.ps1"
if errorlevel 1 goto startup_failed

:python_installed
call :detect_python
if not defined PYTHON_RUN goto python_not_found_after_install
goto run_server

:run_server
echo.
echo 正在启动轻账，浏览器会自动打开。请保持此窗口打开。
%PYTHON_RUN% server.py --open-browser
if errorlevel 1 goto startup_failed
goto stopped

:detect_python
set "PYTHON_RUN="
set "VENV_PYTHON=%~dp0.venv\Scripts\python.exe"
if exist "%VENV_PYTHON%" (
    "%VENV_PYTHON%" -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
    if not errorlevel 1 (set "PYTHON_RUN="%VENV_PYTHON%""& exit /b 0)
)
rem Search installed interpreters directly so this works without refreshing PATH.
if exist "%LOCALAPPDATA%\Programs\Python\" (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python*") do (
        if exist "%%~fD\python.exe" (
            "%%~fD\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
            if not errorlevel 1 (set "PYTHON_RUN="%%~fD\python.exe""& exit /b 0)
        )
    )
)
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if not errorlevel 1 (set "PYTHON_RUN=py -3"& exit /b 0)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if not errorlevel 1 (set "PYTHON_RUN=python"& exit /b 0)
exit /b 1

:install_cancelled
echo 已取消配置，轻账服务没有启动。
goto startup_failed

:python_not_found_after_install
echo 未找到可运行的 Python 3.10+。已检查应用虚拟环境、当前用户 Python 安装目录以及 py/python 命令。
goto startup_failed

:startup_failed
echo.
echo 轻账本地服务启动失败。请查看上方提示；Python 可从 https://www.python.org/downloads/windows/ 获取。
pause
exit /b 1

:stopped
echo.
echo 轻账服务已停止。按任意键关闭此窗口。
pause >nul
exit /b 0
