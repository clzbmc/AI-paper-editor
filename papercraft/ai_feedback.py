import json
import re

from .model_clients import ADAPTERS
from .model_config import configured_model_or_demo, model_settings
from .prompts import FEEDBACK_SYSTEM_PROMPT
from .utils import strip_json_fence


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


def parse_feedback_content(content):
    parsed = json.loads(strip_json_fence(content))
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
    adapter = ADAPTERS.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_feedback_content(adapter(provider, build_feedback_prompt(payload), settings, FEEDBACK_SYSTEM_PROMPT))
        return {**parsed, "demo": False, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"写作反馈返回格式无效：{exc}") from exc

