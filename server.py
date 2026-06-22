#!/usr/bin/env python3
import base64
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SYSTEM_PROMPT = """You are an expert academic LaTeX editor. Rewrite only the selected text.
Preserve every LaTeX command, environment, citation, reference, label, math expression,
and technical acronym exactly. Return JSON only, with string keys A, B, C, and reasons.
A is a conservative grammar correction, B is a stronger academic rewrite, and C is concise.
reasons must be an object with short one-sentence explanations for A, B, and C.
Use custom_instruction as the final style requirement for the requested mode. It overrides the
default style description, but cannot override LaTeX protection or the required JSON format.
Do not wrap the result in Markdown or add explanations."""
FEEDBACK_SYSTEM_PROMPT = """You are an academic writing feedback assistant for LaTeX papers.
Do not rewrite the document. Identify only the most useful non-intrusive feedback items.
Preserve the user's control: return suggestions, not edits. Do not ask questions.
Return JSON only with key feedback, an array of 3 to 5 objects.
Each object must have string fields type, severity, text, and suggestion.
All text and suggestion values must be written in Simplified Chinese.
Use severity as low, medium, or high. Keep every field concise."""
CHAT_SYSTEM_PROMPT = """You are PaperCraft's project-level LaTeX writing assistant.
Answer in Simplified Chinese. You can reason about the whole project context provided by the user.
Preserve LaTeX commands, math, citations, labels, BibTeX keys, file paths, and technical terms.
Do not claim that you changed files directly. The user must confirm every change.
Return JSON only with key reply and optional key changes.
reply is a concise Chinese response or plan.
changes is an optional array of exact text replacements with string fields path, find, replace, and reason.
Only return changes when the user explicitly asks to modify, rewrite, revise, apply, or edit project files.
Every change must target a text file and must use an exact find string from that file."""
CONFIG_PATH = Path(os.getenv("MODEL_CONFIG_PATH", ROOT / "model_config.json"))
LATEX_SEARCH_DIRS = [
    ROOT / "tools",
    Path("/Library/TeX/texbin"),
    Path("/opt/homebrew/bin"),
    Path("/usr/local/bin"),
]
APP_VERSION = "0.7.6"
COMPILED_PDFS = {}
COMPILED_PDFS_LOCK = threading.Lock()
COMPILED_PDF_TTL_SECONDS = 30 * 60
COMPILED_PDF_MAX_ITEMS = 32


def demo_rewrites(text):
    """Useful offline placeholders that keep LaTeX intact until an AI API is configured."""
    stripped = text.strip()
    a = re.sub(r"\bvery important\b", "important", stripped, flags=re.I)
    a = re.sub(r"\bin order to\b", "to", a, flags=re.I)
    a = re.sub(r"\s+([,.;:])", r"\1", a)
    b = re.sub(r"\bWe (show|find) that\b", "Our results demonstrate that", a, flags=re.I)
    b = re.sub(r"\bA lot of\b", "Numerous", b, flags=re.I)
    c = re.sub(r"\bIt is (important|noteworthy) to note that\s*", "", a, flags=re.I)
    c = re.sub(r"\bDue to the fact that\b", "Because", c, flags=re.I)
    return {
        "A": a or stripped,
        "B": b or stripped,
        "C": c or stripped,
        "reasons": {
            "A": "修正基础语法和冗余表达，同时尽量保留原句结构。",
            "B": "提升学术语气和表达严谨性，不添加原文之外的新事实。",
            "C": "压缩重复和空泛措辞，让核心信息更直接。",
        },
        "demo": True,
    }


