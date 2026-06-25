import json
import re
import time

from .model_clients import ADAPTERS
from .model_config import configured_model_or_demo, model_settings
from .prompts import PROJECT_MEMORY_SYSTEM_PROMPT
from .utils import strip_json_fence


SOURCE_TYPES = {"current", "template", "legacy", "ambiguous", "ignored"}
MEMORY_VERSION = 1


def tokenize(text):
    return [token.lower() for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}", str(text))]


def classify_source(path, text):
    lower = f"{path}\n{text[:3000]}".lower()
    if ".papercraft/" in path:
        return "ignored", 1.0, "PaperCraft managed file."
    if re.search(r"(template|sample|example|demo|placeholder|todo|lorem ipsum|your title|author name)", lower):
        return "template", 0.78, "Contains template or placeholder signals."
    if re.search(r"(previous work|old paper|legacy|copied from|上一篇|旧文|模板)", lower):
        return "legacy", 0.78, "Contains legacy-paper signals."
    if len(str(text).strip()) < 240:
        return "ambiguous", 0.45, "Text is too short to classify confidently."
    return "current", 0.72, "No strong template or legacy signal detected."


def summary_for(text, limit=360):
    clean = re.sub(r"\s+", " ", str(text)).strip()
    return clean[:limit]


def keyword_list(text, limit=12):
    counts = {}
    for token in tokenize(text):
        if len(token) < 3 or token in {"section", "begin", "end", "document", "figure", "table", "cite", "label", "ref"}:
            continue
        counts[token] = counts.get(token, 0) + 1
    return [token for token, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def citation_keys(text, limit=20):
    keys = []
    for match in re.finditer(r"\\(?:cite|citep|citet|parencite|textcite)(?:\[[^\]]*\])*\{([^}]*)\}", str(text)):
        keys.extend(key.strip() for key in match.group(1).split(",") if key.strip())
    for match in re.finditer(r"@\w+\{([^,\s]+)", str(text)):
        keys.append(match.group(1).strip())
    seen = []
    for key in keys:
        if key not in seen:
            seen.append(key)
    return seen[:limit]


def section_blocks(file):
    path = str(file.get("path", ""))
    content = str(file.get("content", ""))
    matches = list(re.finditer(r"\\(?:section|subsection|subsubsection)\*?\{([^}]*)\}", content))
    if not matches:
        return [{"path": path, "heading": path, "content": content[:12000], "start": 0}]
    blocks = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        blocks.append({"path": path, "heading": match.group(1).strip() or path, "content": content[match.start():end][:12000], "start": match.start()})
    return blocks


def demo_memory(payload):
    files = [file for file in payload.get("files", []) if file.get("kind") == "text"]
    entries = []
    project_keywords = []
    for file in files[:80]:
        for block in section_blocks(file)[:8]:
            source_type, confidence, rationale = classify_source(block["path"], block["content"])
            keywords = keyword_list(block["content"])
            project_keywords.extend(keywords)
            entries.append({
                "id": f"{block['path']}:{block['start']}",
                "path": block["path"],
                "heading": block["heading"],
                "summary": summary_for(block["content"]),
                "keywords": keywords,
                "terms": keywords[:6],
                "citations": citation_keys(block["content"]),
                "source_type": source_type,
                "confidence": confidence,
                "rationale": rationale,
                "manual": False,
            })
    return {
        "version": MEMORY_VERSION,
        "generated_at": int(time.time()),
        "project_summary": "项目记忆已根据当前项目文本生成。请确认疑似模板或旧文分类后再高置信使用。",
        "keywords": list(dict.fromkeys(project_keywords))[:30],
        "entries": entries,
        "sampled": bool(payload.get("sampled")),
        "sample_info": payload.get("sample_info") or None,
        "demo": True,
    }


def normalize_entry(item, fallback_id):
    source_type = str(item.get("source_type", "ambiguous"))
    if source_type not in SOURCE_TYPES:
        source_type = "ambiguous"
    try:
        confidence = float(item.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    return {
        "id": str(item.get("id") or fallback_id),
        "path": str(item.get("path", "")),
        "heading": str(item.get("heading", "")),
        "summary": str(item.get("summary", ""))[:1200],
        "keywords": [str(value)[:80] for value in item.get("keywords", [])[:20] if str(value).strip()],
        "terms": [str(value)[:80] for value in item.get("terms", [])[:20] if str(value).strip()],
        "citations": [str(value)[:120] for value in item.get("citations", [])[:30] if str(value).strip()],
        "source_type": source_type,
        "confidence": max(0.0, min(1.0, confidence)),
        "rationale": str(item.get("rationale", ""))[:500],
        "manual": bool(item.get("manual")),
    }


def parse_memory_content(content):
    parsed = json.loads(strip_json_fence(content))
    entries = parsed.get("entries", [])
    if not isinstance(entries, list):
        raise ValueError("entries must be an array")
    return {
        "version": MEMORY_VERSION,
        "generated_at": int(time.time()),
        "project_summary": str(parsed.get("project_summary", ""))[:2000],
        "keywords": [str(value)[:80] for value in parsed.get("keywords", [])[:50] if str(value).strip()],
        "entries": [normalize_entry(item, f"entry-{index}") for index, item in enumerate(entries[:300]) if isinstance(item, dict)],
        "sampled": False,
        "sample_info": None,
        "demo": False,
    }


def build_memory_prompt(payload):
    files = []
    total = 0
    for file in payload.get("files", []):
        if file.get("kind") != "text":
            continue
        content = str(file.get("content", ""))
        if not content.strip():
            continue
        keep = content[:16000]
        total += len(keep)
        if total > 180000:
            break
        files.append({"path": file.get("path", ""), "content": keep, "truncated": len(content) > len(keep)})
    return json.dumps({
        "files": files,
        "existing_manual_overrides": payload.get("manual_overrides", {}),
        "task": "Build a project memory index. Classify each file or section as current, template, legacy, ambiguous, or ignored. Be conservative: if unsure whether content belongs to the current paper, use ambiguous.",
    }, ensure_ascii=False)


def call_project_memory_build(payload):
    active, provider, request_config = configured_model_or_demo()
    if provider is None:
        result = demo_memory(payload)
        if active:
            result["provider"] = active
        return result
    settings = model_settings(request_config)
    settings["max_tokens"] = min(settings["max_tokens"], 5000)
    adapter = ADAPTERS.get(provider["type"])
    if not adapter:
        raise RuntimeError(f"不支持的模型接口类型：{provider['type']}")
    try:
        parsed = parse_memory_content(adapter(provider, build_memory_prompt(payload), settings, PROJECT_MEMORY_SYSTEM_PROMPT))
        parsed["sampled"] = bool(payload.get("sampled"))
        parsed["sample_info"] = payload.get("sample_info") or None
        return {**parsed, "provider": active, "model": provider["model"]}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"项目记忆返回格式无效：{exc}") from exc


def score_entry(query_tokens, entry):
    haystack = " ".join([
        entry.get("path", ""),
        entry.get("heading", ""),
        entry.get("summary", ""),
        " ".join(entry.get("keywords", [])),
        " ".join(entry.get("terms", [])),
        " ".join(entry.get("citations", [])),
    ]).lower()
    return sum(1 for token in query_tokens if token in haystack)


def usage_policy(source_type):
    if source_type == "current":
        return "fact_context"
    if source_type == "template":
        return "structure_only"
    if source_type == "ambiguous":
        return "low_confidence_do_not_use_as_fact"
    return "exclude"


def retrieve_project_memory(payload):
    memory = payload.get("memory", {}) if isinstance(payload.get("memory", {}), dict) else {}
    entries = [normalize_entry(item, f"entry-{index}") for index, item in enumerate(memory.get("entries", [])) if isinstance(item, dict)]
    query = " ".join(str(payload.get(key, "")) for key in ("query", "current_path", "task"))
    query_tokens = tokenize(query)
    results = []
    for entry in entries:
        if entry["source_type"] in {"legacy", "ignored"}:
            continue
        if entry["source_type"] == "current" and entry["confidence"] < 0.6:
            continue
        if entry["source_type"] == "ambiguous" and not payload.get("include_ambiguous"):
            continue
        score = score_entry(query_tokens, entry)
        if entry["path"] == payload.get("current_path"):
            score += 2
        if entry["source_type"] == "current":
            score += 1
        if score <= 0 and query_tokens:
            continue
        results.append({**entry, "score": score, "usage_policy": usage_policy(entry["source_type"])})
    results.sort(key=lambda item: (-item["score"], -item["confidence"], item["path"]))
    return {"items": results[: int(payload.get("limit", 6) or 6)], "project_summary": memory.get("project_summary", ""), "demo": bool(memory.get("demo"))}
