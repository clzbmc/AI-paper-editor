import re
import secrets
import threading
import time


COMPILED_PDFS = {}
COMPILED_PDFS_LOCK = threading.Lock()
COMPILED_PDF_TTL_SECONDS = 30 * 60
COMPILED_PDF_MAX_ITEMS = 32


def remember_pdf(data):
    pdf_token = secrets.token_urlsafe(24)
    with COMPILED_PDFS_LOCK:
        now = time.time()
        COMPILED_PDFS[pdf_token] = {"data": data, "created_at": now}
        expired = [
            token for token, item in COMPILED_PDFS.items()
            if now - item.get("created_at", now) > COMPILED_PDF_TTL_SECONDS
        ]
        for token in expired:
            COMPILED_PDFS.pop(token, None)
        while len(COMPILED_PDFS) > COMPILED_PDF_MAX_ITEMS:
            oldest = min(COMPILED_PDFS, key=lambda token: COMPILED_PDFS[token].get("created_at", 0))
            COMPILED_PDFS.pop(oldest, None)
    return pdf_token


def get_pdf(token):
    with COMPILED_PDFS_LOCK:
        item = COMPILED_PDFS.get(token)
        if item and time.time() - item.get("created_at", 0) > COMPILED_PDF_TTL_SECONDS:
            COMPILED_PDFS.pop(token, None)
            item = None
    return item


def pdf_token_from_path(path):
    match = re.fullmatch(r"/api/pdf/([A-Za-z0-9_-]+)", path.split("?", 1)[0])
    return match.group(1) if match else ""


def pdf_range_response(data, range_header):
    start, end = 0, len(data) - 1
    status = 200
    range_match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header or "")
    if range_match:
        if range_match.group(1):
            start = int(range_match.group(1))
            end = min(int(range_match.group(2) or end), end)
        elif range_match.group(2):
            start = max(0, len(data) - int(range_match.group(2)))
        if start > end or start >= len(data):
            return {"status": 416, "body": b"", "content_range": f"bytes */{len(data)}"}
        status = 206
    body = data[start:end + 1]
    result = {"status": status, "body": body}
    if status == 206:
        result["content_range"] = f"bytes {start}-{end}/{len(data)}"
    return result