def demo_feedback(text):
    """Offline feedback that demonstrates the suggestion layer without changing text."""
    normalized = " ".join(text.split())
    items = []
    if re.search(r"\b(very important|a lot of|useful information)\b", normalized, flags=re.I):
        items.append({
            "type": "clarity",
            "severity": "medium",
            "text": "部分表达偏笼统，例如 very important、a lot of 或 useful information。",
            "suggestion": "用更具体的学术名词说明重要性、数量或贡献。",
        })
    if len(re.findall(r"[.;]", text)) < 2 and len(normalized) > 500:
        items.append({
            "type": "structure",
            "severity": "medium",
            "text": "当前片段较长但句法停顿较少，读者可能难以跟随论证。",
            "suggestion": "考虑拆分长句，并让每句只承担一个主要论点。",
        })
    if re.search(r"\b(However|Therefore|Moreover|In addition)\b", normalized) is None and len(normalized) > 400:
        items.append({
            "type": "flow",
            "severity": "low",
            "text": "片段中缺少显式过渡词，段落之间的逻辑关系可能不够清楚。",
            "suggestion": "在转折、递进或因果位置加入简短过渡表达。",
        })
    if "\\cite{" not in text and len(normalized) > 600:
        items.append({
            "type": "evidence",
            "severity": "low",
            "text": "较长论述中没有明显引用，部分背景或方法判断可能缺少支撑。",
            "suggestion": "检查是否需要为关键背景、方法或对比结论补充引用。",
        })
    items.append({
        "type": "latex-safety",
        "severity": "low",
        "text": "反馈层只提示写作问题，不会自动改写 LaTeX 源码。",
        "suggestion": "根据需要手动选择后续润色或保持原文。",
    })
    return {"feedback": items[:5], "demo": True}


def demo_chat(payload):
    message = ""
    for item in reversed(payload.get("messages", [])):
        if item.get("role") == "user":
            message = str(item.get("content", ""))
            break
    wants_change = re.search(r"(修改|改写|重写|应用|替换|edit|rewrite|revise|apply)", message, flags=re.I)
    response = {
        "reply": "我已读取项目上下文。可以先帮你梳理论文结构、检查表达问题，或在你明确要求时生成需确认后应用的跨文件修改建议。",
        "demo": True,
    }
    files = [item for item in payload.get("files", []) if item.get("kind") == "text" and item.get("content")]
    if wants_change and files:
        sample = files[0]
        content = str(sample.get("content", ""))
        find = content[: min(120, len(content))].strip()
        if find:
            response["reply"] = "这是离线演示模式。我生成了一条示例修改建议，应用前仍需要你确认。"
            response["changes"] = [{
                "path": str(sample.get("path", "")),
                "find": find,
                "replace": find,
                "reason": "离线演示建议，不改变实际文本内容。",
            }]
    return response


def find_latex_engine():
    configured = os.getenv("LATEX_ENGINE", "").strip()
    if configured:
        path = Path(configured).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    for name in ("latexmk", "xelatex", "pdflatex"):
        discovered = shutil.which(name)
        if discovered:
            return discovered
        for directory in LATEX_SEARCH_DIRS:
            candidate = directory / name
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return ""


def find_tex_command(name, engine=""):
    if engine:
        candidate = Path(engine).parent / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    discovered = shutil.which(name)
    if discovered:
        return discovered
    for directory in LATEX_SEARCH_DIRS:
        candidate = directory / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return ""


def load_model_config():
    if not CONFIG_PATH.exists():
        return None, None, {"timeout_seconds": 60, "temperature": 0.35, "max_tokens": 4000}
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        active = config.get("active_provider", "")
        provider = config.get("providers", {}).get(active)
        if not active or not isinstance(provider, dict):
            raise RuntimeError(f"模型配置中的 active_provider 无效：{active or '未设置'}")
        provider = dict(provider)
        api_key = str(provider.get("api_key", "")).strip()
        if api_key.startswith("env:"):
            api_key = os.getenv(api_key[4:].strip(), "")
        provider["api_key"] = api_key
        return active, provider, config.get("request", {})
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"无法读取模型配置 {CONFIG_PATH.name}：{exc}") from exc


def build_user_prompt(payload):
    return json.dumps({
        "selected_text": payload["text"],
        "context_before": payload.get("context_before", ""),
        "context_after": payload.get("context_after", ""),
        "requested_mode": payload.get("mode", "all"),
        "custom_instruction": payload.get("custom_prompt", ""),
    }, ensure_ascii=False)


