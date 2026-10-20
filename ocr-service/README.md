# 本地 PaddleOCR 服务

给 `courses_app` 用的通用 OCR 服务。它不访问数据库，也不保存文件：只接收图片或 PDF，返回识别文本。

服务本身不区分用户。用户身份、文件归属、配额、限流都由业务后端/网关负责，所以一套服务可以供所有用户共用。识别结果只用于前端校对，用户确认后才写入题干/选项/答案。

## 准备独立环境

参考环境为 Python 3.11、paddlepaddle 3.3.1、paddleocr 3.7.0、pymupdf 1.24.10；具体固定版本见 requirements.txt。安装命令需要手动执行，启动脚本不会安装依赖：

```powershell
Set-Location D:\GitCourcesWeb\courses_app\ocr-service
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 启动

```powershell
Set-Location D:\GitCourcesWeb\courses_app\ocr-service
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -CheckOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

启动脚本按项目 `.venv` → `py -3` → PATH Python 选择解释器，检查依赖后后台启动，并输出 PID 和日志路径。默认只监听本机，`-Lan` 才监听局域网。健康检查不触发识别；第一次真正识别时可能联网下载模型。缓存由 `app.py` 选择 ASCII 路径，默认 `%USERPROFILE%\.paddlex`，用户名含中文时退到系统盘 `paddlex-cache`。

主启动入口保持 AI=mock、OCR=http。OCR 缺失或失败只影响识别，网站仍可启动；已有后端需重启才能使用新环境配置。

自检：

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
curl.exe -F "file=@C:\path\sample.png" http://127.0.0.1:8001/ocr
```

返回：

```json
{
  "text": "1. 下列关于细胞呼吸的叙述…\nA. …\n答案：A",
  "lines": [{"text": "1. …", "confidence": 0.976, "box": [[40, 30], [520, 30], [520, 68], [40, 68]]}],
  "pages": 1,
  "confidence": 0.9869,
  "warnings": []
}
```

## 两个必须知道的 Windows 坑

1. **模型路径不能含中文。** Paddle 的 C++ 层打不开非 ASCII 路径，会把模型文件读成空内容，报 `json parse error: empty input`。项目在 `D:\捞捞\`，所以缓存必须放在 `%USERPROFILE%\.paddlex` 这类英文路径，不要指到项目目录里。
2. **这台机器上 oneDNN 会崩。** paddlepaddle 3.3.1 开 MKLDNN 时报 `ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]`。`app.py` 默认 `enable_mkldnn=False`；以后换了确认正常的 paddle 版本，可以用 `PADDLE_OCR_ENABLE_MKLDNN=1` 打开。

可用环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PADDLE_PDX_CACHE_HOME` | `%USERPROFILE%\.paddlex` | 模型缓存目录（必须英文路径） |
| `PADDLE_OCR_LANG` | `ch` | 模型语言 |
| `PADDLE_OCR_TEXTLINE_ORIENTATION` | 关 | 设 `1` 打开文字方向分类；个别截图会被它误判成 180° 翻转，导致整段乱码，所以默认关 |
| `PADDLE_OCR_ENABLE_MKLDNN` | 关 | 设 `1` 开启 oneDNN 加速 |
| `PADDLE_OCR_MIN_SCORE` | `0.5` | 低于该置信度的识别行直接丢弃，用来过滤截图里的杂色小块 |

## 接到 courses_app

后端通过 `back/.env` 读配置（已随项目创建，`npm run dev` / `npm start` 自动加载）：

```
OCR_PROVIDER=http
OCR_API_BASE=http://127.0.0.1:8001
```

所以只要 OCR 服务在跑，直接 `npm run dev --prefix back` 即可，不用再手设环境变量。

想临时切回 mock（不用模型、返回固定样例）：

```powershell
$env:OCR_PROVIDER = "mock"; npm run dev --prefix back
```

浏览器端识别优先使用 `fronted/vendor/ocr/` 的运行时资源；资源准备见 `docs/ocr-browser.md`。需要服务端回退时，前端调用业务后端的 `POST /api/ocr`，不直连 OCR 服务。OCR 默认只监听 `127.0.0.1`。

出错时后端会透传原因：服务没起是 `无法连接 OCR 服务（…请先运行 ocr-service/start.ps1）`，图里没有文字是 `没有识别到文字，请换一张更清晰的文件`。

## 多用户部署

```powershell
docker compose up -d --build
```

业务后端的 `OCR_API_BASE` 指向 OCR 容器/内网地址，例如 `http://ocr:8001`。

PaddleOCR 推理不是线程安全的，`app.py` 用锁把推理串行化，单进程吞吐有限。要提并发就多开容器（`--workers` 保持在 1），不要在一个进程里开线程。用户配额、鉴权、审计放在业务后端。

## 范围

- 支持 PNG/JPG/BMP/TIFF 图片与 PDF；单文件 20MB、PDF 20 页以内。
- PDF 有文本层时直接取文本（精确、快），扫描页才逐页 OCR。
- 目标是非手写的清晰打印/扫描件。手写体不做。
- 常见中文、英文、数字、标点稳定；简单数学符号可能出，复杂公式（分式、积分、矩阵）不保证，需要用户在校对面板里改。
- DOCX 的文本抽取不在本服务，应在业务后端另做。
