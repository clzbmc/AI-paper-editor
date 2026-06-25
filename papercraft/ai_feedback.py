import json
import re

from .model_clients import ADAPTERS
from .model_config import configured_model_or_demo, model_settings
from .prompts import FEEDBACK_SYSTEM_PROMPT
from .utils import strip_json_fence


DEFAULT_FEEDBACK_ITEMS = [
    {
        "type": "clarity",
        "severity": "medium",
        "text": "部分表达偏笼统，例如 very important、a lot of 或 useful information。",
        "suggestion": "把笼统评价替换为可验证的学术描述，例如说明具体贡献、误差改善、效率提升或适用范围。",
    },
    {
        "type": "structure",
        "severity": "medium",
        "text": "个别句子承担的信息过多，读者需要同时处理背景、方法和结论。",
        "suggestion": "将长句拆成两到三句：先交代研究对象，再说明方法，最后呈现结论或限制条件。",
    },
    {
        "type": "flow",
        "severity": "low",
        "text": "段落之间的转折、递进或因果关系可以更明确。",
        "suggestion": "在关键位置加入 therefore、however、in contrast 或 as a result 等过渡表达，并确保前后逻辑一致。",
    },
    {
        "type": "evidence",
        "severity": "medium",
        "text": "背景判断或方法优势如果缺少引用，可信度会下降。",
        "suggestion": "为关键背景、方法对比或性能结论补充 \\cite{}，优先引用近年综述或直接相关实验/数值研究。",
    },
    {
        "type": "precision",
        "severity": "medium",
        "text": "部分结论措辞可能过强，容易超出数据能够支持的范围。",
        "suggestion": "使用 may、suggests、under the tested conditions 等限定表达，避免把局部结果写成普遍规律。",
    },
    {
        "type": "terminology",
        "severity": "low",
        "text": "术语、缩写和变量名需要在全文中保持一致。",
        "suggestion": "检查 CFD、LES、RANS、变量符号和大小写是否统一，首次出现时给出完整名称和缩写。",
    },
    {
        "type": "latex-safety",
        "severity": "low",
        "text": "LaTeX 命令、公式和引用结构应避免在写作修改中被破坏。",
        "suggestion": "修改文字时保留 \\cite{}、\\ref{}、公式环境和变量名原样，只调整自然语言部分。",
    },
    {
        "type": "conciseness",
        "severity": "low",
        "text": "部分句子可以减少重复修饰语，提高信息密度。",
        "suggestion": "删除 repeated、significant、important 等重复或空泛修饰，保留能直接支持论点的信息。",
    },
    {
        "type": "cohesion",
        "severity": "low",
        "text": "段落主题句和后续细节之间可以建立更清晰的呼应。",
        "suggestion": "让段首句明确本段目的，后续每句围绕同一主题展开，避免突然切换研究对象或尺度。",
    },
    {
        "type": "reader-focus",
        "severity": "low",
        "text": "读者可能需要更明确地知道本段结果对论文主张的意义。",
        "suggestion": "在段末增加一句简短解释，说明该结果如何支撑研究问题、方法价值或后续分析。",
    },
]


def ensure_feedback_count(items):
    normalized = list(items[:10])
    seen = {item.get("text", "") for item in normalized}
    for fallback in DEFAULT_FEEDBACK_ITEMS:
        if len(normalized) >= 10:
            break
        if fallback["text"] in seen:
            continue
        normalized.append(dict(fallback))
        seen.add(fallback["text"])
    return normalized[:10]

def locate_anchor(content, anchor_text="", fallback=0):
    text = str(content or "")
    anchor = str(anchor_text or "").strip()
    start = -1
    if anchor:
        start = text.find(anchor)
        if start < 0:
            compact_anchor = re.sub(r"\s+", " ", anchor)
            compact_text = re.sub(r"\s+", " ", text)
            compact_start = compact_text.find(compact_anchor)
            if compact_start >= 0:
                prefix = compact_text[:compact_start]
                nonspace_count = len(re.sub(r"\s+", "", prefix))
                cursor = 0
                seen = 0
                while cursor < len(text) and seen < nonspace_count:
                    if not text[cursor].isspace():
                        seen += 1
                    cursor += 1
                start = cursor
    if start < 0:
        start = max(0, min(len(text), int(fallback or 0)))
        end = min(len(text), start + 160)
    else:
        end = min(len(text), start + max(len(anchor), 1))
    line = text[:start].count("\n") + 1
    return {"anchor_text": text[start:end], "start": start, "end": end, "line": line}