def endpoint(base_url, suffix):
    base_url = str(base_url).rstrip("/")
    return base_url if base_url.endswith(suffix) else f"{base_url}/{suffix}"


def send_model_request(url, body, headers, timeout):
    curl = shutil.which("curl")
    if curl:
        return send_model_request_with_curl(curl, url, body, headers, timeout)

    request = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read(1200).decode("utf-8", errors="replace")
        raise RuntimeError(f"模型接口返回 HTTP {exc.code}：{detail}") from exc
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"模型请求失败：{exc}") from exc


def send_model_request_with_curl(curl, url, body, headers, timeout):
    encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
    descriptor, header_path = tempfile.mkstemp(prefix="papercraft-model-headers-", text=True)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as header_file:
            for name, value in {"Content-Type": "application/json", **headers}.items():
                header_file.write(f"{name}: {value}\n")
        completed = subprocess.run(
            [
                curl,
                "--silent",
                "--show-error",
                "--max-time",
                str(timeout),
                "--header",
                f"@{header_path}",
                "--data-binary",
                "@-",
                "--write-out",
                "\n__PAPERCRAFT_HTTP_STATUS__:%{http_code}",
                url,
            ],
            input=encoded,
            capture_output=True,
            timeout=timeout + 5,
        )
        output = completed.stdout.decode("utf-8", errors="replace")
        body_text, marker, status_text = output.rpartition("\n__PAPERCRAFT_HTTP_STATUS__:")
        if completed.returncode != 0:
            error = completed.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"模型请求失败（curl {completed.returncode}）：{error}")
        if not marker or not status_text.isdigit():
            raise RuntimeError("模型接口未返回有效的 HTTP 状态码")
        status = int(status_text)
        if status >= 400:
            raise RuntimeError(f"模型接口返回 HTTP {status}：{body_text[:1200]}")
        return json.loads(body_text)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"模型请求超时（{timeout} 秒）") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"模型接口返回了无效 JSON：{exc}") from exc
    finally:
        try:
            os.unlink(header_path)
        except FileNotFoundError:
            pass


def call_openai_compatible(provider, user_prompt, settings, system_prompt=SYSTEM_PROMPT):
    body = {
        "model": provider["model"],
        "temperature": settings["temperature"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if provider.get("json_mode", True):
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {provider['api_key']}"}
    headers.update(provider.get("extra_headers", {}))
    result = send_model_request(endpoint(provider["base_url"], "chat/completions"), body, headers, settings["timeout_seconds"])
    return result["choices"][0]["message"]["content"]


def call_anthropic(provider, user_prompt, settings, system_prompt=SYSTEM_PROMPT):
    body = {
        "model": provider["model"],
        "max_tokens": settings["max_tokens"],
        "temperature": settings["temperature"],
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    headers = {
        "x-api-key": provider["api_key"],
        "anthropic-version": provider.get("anthropic_version", "2023-06-01"),
    }
    result = send_model_request(endpoint(provider["base_url"], "messages"), body, headers, settings["timeout_seconds"])
    return "".join(item.get("text", "") for item in result["content"] if item.get("type") == "text")


def call_gemini(provider, user_prompt, settings, system_prompt=SYSTEM_PROMPT):
    url = endpoint(provider["base_url"], f"models/{provider['model']}:generateContent")
    body = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": settings["temperature"],
            "maxOutputTokens": settings["max_tokens"],
            "responseMimeType": "application/json",
        },
    }
    result = send_model_request(url, body, {"x-goog-api-key": provider["api_key"]}, settings["timeout_seconds"])
    return "".join(part.get("text", "") for part in result["candidates"][0]["content"]["parts"])


def parse_model_content(content):
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.I)
    parsed = json.loads(content)
    reasons = parsed.get("reasons", {})
    if not isinstance(reasons, dict):
        reasons = {}
    return {
        "A": str(parsed["A"]),
        "B": str(parsed["B"]),
        "C": str(parsed["C"]),
        "reasons": {key: str(reasons.get(key, "")) for key in ("A", "B", "C") if reasons.get(key)},
    }


