import base64
import json
import subprocess
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from http.server import SimpleHTTPRequestHandler

from .ai_chat import call_chat_model
from .ai_draft import call_draft_model
from .ai_feedback import call_feedback_model
from .ai_rewrite import call_model
from .latex_compile import compile_project_payload
from .pdf_store import get_pdf, pdf_range_response, pdf_token_from_path
from .project_io import (
    create_project_from_zip,
    export_project_zip,
    import_project_zip,
    import_document_file,
    save_project_file_payload,
)
from .utils import APP_VERSION, ApiError, ROOT, dumps_json


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json({"app": "papercraft", "version": APP_VERSION})
            return
        if self.serve_compiled_pdf():
            return
        super().do_GET()

    def do_HEAD(self):
        if self.serve_compiled_pdf(send_body=False):
            return
        super().do_HEAD()

    def do_POST(self):
        if self.path == "/api/project":
            self.import_project()
            return
        if self.path == "/api/import-document":
            self.import_document()
            return
        if self.path == "/api/create-project-from-zip":
            self.create_project_from_zip()
            return
        if self.path == "/api/save-project-file":
            self.save_project_file()
            return
        if self.path == "/api/export":
            self.export_project()
            return
        if self.path == "/api/compile":
            self.compile_project()
            return
        if self.path == "/api/feedback":
            self.feedback_project()
            return
        if self.path == "/api/draft":
            self.draft_project()
            return
        if self.path == "/api/chat":
            self.chat_project()
            return
        if self.path != "/api/rewrite":
            self.send_error(404)
            return
        self.rewrite_project()

    def read_json(self, max_size, empty_error=None):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > max_size:
            if empty_error:
                raise ApiError({"error": empty_error}, 400)
            raise ValueError("Invalid request size.")
        return json.loads(self.rfile.read(length))

    def read_body(self, max_size, empty_error):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > max_size:
            raise ApiError({"error": empty_error}, 400)
        return self.rfile.read(length)

    def rewrite_project(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            text = payload.get("text", "")
            if not isinstance(text, str) or not text.strip():
                self.send_json({"error": "Please select some text first."}, 400)
                return
            if len(text) > 12000:
                self.send_json({"error": "Selection is too long (maximum 12,000 characters)."}, 400)
                return
            custom_prompt = payload.get("custom_prompt", "")
            if not isinstance(custom_prompt, str) or len(custom_prompt) > 4000:
                self.send_json({"error": "Custom prompt must be text up to 4,000 characters."}, 400)
                return
            self.send_json(call_model(payload))
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, 502)
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Invalid JSON request."}, 400)

    def draft_project(self):
        try:
            payload = self.read_json(2 * 1024 * 1024, "中文草稿请求不能为空或超过 2 MB。")
            draft = payload.get("draft", "")
            if not isinstance(draft, str) or not draft.strip():
                self.send_json({"error": "请先输入中文草稿或写作意图。"}, 400)
                return
            if len(draft) > 8000:
                self.send_json({"error": "中文草稿过长，请控制在 8,000 字符以内。"}, 400)
                return
            content = payload.get("content", "")
            if not isinstance(content, str):
                payload["content"] = ""
            if len(payload.get("content", "")) > 250000:
                self.send_json({"error": "当前文件过长，请先拆分文件或减少上下文后再生成。"}, 400)
                return
            custom_prompt = payload.get("custom_prompt", "")
            if not isinstance(custom_prompt, str) or len(custom_prompt) > 4000:
                self.send_json({"error": "Custom prompt must be text up to 4,000 characters."}, 400)
                return
            self.send_json(call_draft_model(payload))
        except ApiError as exc:
            self.send_json(exc.payload, exc.status)
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, 502)
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Invalid JSON request."}, 400)

    def chat_project(self):
        try:
            payload = self.read_json(3 * 1024 * 1024, "项目对话请求不能为空或超过 3 MB。")
            messages = payload.get("messages", [])
            files = payload.get("files", [])
            if not isinstance(messages, list) or not messages:
                self.send_json({"error": "项目对话至少需要一条消息。"}, 400)
                return
            if not isinstance(files, list) or len(files) > 300:
                self.send_json({"error": "项目上下文文件数量无效。"}, 400)
                return
            for message in messages[-20:]:
                if not isinstance(message, dict) or message.get("role") not in {"user", "assistant"}:
                    self.send_json({"error": "对话消息格式无效。"}, 400)
                    return
                if len(str(message.get("content", ""))) > 12000:
                    self.send_json({"error": "单条对话消息过长。"}, 400)
                    return
            payload["messages"] = messages[-20:]
            self.send_json(call_chat_model(payload))
        except ApiError as exc:
            self.send_json(exc.payload, exc.status)
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, 502)
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Invalid JSON request."}, 400)

    def feedback_project(self):
        try:
            payload = self.read_json(2 * 1024 * 1024, "写作反馈请求不能为空或超过 2 MB。")
            content = payload.get("content", "")
            if not isinstance(content, str) or not content.strip():
                self.send_json({"error": "当前文件没有可分析的文本内容。"}, 400)
                return
            if len(content) > 250000:
                self.send_json({"error": "当前文件过长，请先选择较小片段或拆分文件后再分析。"}, 400)
                return
            selection = payload.get("selection", "")
            if not isinstance(selection, str):
                payload["selection"] = ""
            self.send_json(call_feedback_model(payload))
        except ApiError as exc:
            self.send_json(exc.payload, exc.status)
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, 502)
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Invalid JSON request."}, 400)

    def import_project(self):
        try:
            raw = self.read_body(50 * 1024 * 1024, "ZIP 文件不能为空或超过 50 MB。")
            self.send_json(import_project_zip(raw))
        except zipfile.BadZipFile:
            self.send_json({"error": "无法读取该 ZIP 文件。"}, 400)
        except ApiError as exc:
            self.send_json(exc.payload, exc.status)
        except (ValueError, OSError) as exc:
            self.send_json({"error": str(exc)}, 400)

    def create_project_from_zip(self):
        try:
            raw = self.read_body(50 * 1024 * 1024, "ZIP 文件不能为空或超过 50 MB。")
            zip_name = self.headers.get("X-Project-Name", "paper-project.zip")
            self.send_json(create_project_from_zip(raw, zip_name))
        except zipfile.BadZipFile:
            self.send_json({"error": "无法读取该 ZIP 文件。"}, 400)
        except ApiError as exc:
            self.send_json(exc.payload, exc.status)
        except (ValueError, OSError, RuntimeError) as exc:
            self.send_json({"error": f"无法创建项目文件夹：{exc}"}, 400)

    def import_document(self):
        try:
            raw = self.read_body(25 * 1024 * 1024, "文档文件不能为空或超过 25 MB。")
            filename = urllib.parse.unquote(self.headers.get("X-File-Name", "document.docx"))
            mime = self.headers.get("Content-Type", "")
            self.send_json(import_document_file(raw, filename, mime))
        except zipfile.BadZipFile:
            self.send_json({"error": "无法读取该 DOCX 文件。"}, 400)
        except (ValueError, OSError, ET.ParseError) as exc:
            self.send_json({"error": str(exc)}, 400)

    def save_project_file(self):
        try:
            payload = self.read_json(5 * 1024 * 1024, "保存请求不能为空或超过 5 MB。")
            self.send_json(save_project_file_payload(payload))
        except ApiError as exc:
            self.send_json(exc.payload, exc.status)
        except (ValueError, OSError, TypeError, json.JSONDecodeError) as exc:
            self.send_json({"error": f"无法保存到项目文件夹：{exc}"}, 400)

    def export_project(self):
        try:
            payload = self.read_json(150 * 1024 * 1024, "导出项目不能为空或请求超过 150 MB。")
            self.send_bytes(export_project_zip(payload), "application/zip")
        except ApiError as exc:
            self.send_json(exc.payload, exc.status)
        except (ValueError, TypeError, json.JSONDecodeError, base64.binascii.Error) as exc:
            self.send_json({"error": f"无法导出项目：{exc}"}, 400)

    def compile_project(self):
        try:
            payload = self.read_json(150 * 1024 * 1024, "编译项目不能为空或请求超过 150 MB。")
            self.send_json(compile_project_payload(payload))
        except ApiError as exc:
            self.send_json(exc.payload, exc.status)
        except subprocess.TimeoutExpired:
            self.send_json({"error": "LaTeX 编译超过 90 秒，已终止。", "code": "compile_timeout"}, 408)
        except (ValueError, TypeError, json.JSONDecodeError, base64.binascii.Error, OSError) as exc:
            self.send_json({"error": f"无法编译项目：{exc}"}, 400)

    def serve_compiled_pdf(self, send_body=True):
        token = pdf_token_from_path(self.path)
        if not token:
            return False
        item = get_pdf(token)
        if item is None:
            self.send_error(404, "Compiled PDF expired")
            return True
        data = item["data"]
        result = pdf_range_response(data, self.headers.get("Range", ""))
        if result["status"] == 416:
            self.send_response(416)
            self.send_header("Content-Range", result["content_range"])
            self.end_headers()
            return True
        body = result["body"]
        self.send_response(result["status"])
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", "inline")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        if result["status"] == 206:
            self.send_header("Content-Range", result["content_range"])
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send_body:
            self.wfile.write(body)
        return True

    def send_json(self, data, status=200):
        encoded = dumps_json(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def send_bytes(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")
