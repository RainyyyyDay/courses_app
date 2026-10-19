"""Minimal local PaddleOCR HTTP service for courses_app.

Run:
    uvicorn app:app --host 127.0.0.1 --port 8001

The Node backend calls POST /ocr with multipart field "file" and returns the
text to the browser so the user can proofread it before anything is saved.

Environment:
    PADDLE_PDX_CACHE_HOME            model cache dir (default: %USERPROFILE%\.paddlex)
    PADDLE_OCR_LANG                  OCR language, default "ch"
    PADDLE_OCR_TEXTLINE_ORIENTATION  set "1" to turn the angle classifier back on
    PADDLE_OCR_DOC_ORIENTATION       set "1" for rotated/skewed photos
    PADDLE_OCR_UNWARP                set "1" for photo pages with page curvature
    PADDLE_OCR_DET_LIMIT_SIDE_LEN    cap the long side before detection (default: no cap override)
    PADDLE_OCR_ENABLE_MKLDNN         set "1" to turn oneDNN back on

Two Windows gotchas this file works around:
  * Paddle's C++ layer cannot open model files under a non-ASCII path (the
    project lives in D:\\捞捞\\...), so the model cache always resolves to an
    ASCII location instead of the project directory.
  * paddlepaddle 3.3.1 crashes while creating the CPU predictor with oneDNN on
    ("ConvertPirAttribute2RuntimeAttribute not support"), so oneDNN is off by
    default. Re-enable it once a fixed wheel is confirmed on the target machine.

This service is stateless and shared by every user of the app: the business
backend owns identity, per-user quota and file ownership. Keep the port bound
to localhost / the private network and never expose it to the public internet.
"""
from __future__ import annotations

import io
import os
import threading
from pathlib import Path


def _ascii_cache_dir() -> Path:
    explicit = os.getenv("PADDLE_PDX_CACHE_HOME")
    if explicit:
        return Path(explicit)
    default = Path.home() / ".paddlex"
    if str(default).isascii():
        return default
    drive = os.getenv("SystemDrive", "C:") + os.sep
    return Path(drive) / "paddlex-cache"


os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(_ascii_cache_dir()))

import fitz  # noqa: E402  (PyMuPDF, deliberately kept on 1.x)
import numpy as np  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from paddleocr import PaddleOCR  # noqa: E402
from PIL import Image  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 20
PDF_TEXT_MIN_CHARS = 80
MIN_SCORE = float(os.getenv("PADDLE_OCR_MIN_SCORE", "0.5"))

app = FastAPI(title="courses-app PaddleOCR")

_engine = None
_init_lock = threading.Lock()
_infer_lock = threading.Lock()


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def get_engine() -> PaddleOCR:
    """Load models once, on first recognition, so /health stays instant."""
    global _engine
    if _engine is not None:
        return _engine
    with _init_lock:
        if _engine is None:
            options = dict(
                lang=os.getenv("PADDLE_OCR_LANG", "ch"),
                use_doc_orientation_classify=_flag("PADDLE_OCR_DOC_ORIENTATION", False),
                use_doc_unwarping=_flag("PADDLE_OCR_UNWARP", False),
                # Off by default: the classifier wrongly flips upright lines by 180°
                # on some screenshots, which turns whole paragraphs into garbage.
                use_textline_orientation=_flag("PADDLE_OCR_TEXTLINE_ORIENTATION", False),
                enable_mkldnn=_flag("PADDLE_OCR_ENABLE_MKLDNN", False),
            )
            # Only override detection resolution when asked: the pipeline default
            # (no downscale, max side 4000) is what keeps small print readable.
            det_limit = _int_env("PADDLE_OCR_DET_LIMIT_SIDE_LEN", 0)
            if det_limit:
                options["text_det_limit_side_len"] = det_limit
                options["text_det_limit_type"] = "max"
            _engine = PaddleOCR(**options)
    return _engine


def _box_points(poly):
    try:
        return [[int(round(float(x))), int(round(float(y)))] for x, y in poly]
    except Exception:
        return None


def recognize_image(image):
    # PaddleOCR's runtime is CPU heavy and not guaranteed to be thread safe, so
    # inference is serialized. Scale out with several containers for many users.
    array = np.asarray(image.convert("RGB"))[:, :, ::-1].copy()  # RGB -> BGR
    with _infer_lock:
        results = get_engine().predict(array)

    lines = []
    for page in results or []:
        texts = page.get("rec_texts") or []
        scores = page.get("rec_scores") or []
        polys = page.get("rec_polys")
        for index, raw_text in enumerate(texts):
            text = str(raw_text or "").strip()
            if not text:
                continue
            score = None
            if index < len(scores):
                try:
                    score = round(float(scores[index]), 4)
                except (TypeError, ValueError):
                    score = None
            if score is not None and score < MIN_SCORE:
                continue
            box = None
            if polys is not None and index < len(polys):
                box = _box_points(polys[index])
            lines.append({"text": text, "confidence": score, "box": box})
    return lines


def average_confidence(lines):
    values = [line["confidence"] for line in lines if line.get("confidence") is not None]
    return round(sum(values) / len(values), 4) if values else None


def text_layer_usable(text: str) -> bool:
    """Some PDFs carry a broken text layer (missing ToUnicode) that decodes to
    control characters or private-use glyphs. OCR the page instead of trusting it."""
    if len(text) < PDF_TEXT_MIN_CHARS:
        return False
    sample = text[:4000]
    suspicious = 0
    for char in sample:
        code = ord(char)
        if char == "\ufffd" or 0xE000 <= code <= 0xF8FF or (code < 32 and char not in "\n\r\t"):
            suspicious += 1
    return suspicious / max(1, len(sample)) < 0.05


def recognize_pdf(data):
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        if doc.page_count > MAX_PAGES:
            raise HTTPException(413, f"PDF 最多支持 {MAX_PAGES} 页")

        # Born-digital PDFs already carry exact text: use it instead of OCR.
        text = "\n".join(page.get_text("text") for page in doc).strip()
        if text_layer_usable(text):
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
        warning = "PDF 文本层不可用，已改用 OCR" if text else "扫描页已使用 OCR"
        return "\n".join(line["text"] for line in lines), lines, doc.page_count, [warning]
    finally:
        doc.close()


@app.get("/health")
def health():
    return {"status": "ok", "provider": "paddleocr", "model_loaded": _engine is not None}


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
