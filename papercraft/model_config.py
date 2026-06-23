import json
import os

from .utils import CONFIG_PATH


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

