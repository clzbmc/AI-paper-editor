import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request

from .utils import endpoint


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


def call_openai_compatible(provider, user_prompt, settings, system_prompt):
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


def call_anthropic(provider, user_prompt, settings, system_prompt):
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


def call_gemini(provider, user_prompt, settings, system_prompt):
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


ADAPTERS = {
    "openai_compatible": call_openai_compatible,
    "anthropic": call_anthropic,
    "gemini": call_gemini,
}
