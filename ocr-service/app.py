"""Minimal local PaddleOCR HTTP service for courses_app.

Run:
    uvicorn app:app --host 127.0.0.1 --port 8001

The local Node backend calls POST /ocr with multipart field "file" and then
lets the user review the text before saving it to the mistake.
"""
import io
import os
import threading

import fitz
import numpy as np
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image
from paddleocr import PaddleOCR
from starlette.concurrency import run_in_threadpool

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 20
PDF_TEXT_MIN_CHARS = 80

app = FastAPI(title="courses-app PaddleOCR")
ocr = PaddleOCR(use_angle_cls=True, lang=os.getenv("PADDLE_OCR_LANG", "ch"), show_log=False)
OCR_LOCK = threading.Lock()


def recognize_image(image):
    # PaddleOCR inference is CPU-heavy and its runtime is not guaranteed to be
    # thread-safe. One process serializes inference; scale horizontally with
    # multiple containers for multi-user traffic.
    with OCR_LOCK:
        result = ocr.ocr(np.asarray(image), cls=True)
    lines = []
    for page in result or []:
        for item in page or []:
            if not item:
                continue
            text, confidence = item[1][0], float(item[1][1])
            text = str(text or "").strip()
            if text:
                lines.append({"text": text, "confidence": round(confidence, 4)})
    return lines


def average_confidence(lines):
    values = [line["confidence"] for line in lines if line.get("confidence") is not None]
    return round(sum(values) / len(values), 4) if values else None


def recognize_pdf(data):
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.page_count > MAX_PAGES:
        raise HTTPException(413, f"PDF 最多支持 {MAX_PAGES} 页")
    text = "\n".join(page.get_text("text") for page in doc).strip()
    if len(text) >= PDF_TEXT_MIN_CHARS:
        lines = [
            {"text": line.strip(), "confidence": 1.0}
            for line in text.splitlines()
            if line.strip()
        ]
        return text, lines, doc.page_count, ["使用 PDF 文本层，未运行 OCR"]

    lines = []
    for page in doc:
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), colorspace=fitz.csRGB)
        image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        lines.extend(recognize_image(image))
    return "\n".join(line["text"] for line in lines), lines, doc.page_count, ["扫描页已使用 OCR"]


@app.get("/health")
def health():
    return {"status": "ok", "provider": "paddleocr"}


@app.post("/ocr")
async def recognize(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "文件不能超过 20MB")
    name = (file.filename or "").lower()
    if name.endswith(".pdf") or file.content_type == "application/pdf":
        text, lines, pages, warnings = await run_in_threadpool(recognize_pdf, data)
    else:
        try:
            image = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception as exc:
            raise HTTPException(415, "只支持图片或 PDF") from exc
        lines = await run_in_threadpool(recognize_image, image)
        text = "\n".join(line["text"] for line in lines)
        pages = 1
        warnings = []
    if not text.strip():
        raise HTTPException(422, "没有识别到文字，请换一张更清晰的文件")
    return {
        "text": text,
        "lines": lines,
        "pages": pages,
        "confidence": average_confidence(lines),
        "warnings": warnings,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