def enrich_feedback_locations(items, content, fallback=0):
    enriched = []
    for index, item in enumerate(ensure_feedback_count(items)):
        anchor_text = item.get("anchor_text") or item.get("quote") or item.get("evidence") or ""
        location = locate_anchor(content, anchor_text, fallback + index * 80)
        enriched.append({**item, **location})
    return enriched


def best_demo_anchor(text, item):
    normalized_type = item.get("type", "")
    patterns = {
        "clarity": r"\b(?:very important|a lot of|useful information)\b",
        "evidence": r"[^.\n]*\\cite\{[^.\n]*|[^.\n]{80,}",
        "latex-safety": r"\\(?:cite|ref|begin\{equation\}|begin\{align\})[^.\n]*",
    }
    pattern = patterns.get(normalized_type)
    if pattern:
        match = re.search(pattern, text, flags=re.I)
        if match:
            return match.group(0)[:240]
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", text) if len(sentence.strip()) > 50]
    return sentences[0][:240] if sentences else text[:160]


def demo_feedback(text):
    """Offline feedback that demonstrates the suggestion layer without changing text."""
    normalized = " ".join(text.split())
    items = [dict(item) for item in DEFAULT_FEEDBACK_ITEMS]
    if re.search(r"\b(very important|a lot of|useful information)\b", normalized, flags=re.I):
        items[0] = {
            "type": "clarity",
            "severity": "medium",
            "text": "部分表达偏笼统，例如 very important、a lot of 或 useful information。",
            "suggestion": "用更具体的学术名词说明重要性、数量或贡献。",
        }
    if len(re.findall(r"[.;]", text)) < 2 and len(normalized) > 500:
        items[1] = {
            "type": "structure",
            "severity": "medium",
            "text": "当前片段较长但句法停顿较少，读者可能难以跟随论证。",
            "suggestion": "考虑拆分长句，并让每句只承担一个主要论点。",
        }
    if re.search(r"\b(However|Therefore|Moreover|In addition)\b", normalized) is None and len(normalized) > 400:
        items[2] = {
            "type": "flow",
            "severity": "low",
            "text": "片段中缺少显式过渡词，段落之间的逻辑关系可能不够清楚。",
            "suggestion": "在转折、递进或因果位置加入简短过渡表达。",
        }
    if "\\cite{" not in text and len(normalized) > 600:
        items[3] = {
            "type": "evidence",
            "severity": "low",
            "text": "较长论述中没有明显引用，部分背景或方法判断可能缺少支撑。",
            "suggestion": "检查是否需要为关键背景、方法或对比结论补充引用。",
        }
    items = ensure_feedback_count(items)
    for item in items:
        item["anchor_text"] = best_demo_anchor(text, item)
    return {"feedback": enrich_feedback_locations(items, text), "demo": True}


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
        "task": "Return exactly 10 concise academic writing feedback items in Simplified Chinese. Each item must include type, severity, text, suggestion, and anchor_text. anchor_text should be a short exact quote copied from the provided excerpt that the feedback refers to. The suggestion should be an actionable solution or recommended wording. Do not rewrite the document automatically.",
    }, ensure_ascii=False)


def parse_feedback_content(content):
    parsed = json.loads(strip_json_fence(content))
    raw_items = parsed.get("feedback", parsed if isinstance(parsed, list) else [])
    if not isinstance(raw_items, list):
        raise ValueError("feedback must be an array")
    items = []
    for item in raw_items[:10]:
        if not isinstance(item, dict):
            continue
        items.append({
            "type": str(item.get("type", "writing")),
            "severity": str(item.get("severity", "low")),
            "text": str(item.get("text", ""))[:600],
            "suggestion": str(item.get("suggestion", ""))[:800],
            "anchor_text": str(item.get("anchor_text", ""))[:500],
        })
    if not items:
        raise ValueError("feedback is empty")
    return {"feedback": ensure_feedback_count(items)}


def call_feedback_model(payload):
    content = payload.get("content", "")
    active, provider, request_config = configured_model_or_demo()
    if provider is None:
        result = demo_feedback(content)
        if active:
            result["provider"] = active
        return result
    settings = model_settings(request_config)
    settings["max_tokens"] = min(settings["max_tokens"], 3200)
    adapter = ADAPTERS.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_feedback_content(adapter(provider, build_feedback_prompt(payload), settings, FEEDBACK_SYSTEM_PROMPT))
        fallback = payload.get("selection_start", 0) or 0
        parsed["feedback"] = enrich_feedback_locations(parsed["feedback"], content, fallback)
        return {**parsed, "demo": False, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"写作反馈返回格式无效：{exc}") from exc
