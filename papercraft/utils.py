import json
import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
APP_VERSION = "0.8"
TEXT_EXTENSIONS = {".tex", ".latex", ".bib", ".sty", ".cls", ".bst", ".rtx", ".txt", ".text", ".md", ".json"}
ASSET_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
LATEX_SEARCH_DIRS = [
    ROOT / "tools",
    Path("/Library/TeX/texbin"),
    Path("/opt/homebrew/bin"),
    Path("/usr/local/bin"),
]
CONFIG_PATH = Path(os.getenv("MODEL_CONFIG_PATH", ROOT / "model_config.json"))


class ApiError(Exception):
    def __init__(self, payload, status=400):
        super().__init__(str(payload.get("error", payload)))
        self.payload = payload
        self.status = status


def endpoint(base_url, suffix):
    base_url = str(base_url).rstrip("/")
    return base_url if base_url.endswith(suffix) else f"{base_url}/{suffix}"


def strip_json_fence(content):
    content = str(content).strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.I)
    return content


def dumps_json(data):
    return json.dumps(data, ensure_ascii=False).encode()
