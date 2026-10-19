# 本地 PaddleOCR 服务

这个目录是给 `courses_app` 用的通用 OCR 服务。它不访问数据库，也不保存文件；只接收图片/PDF，返回识别文本。服务本身不区分用户，用户身份、文件归属、配额和审计由业务后端/网关注入和控制，因此同一套服务可以供所有用户使用。

## 环境

建议 Python 3.10 或 3.11，Windows CPU 也能跑。第一次启动 PaddleOCR 会下载中文模型，需要网络。

```powershell
cd D:\捞捞\courses_app\ocr-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -r requirements.txt
```

## 启动

```powershell
uvicorn app:app --host 127.0.0.1 --port 8001
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

启动 `back` 前设置：

```powershell
$env:OCR_PROVIDER = "http"
$env:OCR_API_BASE = "http://127.0.0.1:8001"
npm run dev --prefix back
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
