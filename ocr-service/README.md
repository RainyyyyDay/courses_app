# 本地 PaddleOCR 服务

这个目录是给 `courses_app` 用的通用 OCR 服务。它不访问数据库，也不保存文件；只接收图片/PDF，返回识别文本。服务本身不区分用户，用户身份、文件归属、配额和审计由业务后端/网关注入和控制，因此同一套服务可以供所有用户使用。

## Python 与依赖

建议使用独立的 Python 3.10/3.11 虚拟环境；在项目 OCR 目录准备 .venv，不依赖个人绝对路径。依赖安装须由使用者确认；下面的脚本只检查，不自动安装。当前分支的 app.py 在服务启动时初始化 PaddleOCR，首次启动可能下载模型；本轮不启动或下载。

启动脚本不再使用个人电脑路径，按本目录 `.venv\Scripts\python.exe` → `py -3` → PATH 的 `python` 选择 Python。所选 Python 缺依赖时明确退出，不自动安装、不改用 Mock。依赖版本见 requirements.txt；组员原环境为 Python 3.11.3，当前电脑仅检测到 Python 3.14.6，固定版本的兼容性尚未验证。

只读检查：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -CheckOnly`。检查模块元数据，不导入模型、下载模型或进行识别。需维护者确认后再准备独立虚拟环境及体积较大的 Paddle 依赖。

## 启动

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

另开一个终端自检：

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
curl.exe -F "file=@C:\path\sample.png" http://127.0.0.1:8001/ocr
```

返回结构：

```json
{
  "text": "1+1=?\nA. 1\nB. 2\n答案：B",
  "lines": [{"text": "1+1=?", "confidence": 0.99}],
  "pages": 1,
  "confidence": 0.99,
  "warnings": []
}
```

## 接到 courses_app

本项目一键入口 `启动课程网站.bat` 将 OCR 作为可选服务：网站和 AI Mock 可独立启动，浏览器打开后才尝试启动本机 OCR。OCR 未就绪时明确警告，仅识别功能不可用；以后单独启动 OCR 即可恢复，不需要重启通过新脚本启动的后端。它不读 `.env`，只在启动进程中设置：

```
OCR_PROVIDER=http
OCR_API_BASE=http://127.0.0.1:8001
```

AI 另设为 Mock；OCR 真实分支的 Provider 名称是 `http`，不是 real/service。服务返回的识别来源标记是 paddle。健康检查要求 status=ok 且 provider=paddleocr，不能用一个任意的占用端口冒充 OCR。独立启动脚本输出所选 Python、进程 PID、临时 stdout/stderr 日志路径；uvicorn 请求日志可核对 POST /ocr 是否到达，但不要分享识别正文或用户附件。

独立启动后端时也可显式设置（不读取或修改 .env）：

```powershell
$env:OCR_PROVIDER = "http"
$env:OCR_API_BASE = "http://127.0.0.1:8001"
$env:AI_PROVIDER = 'mock'
$env:AI_ENABLE_REAL = 'false'
Set-Location ..\back
node server.js
```

前端仍然只调本地后端的 `POST /api/ocr`；PaddleOCR 只监听 `127.0.0.1:8001`，不要直接暴露到公网。

如果是多人共用的部署，建议使用 Docker，并只在内部网络开放：

```powershell
docker compose up -d --build
```

业务后端的 `OCR_API_BASE` 指向 OCR 容器/内网地址，例如 `http://ocr:8001`。不要把 OCR 端口直接暴露给公网；用户登录、课程归属、单用户配额和限流放在业务后端/网关。PaddleOCR 进程内用锁串行推理，扩容时增加容器/进程，不要依赖单进程无限并发。

## 当前限制

- 图片或 PDF；DOCX 的文本抽取应在本地后端另做，不交给 OCR。
- 最多 20MB、20 页；可改 `app.py` 顶部常量。
- PDF 有文本层时优先取文本，扫描 PDF 才逐页 OCR。
- 中文模型 `ch`；数学公式、手写体、复杂表格需要另选模型或后处理。
- 当前只针对**非手写的清晰扫描/拍照/文本层 PDF**。普通中文模型可能识别常见的加减乘除、百分比和简单符号，但复杂数学公式不保证；公式识别是单独能力，不放进 OCR MVP。
- 识别结果只用于校对，不自动写入数据库；用户点击“替换题干 / 填入选项 / 填入答案”后才进入错题字段。
