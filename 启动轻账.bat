@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

call :detect_python
if defined PYTHON_RUN goto check_desktop_components

echo 未检测到 Python 3.10 或更新版本。轻账桌面版需要 Python 才能运行。
where winget >nul 2>nul
if errorlevel 1 goto ask_official_installer

echo.
choice /C YN /N /M "是否通过 winget 为当前 Windows 用户自动安装 Python 3.14？[Y/N] "
if errorlevel 2 goto install_cancelled
echo.
echo 正在安装 Python...
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
echo 正在从 Python 官网下载并安装，请保持窗口打开...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0安装Python.ps1"
if errorlevel 1 goto startup_failed

:python_installed
rem Refresh this process PATH because newly installed user tools are not visible yet.
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%~fD\python.exe" set "PATH=%%~fD;%PATH%"
)
call :detect_python
if not defined PYTHON_RUN goto python_not_found_after_install

:check_desktop_components
set "NEED_PYWEBVIEW="
set "NEED_WEBVIEW2="
%PYTHON_RUN% -c "import webview" >nul 2>nul
if errorlevel 1 set "NEED_PYWEBVIEW=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0配置桌面环境.ps1" -CheckWebView2 >nul 2>nul
if errorlevel 1 set "NEED_WEBVIEW2=1"
if not defined NEED_PYWEBVIEW if not defined NEED_WEBVIEW2 goto launch_desktop

echo.
echo 首次运行需要配置桌面窗口组件。
if defined NEED_PYWEBVIEW echo - 将为当前 Python 用户安装 pywebview。
if defined NEED_WEBVIEW2 echo - 将安装 Microsoft WebView2 运行时。
choice /C YN /N /M "现在自动下载并配置这些组件吗？[Y/N] "
if errorlevel 2 goto install_cancelled

if defined NEED_PYWEBVIEW (
    echo.
    echo 正在安装桌面窗口组件...
    %PYTHON_RUN% -m pip install --user --disable-pip-version-check -r "%~dp0requirements-desktop.txt"
    if errorlevel 1 goto startup_failed
)
if defined NEED_WEBVIEW2 (
    echo.
    echo 正在安装 Microsoft WebView2 运行时...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0配置桌面环境.ps1" -InstallWebView2
    if errorlevel 1 goto startup_failed
)

%PYTHON_RUN% -c "import webview" >nul 2>nul
if errorlevel 1 goto setup_incomplete
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0配置桌面环境.ps1" -CheckWebView2 >nul 2>nul
if errorlevel 1 goto setup_incomplete

:launch_desktop
for /f "delims=" %%P in ('%PYTHON_RUN% -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_EXE=%%P"
if not defined PYTHON_EXE goto python_not_found_after_install
for %%P in ("%PYTHON_EXE%") do set "PYTHONW_EXE=%%~dpPpythonw.exe"
if not exist "%PYTHONW_EXE%" goto pythonw_not_found

start "" /b "%PYTHONW_EXE%" "%~dp0desktop_app.py"
exit /b 0

:detect_python
set "PYTHON_RUN="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if not errorlevel 1 (set "PYTHON_RUN=py -3"& exit /b 0)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if not errorlevel 1 (set "PYTHON_RUN=python"& exit /b 0)
exit /b 1

:install_cancelled
echo 已取消配置，轻账桌面窗口没有启动。
goto startup_failed

:python_not_found_after_install
echo Python 安装完成，但当前窗口仍未找到 Python 3.10+。请重新双击启动脚本。
goto startup_failed

:pythonw_not_found
echo 找到了 Python，但同一安装目录中没有 pythonw.exe，无法无控制台启动桌面窗口。
goto startup_failed

:setup_incomplete
echo 桌面组件安装未完成。请检查网络连接和上方错误信息，然后重新启动。

:startup_failed
echo.
echo 轻账桌面版启动失败。请查看上方提示；Python 可从 https://www.python.org/downloads/windows/ 获取。
pause
exit /b 1
