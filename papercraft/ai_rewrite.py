import json
import re

from .model_clients import ADAPTERS
from .model_config import configured_model_or_demo, model_settings
from .prompts import SYSTEM_PROMPT
from .utils import strip_json_fence


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


def build_user_prompt(payload):
    return json.dumps({
        "selected_text": payload["text"],
        "context_before": payload.get("context_before", ""),
        "context_after": payload.get("context_after", ""),
        "requested_mode": payload.get("mode", "all"),
        "custom_instruction": payload.get("custom_prompt", ""),
    }, ensure_ascii=False)


def parse_model_content(content):
    parsed = json.loads(strip_json_fence(content))
    reasons = parsed.get("reasons", {})
    if not isinstance(reasons, dict):
        reasons = {}
    return {
        "A": str(parsed["A"]),
        "B": str(parsed["B"]),
        "C": str(parsed["C"]),
        "reasons": {key: str(reasons.get(key, "")) for key in ("A", "B", "C") if reasons.get(key)},
    }


def call_model(payload):
    active, provider, request_config = configured_model_or_demo()
    if provider is None:
        result = demo_rewrites(payload["text"])
        if active:
            result["provider"] = active
        return result
    settings = model_settings(request_config)
    adapter = ADAPTERS.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_model_content(adapter(provider, build_user_prompt(payload), settings, SYSTEM_PROMPT))
        return {**parsed, "demo": False, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"模型返回格式无效：{exc}") from exc