def parse_feedback_content(content):
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.I)
    parsed = json.loads(content)
    raw_items = parsed.get("feedback", parsed if isinstance(parsed, list) else [])
    if not isinstance(raw_items, list):
        raise ValueError("feedback must be an array")
    items = []
    for item in raw_items[:5]:
        if not isinstance(item, dict):
            continue
        items.append({
            "type": str(item.get("type", "writing")),
            "severity": str(item.get("severity", "low")),
            "text": str(item.get("text", ""))[:600],
            "suggestion": str(item.get("suggestion", ""))[:800],
        })
    if not items:
        raise ValueError("feedback is empty")
    return {"feedback": items}


def parse_chat_content(content):
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.I)
    parsed = json.loads(content)
    changes = []
    for item in parsed.get("changes", []) if isinstance(parsed.get("changes", []), list) else []:
        if not isinstance(item, dict):
            continue
        changes.append({
            "path": str(item.get("path", "")),
            "find": str(item.get("find", "")),
            "replace": str(item.get("replace", "")),
            "reason": str(item.get("reason", "")),
        })
    result = {"reply": str(parsed.get("reply", ""))}
    if changes:
        result["changes"] = changes[:20]
    if not result["reply"] and not changes:
        raise ValueError("chat response is empty")
    return result


def model_settings(request_config):
    return {
        "timeout_seconds": int(request_config.get("timeout_seconds", 60)),
        "temperature": float(request_config.get("temperature", 0.35)),
        "max_tokens": int(request_config.get("max_tokens", 4000)),
    }


def configured_model_or_demo():
    active, provider, request_config = load_model_config()
    if provider is None:
        api_key = os.getenv("AI_API_KEY", "")
        if not api_key:
            return active, None, request_config
        provider = {
            "type": "openai_compatible",
            "api_key": api_key,
            "base_url": os.getenv("AI_API_URL", "https://api.openai.com/v1/chat/completions"),
            "model": os.getenv("AI_MODEL", "gpt-4o-mini"),
            "json_mode": True,
        }
        active = "environment"
    if not provider.get("api_key"):
        return active, None, request_config
    required = [key for key in ("type", "base_url", "model") if not provider.get(key)]
    if required:
        raise RuntimeError(f"模型配置缺少字段：{', '.join(required)}")
    return active, provider, request_config


def call_model(payload):
    active, provider, request_config = configured_model_or_demo()
    if provider is None:
        result = demo_rewrites(payload["text"])
        if active:
            result["provider"] = active
        return result
    settings = model_settings(request_config)
    user_prompt = build_user_prompt(payload)
    adapters = {
        "openai_compatible": call_openai_compatible,
        "anthropic": call_anthropic,
        "gemini": call_gemini,
    }
    adapter = adapters.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_model_content(adapter(provider, user_prompt, settings, SYSTEM_PROMPT))
        return {**parsed, "demo": False, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"模型返回格式无效：{exc}") from exc


