import base64
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from .pdf_store import remember_pdf
from .project_io import decode_project_files
from .utils import ApiError, LATEX_SEARCH_DIRS


def find_latex_engine():
    import os

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
    import os

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


def parse_latex_diagnostics(log, main_path):
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


def compile_project_payload(payload):
    engine = find_latex_engine()
    if not engine:
        raise ApiError({
            "error": "未检测到 LaTeX 工具链。请安装 MacTeX 或 BasicTeX 后重试。",
            "code": "toolchain_missing",
            "searched": [str(path) for path in LATEX_SEARCH_DIRS],
        }, 503)

    files = decode_project_files(payload)
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
                    raise ApiError({
                        "error": "文档包含参考文献，但未检测到 BibTeX。",
                        "code": "bibtex_missing",
                        "log": "\n".join(logs)[-12000:],
                    }, 503)
                completed = run_compile([bibtex, main_file.stem])
            if completed.returncode == 0:
                completed = run_compile(command)
            if completed.returncode == 0:
                completed = run_compile(command)

        log = "\n".join(logs)
        diagnostics = parse_latex_diagnostics(log, main_path)
        pdf_path = main_file.with_suffix(".pdf")
        if completed.returncode != 0 or not pdf_path.exists():
            raise ApiError({"error": "LaTeX 编译失败。", "code": "compile_failed", "diagnostics": diagnostics, "log": log[-12000:]}, 422)

        pdf_data = pdf_path.read_bytes()
        response = {
            "pdf": base64.b64encode(pdf_data).decode("ascii"),
            "pdf_name": pdf_path.name,
            "engine": Path(engine).name,
            "diagnostics": diagnostics,
            "log": log[-12000:],
        }
        response["pdf_url"] = f"/api/pdf/{remember_pdf(pdf_data)}"
        synctex_path = main_file.with_suffix(".synctex.gz")
        if synctex_path.exists():
            response["synctex"] = base64.b64encode(synctex_path.read_bytes()).decode("ascii")
        return response
