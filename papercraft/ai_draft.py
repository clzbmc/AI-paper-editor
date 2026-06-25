import json

from .model_clients import ADAPTERS
from .model_config import configured_model_or_demo, model_settings
from .prompts import DRAFT_SYSTEM_PROMPT
from .utils import strip_json_fence


def draft_context(content, cursor_position=0, limit=14000):
    if len(content) <= limit:
        return content
    try:
        cursor = int(cursor_position)
    except (TypeError, ValueError):
        cursor = 0
    cursor = max(0, min(len(content), cursor))
    half = limit // 2
    left = max(0, cursor - half)
    right = min(len(content), left + limit)
    left = max(0, right - limit)
    return content[left:right]


def demo_draft(payload):
    draft = " ".join(str(payload.get("draft", "")).split())
    mode = payload.get("mode", "all")
    if "贡献" in draft or "意义" in draft:
        text = "These results clarify the contribution of the proposed approach and demonstrate its relevance to the broader research context."
    elif "方法" in draft or "模型" in draft:
        text = "The proposed method provides a systematic framework for analyzing the target problem while preserving consistency with the governing physical assumptions."
    elif "结果" in draft or "发现" in draft:
        text = "The results indicate that the proposed configuration improves predictive performance while maintaining computational efficiency."
    else:
        text = "This paragraph can be developed into a concise academic statement that connects the user's intended point with the surrounding paper context."
    if mode == "all":
        concise = text.replace("This paragraph can be developed into ", "")
        if concise == text:
            concise = text.replace("The proposed method provides a systematic framework for ", "The method systematically supports ")
        academic = text.replace("show", "demonstrate")
        if academic == text:
            academic = text.replace("provides", "establishes").replace("while preserving", "while maintaining")
        return {
            "variants": {
                "A": text.replace("demonstrate", "show"),
                "B": academic,
                "C": concise,
            },
            "reasons": {
                "A": "保守版本优先保持原始意图，只将中文草稿转为自然英文表达。",
                "B": "学术版本强化正式程度和论文语境中的论证语气。",
                "C": "精简版本压缩表达，保留核心技术含义。",
            },
            "demo": True,
        }
    if mode == "safe":
        text = text.replace("demonstrate", "show")
    elif mode == "academic":
        text = text.replace("show", "demonstrate")
    elif mode == "concise":
        text = text.replace("This paragraph can be developed into ", "")
    return {
        "text": text,
        "reason": "离线演示内容已根据中文草稿、当前写作目标和论文上下文生成英文表达。",
        "demo": True,
    }


def build_draft_prompt(payload):
    content = payload.get("content", "")
    return json.dumps({
        "file_path": payload.get("path", ""),
        "paper_context": draft_context(content, payload.get("cursor_position", 0)),
        "cursor_position": payload.get("cursor_position", 0),
        "chinese_draft": payload.get("draft", ""),
        "requested_mode": payload.get("mode", "all"),
        "custom_instruction": payload.get("custom_prompt", ""),
        "project_memory": payload.get("project_memory", []),
        "task": "Generate professional English academic content from the Chinese draft. The result must fit the paper context and be ready to insert at the cursor position.",
    }, ensure_ascii=False)


def parse_draft_content(content, mode="all"):
    parsed = json.loads(strip_json_fence(content))
    if mode == "all":
        variants = parsed.get("variants", {})
        reasons = parsed.get("reasons", {})
        result_variants = {}
        result_reasons = {}
        for key in ("A", "B", "C"):
            value = str(variants.get(key, "")).strip()
            if not value:
                raise ValueError(f"variants.{key} is empty")
            result_variants[key] = value[:12000]
            result_reasons[key] = str(reasons.get(key, ""))[:800]
        return {
            "variants": result_variants,
            "reasons": result_reasons,
        }
    text = str(parsed.get("text", "")).strip()
    if not text:
        raise ValueError("text is empty")
    return {
        "text": text[:12000],
        "reason": str(parsed.get("reason", ""))[:800],
    }


def call_draft_model(payload):
    active, provider, request_config = configured_model_or_demo()
    if provider is None:
        result = demo_draft(payload)
        if active:
            result["provider"] = active
        return result
    settings = model_settings(request_config)
    settings["max_tokens"] = min(settings["max_tokens"], 2400)
    adapter = ADAPTERS.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_draft_content(adapter(provider, build_draft_prompt(payload), settings, DRAFT_SYSTEM_PROMPT), payload.get("mode", "all"))
        return {**parsed, "demo": False, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"中文草稿生成返回格式无效：{exc}") from exc
