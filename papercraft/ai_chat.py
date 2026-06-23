import json
import re

from .model_clients import ADAPTERS
from .model_config import configured_model_or_demo, model_settings
from .prompts import CHAT_SYSTEM_PROMPT
from .utils import strip_json_fence


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


def build_chat_prompt(payload):
    return json.dumps({
        "messages": payload.get("messages", []),
        "current_path": payload.get("current_path", ""),
        "files": payload.get("files", []),
        "resource_manifest": payload.get("resource_manifest", []),
        "context_truncated": bool(payload.get("context_truncated")),
        "task": "Answer in Chinese. Suggest exact changes only when explicitly requested. Never apply changes directly.",
    }, ensure_ascii=False)


def parse_chat_content(content):
    parsed = json.loads(strip_json_fence(content))
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


def call_chat_model(payload):
    active, provider, request_config = configured_model_or_demo()
    if provider is None:
        result = demo_chat(payload)
        if active:
            result["provider"] = active
        return result
    settings = model_settings(request_config)
    settings["max_tokens"] = min(settings["max_tokens"], 3000)
    adapter = ADAPTERS.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_chat_content(adapter(provider, build_chat_prompt(payload), settings, CHAT_SYSTEM_PROMPT))
        return {**parsed, "demo": False, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"项目对话返回格式无效：{exc}") from exc