def feedback_excerpt(content, selection_start=0, selection_end=0, limit=16000):
    if len(content) <= limit:
        return content
    try:
        start = int(selection_start)
        end = int(selection_end)
    except (TypeError, ValueError):
        start = end = 0
    center = max(0, min(len(content), (start + end) // 2 if end >= start else start))
    half = limit // 2
    left = max(0, center - half)
    right = min(len(content), left + limit)
    left = max(0, right - limit)
    return content[left:right]


def build_feedback_prompt(payload):
    content = payload.get("content", "")
    excerpt = feedback_excerpt(content, payload.get("selection_start", 0), payload.get("selection_end", 0))
    return json.dumps({
        "file_path": payload.get("path", ""),
        "content_excerpt": excerpt,
        "selection": payload.get("selection", ""),
        "task": "Return 3 to 5 concise academic writing feedback items in Simplified Chinese. Do not rewrite the document.",
    }, ensure_ascii=False)


def build_chat_prompt(payload):
    return json.dumps({
        "messages": payload.get("messages", []),
        "current_path": payload.get("current_path", ""),
        "files": payload.get("files", []),
        "resource_manifest": payload.get("resource_manifest", []),
        "context_truncated": bool(payload.get("context_truncated")),
        "task": "Answer in Chinese. Suggest exact changes only when explicitly requested. Never apply changes directly.",
    }, ensure_ascii=False)


def call_feedback_model(payload):
    content = payload.get("content", "")
    active, provider, request_config = configured_model_or_demo()
    if provider is None:
        result = demo_feedback(content)
        if active:
            result["provider"] = active
        return result
    settings = model_settings(request_config)
    settings["max_tokens"] = min(settings["max_tokens"], 1800)
    user_prompt = build_feedback_prompt(payload)
    adapters = {
        "openai_compatible": call_openai_compatible,
        "anthropic": call_anthropic,
        "gemini": call_gemini,
    }
    adapter = adapters.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_feedback_content(adapter(provider, user_prompt, settings, FEEDBACK_SYSTEM_PROMPT))
        return {**parsed, "demo": False, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"写作反馈返回格式无效：{exc}") from exc


def call_chat_model(payload):
    active, provider, request_config = configured_model_or_demo()
    if provider is None:
        result = demo_chat(payload)
        if active:
            result["provider"] = active
        return result
    settings = model_settings(request_config)
    settings["max_tokens"] = min(settings["max_tokens"], 3000)
    user_prompt = build_chat_prompt(payload)
    adapters = {
        "openai_compatible": call_openai_compatible,
        "anthropic": call_anthropic,
        "gemini": call_gemini,
    }
    adapter = adapters.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_chat_content(adapter(provider, user_prompt, settings, CHAT_SYSTEM_PROMPT))
        return {**parsed, "demo": False, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"项目对话返回格式无效：{exc}") from exc


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
        if self.path == "/api/export":
            self.export_project()
            return
        if self.path == "/api/compile":
            self.compile_project()
            return
        if self.path == "/api/feedback":
            self.feedback_project()
            return
        if self.path == "/api/chat":
            self.chat_project()
            return
        if self.path != "/api/rewrite":
            self.send_error(404)
            return
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

    def chat_project(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 3 * 1024 * 1024:
                self.send_json({"error": "项目对话请求不能为空或超过 3 MB。"}, 400)
                return
            payload = json.loads(self.rfile.read(length))
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
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, 502)
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Invalid JSON request."}, 400)

    def feedback_project(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 2 * 1024 * 1024:
                self.send_json({"error": "写作反馈请求不能为空或超过 2 MB。"}, 400)
                return
            payload = json.loads(self.rfile.read(length))
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
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, 502)
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Invalid JSON request."}, 400)

    def import_project(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 50 * 1024 * 1024:
            self.send_json({"error": "ZIP 文件不能为空或超过 50 MB。"}, 400)
            return
        try:
            archive = zipfile.ZipFile(io.BytesIO(self.rfile.read(length)))
            entries = [item for item in archive.infolist() if not item.is_dir() and not item.filename.startswith("__MACOSX/")]
            if len(entries) > 500 or sum(item.file_size for item in entries) > 100 * 1024 * 1024:
                self.send_json({"error": "项目超过 500 个文件或解压后超过 100 MB。"}, 400)
                return
            files = []
            text_extensions = {".tex", ".bib", ".sty", ".cls", ".bst", ".rtx", ".txt", ".md"}
            for item in entries:
                path = item.filename.replace("\\", "/").lstrip("/")
                raw = archive.read(item)
                suffix = Path(path).suffix.lower()
                mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
                if suffix in text_extensions:
                    files.append({"path": path, "kind": "text", "mime": mime, "content": raw.decode("utf-8", errors="replace")})
                elif suffix in {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}:
                    files.append({"path": path, "kind": "asset", "mime": mime, "content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"})
                else:
                    files.append({"path": path, "kind": "other", "mime": mime, "content": base64.b64encode(raw).decode("ascii"), "encoding": "base64", "size": len(raw)})
            self.send_json({"files": files})
        except (zipfile.BadZipFile, OSError):
            self.send_json({"error": "无法读取该 ZIP 文件。"}, 400)

    def export_project(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 150 * 1024 * 1024:
            self.send_json({"error": "导出项目不能为空或请求超过 150 MB。"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length))
            files = self.decode_project_files(payload)
            archive_buffer = io.BytesIO()
            with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for path, raw in files:
                    archive.writestr(path, raw)
            self.send_bytes(archive_buffer.getvalue(), "application/zip")
        except (ValueError, TypeError, json.JSONDecodeError, base64.binascii.Error) as exc:
            self.send_json({"error": f"无法导出项目：{exc}"}, 400)

    def decode_project_files(self, payload):
        files = payload.get("files", [])
        if not isinstance(files, list) or not files or len(files) > 500:
            raise ValueError("项目必须包含 1 至 500 个文件。")
        decoded = []
        total_size = 0
        for file in files:
            path = str(file.get("path", "")).replace("\\", "/").lstrip("/")
            parts = Path(path).parts
            if not path or ".." in parts:
                raise ValueError("项目中包含无效路径。")
            if file.get("encoding") == "base64":
                raw = base64.b64decode(file.get("content", ""), validate=True)
            else:
                raw = str(file.get("content", "")).encode("utf-8")
            total_size += len(raw)
            if total_size > 100 * 1024 * 1024:
                raise ValueError("项目超过 100 MB。")
            decoded.append((path, raw))
        return decoded

    def compile_project(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 150 * 1024 * 1024:
            self.send_json({"error": "编译项目不能为空或请求超过 150 MB。"}, 400)
            return
        engine = find_latex_engine()
        if not engine:
            self.send_json({
                "error": "未检测到 LaTeX 工具链。请安装 MacTeX 或 BasicTeX 后重试。",
                "code": "toolchain_missing",
                "searched": [str(path) for path in LATEX_SEARCH_DIRS],
            }, 503)
            return
        try:
            payload = json.loads(self.rfile.read(length))
            files = self.decode_project_files(payload)
            main_path = str(payload.get("main", "")).replace("\\", "/").lstrip("/")
            paths = {path for path, _ in files}
            if main_path not in paths or not main_path.lower().endswith(".tex"):
                raise ValueError("找不到有效的主 TeX 文件。")
            with tempfile.TemporaryDirectory(prefix="papercraft-latex-") as directory:
                root = Path(directory)
                for path, raw in files:
                    destination = root / path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(raw)
                main_file = root / main_path
                workdir = main_file.parent
                deadline = time.monotonic() + 90
                logs = []

                def run_compile(command):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(command, 90)
                    result = subprocess.run(
                        command,
                        cwd=workdir,
                        capture_output=True,
                        text=True,
                        timeout=remaining,
                    )
                    logs.append(f"$ {' '.join(command)}\n{result.stdout}\n{result.stderr}")
                    return result

                if Path(engine).name == "latexmk":
                    command = [engine, "-pdf", "-interaction=nonstopmode", "-file-line-error", "-halt-on-error", "-synctex=1", "-pdflatex=pdflatex -no-shell-escape %O %S", main_file.name]
                    completed = run_compile(command)
                else:
                    command = [engine, "-no-shell-escape", "-interaction=nonstopmode", "-file-line-error", "-halt-on-error", "-synctex=1", main_file.name]
                    completed = run_compile(command)
                    aux_path = main_file.with_suffix(".aux")
                    if completed.returncode == 0 and aux_path.exists() and b"\\bibdata" in aux_path.read_bytes():
                        bibtex = find_tex_command("bibtex", engine)
                        if not bibtex:
                            self.send_json({
                                "error": "文档包含参考文献，但未检测到 BibTeX。",
                                "code": "bibtex_missing",
                                "log": "\n".join(logs)[-12000:],
                            }, 503)
                            return
                        completed = run_compile([bibtex, main_file.stem])
                    if completed.returncode == 0:
                        completed = run_compile(command)
                    if completed.returncode == 0:
                        completed = run_compile(command)
                log = "\n".join(logs)
                diagnostics = self.parse_latex_diagnostics(log, main_path)
                pdf_path = main_file.with_suffix(".pdf")
                if completed.returncode != 0 or not pdf_path.exists():
                    self.send_json({"error": "LaTeX 编译失败。", "code": "compile_failed", "diagnostics": diagnostics, "log": log[-12000:]}, 422)
                    return
                response = {
                    "pdf": base64.b64encode(pdf_path.read_bytes()).decode("ascii"),
                    "pdf_name": pdf_path.name,
                    "engine": Path(engine).name,
                    "diagnostics": diagnostics,
                    "log": log[-12000:],
                }
                pdf_token = secrets.token_urlsafe(24)
                with COMPILED_PDFS_LOCK:
                    now = time.time()
                    COMPILED_PDFS[pdf_token] = {"data": pdf_path.read_bytes(), "created_at": now}
                    expired = [
                        token for token, item in COMPILED_PDFS.items()
                        if now - item.get("created_at", now) > COMPILED_PDF_TTL_SECONDS
                    ]
                    for token in expired:
                        COMPILED_PDFS.pop(token, None)
                    while len(COMPILED_PDFS) > COMPILED_PDF_MAX_ITEMS:
                        oldest = min(COMPILED_PDFS, key=lambda token: COMPILED_PDFS[token].get("created_at", 0))
                        COMPILED_PDFS.pop(oldest, None)
                response["pdf_url"] = f"/api/pdf/{pdf_token}"
                synctex_path = main_file.with_suffix(".synctex.gz")
                if synctex_path.exists():
                    response["synctex"] = base64.b64encode(synctex_path.read_bytes()).decode("ascii")
                self.send_json(response)
        except subprocess.TimeoutExpired:
            self.send_json({"error": "LaTeX 编译超过 90 秒，已终止。", "code": "compile_timeout"}, 408)
        except (ValueError, TypeError, json.JSONDecodeError, base64.binascii.Error, OSError) as exc:
            self.send_json({"error": f"无法编译项目：{exc}"}, 400)

    def parse_latex_diagnostics(self, log, main_path):
        diagnostics = []
        seen = set()
        for match in re.finditer(r"(?m)^(.+?\.(?:tex|sty|cls)):(\d+):\s*(.+)$", log):
            path, line, message = match.groups()
            key = (path, line, message)
            if key not in seen:
                diagnostics.append({"file": path.replace("\\", "/"), "line": int(line), "message": message.strip()})
                seen.add(key)
        if not diagnostics:
            for message in re.findall(r"(?m)^!\s*(.+)$", log)[:20]:
                diagnostics.append({"file": main_path, "line": 1, "message": message.strip()})
        return diagnostics[:100]

    def serve_compiled_pdf(self, send_body=True):
        match = re.fullmatch(r"/api/pdf/([A-Za-z0-9_-]+)", self.path.split("?", 1)[0])
        if not match:
            return False
        with COMPILED_PDFS_LOCK:
            item = COMPILED_PDFS.get(match.group(1))
            if item and time.time() - item.get("created_at", 0) > COMPILED_PDF_TTL_SECONDS:
                COMPILED_PDFS.pop(match.group(1), None)
                item = None
        if item is None:
            self.send_error(404, "Compiled PDF expired")
            return True
        data = item["data"]
        start, end = 0, len(data) - 1
        status = 200
        range_header = self.headers.get("Range", "")
        range_match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
        if range_match:
            if range_match.group(1):
                start = int(range_match.group(1))
                end = min(int(range_match.group(2) or end), end)
            elif range_match.group(2):
                start = max(0, len(data) - int(range_match.group(2)))
            if start > end or start >= len(data):
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(data)}")
                self.end_headers()
                return True
            status = 206
        body = data[start:end + 1]
        self.send_response(status)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", "inline")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send_body:
            self.wfile.write(body)
        return True

    def send_json(self, data, status=200):
        encoded = json.dumps(data, ensure_ascii=False).encode()
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


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    url = f"http://localhost:{port}"
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"AI LaTeX Paper Editor: {url}")
    if os.getenv("AUTO_OPEN") == "1":
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    server.serve_forever()
