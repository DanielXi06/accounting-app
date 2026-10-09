# GitHub 本地运行与发布指南

## 访问者：下载并在本机使用

无需注册 GitHub，也无需安装 Git：

1. 在 GitHub 项目页点击 **Code → Download ZIP**。
2. 解压压缩包，阅读仓库里的 [使用指南](使用指南.md)。
3. Windows 双击 `启动轻账.bat`；macOS / Linux 在终端运行 `python3 server.py`。
4. 浏览器打开 <http://127.0.0.1:4173>。

Windows 需预先安装 Python 3.10+。从 GitHub 下载的只是代码；访问者各自在本机保存自己的账本。要让多人使用同一本账，需要部署可访问的后端服务，单纯浏览 GitHub 仓库不会启动应用。

## 发布者：首次上传项目

如果本地项目目录尚未使用 Git 管理，可以先在 GitHub 创建一个仓库，然后在 Windows PowerShell 中运行下面的命令。创建时可选公开（任何人都能查看和下载）或私有（仅授权的人可访问）。请创建空仓库，不要勾选自动创建 README、.gitignore 或许可证，避免第一次推送发生冲突。

```powershell
cd "$HOME\Desktop\budget"
git init -b main
git add .
git status --short
```

检查 `git status` 的清单没有 `.qingzhang-data`、个人账目数据库或其他私密文件，再提交并连接仓库（把地址替换为 GitHub 创建仓库后显示的地址）：

```powershell
git commit -m "发布轻账本地版"
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

项目的 `.gitignore` 会排除 `.qingzhang-data/`、临时验证目录和压缩包。请保留并提交 `.gitignore`。后续修改可用 `git add .`、`git commit -m "说明本次修改"`、`git push` 更新仓库。

如果更喜欢图形界面，可以安装 GitHub Desktop，选择 **File → Add local repository**，选中项目目录，再发布到 GitHub。首次公开前检查仓库文件列表，确认没有私人数据库。

更多细节可查看 [GitHub 官方的本地项目上传说明](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)。

## 关于在线网址

GitHub 仓库可以分享源代码和下载包，但这个版本的账户 API 由 Python 服务提供，SQLite 也需要可靠的持久化磁盘。GitHub Pages 面向静态网站文件，不能单独承载当前的 Python 后端和数据库。以后要提供公共网址，需要将 Python 服务部署到支持后端进程和持久化存储的托管平台，并配置 HTTPS 域名；届时再为普通访问者提供网站入口。
