import base64
import io
import mimetypes
import re
import secrets
import threading
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from .utils import ASSET_EXTENSIONS, ROOT, TEXT_EXTENSIONS


SERVER_PROJECTS_DIR = ROOT / "projects"
SERVER_PROJECTS = {}
SERVER_PROJECTS_LOCK = threading.Lock()


def safe_zip_entries(archive):
    entries = []
    for item in archive.infolist():
        path = item.filename.replace("\\", "/")
        if item.is_dir() or path.startswith("__MACOSX/"):
            continue
        parts = [part for part in path.split("/") if part]
        if not parts or path.startswith("/") or any(part in {".", ".."} for part in parts):
            raise ValueError(f"ZIP 中包含无效路径：{item.filename}")
        entries.append((item, "/".join(parts)))
    if len(entries) > 500 or sum(item.file_size for item, _ in entries) > 100 * 1024 * 1024:
        raise ValueError("项目超过 500 个文件或解压后超过 100 MB。")
    return entries


def project_file_record(path, raw, root_id=""):
    suffix = Path(path).suffix.lower()
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if suffix in TEXT_EXTENSIONS:
        record = {"path": path, "kind": "text", "mime": mime, "content": raw.decode("utf-8", errors="replace")}
        if root_id:
            record["serverRootId"] = root_id
            record["serverWritable"] = True
        return record
    if suffix in ASSET_EXTENSIONS:
        return {"path": path, "kind": "asset", "mime": mime, "content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"}
    return {"path": path, "kind": "other", "mime": mime, "content": base64.b64encode(raw).decode("ascii"), "encoding": "base64", "size": len(raw)}


def safe_project_name(name):
    base = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "_", name, flags=re.UNICODE)
    base = base.strip("._")
    return base or "paper-project"


def create_unique_project_dir(base_name):
    SERVER_PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_base = safe_project_name(base_name)
    for index in range(1, 1000):
        name = safe_base if index == 1 else f"{safe_base}-{index}"
        destination = SERVER_PROJECTS_DIR / name
        try:
            destination.mkdir()
            return name, destination
        except FileExistsError:
            continue
    raise RuntimeError("无法创建唯一项目目录，请清理 projects 目录后重试。")


def remember_server_project(root_id, root):
    with SERVER_PROJECTS_LOCK:
        SERVER_PROJECTS[root_id] = Path(root).resolve()


def resolve_server_project(root_id):
    root_id = str(root_id or "")
    with SERVER_PROJECTS_LOCK:
        root = SERVER_PROJECTS.get(root_id)
    if root is None:
        raise ValueError("项目写回会话已失效，请重新打开项目文件夹。")
    root = Path(root).resolve()
    projects_root = SERVER_PROJECTS_DIR.resolve()
    if not root.is_dir() or (root != projects_root and projects_root not in root.parents):
        raise ValueError("项目写回目录无效。")
    return root


def import_project_zip(raw_zip):
    archive = zipfile.ZipFile(io.BytesIO(raw_zip))
    files = []
    for item, path in safe_zip_entries(archive):
        files.append(project_file_record(path, archive.read(item)))
    return {"files": files}


def create_project_from_zip(raw_zip, zip_name):
    archive = zipfile.ZipFile(io.BytesIO(raw_zip))
    project_name, root = create_unique_project_dir(Path(zip_name or "paper-project.zip").stem)
    root_id = secrets.token_urlsafe(18)
    files = []
    root_resolved = root.resolve()
    for item, path in safe_zip_entries(archive):
        raw = archive.read(item)
        destination = root / path
        resolved = destination.resolve()
        if root_resolved not in [resolved.parent, *resolved.parents]:
            raise ValueError(f"ZIP 中包含无效路径：{path}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
        files.append(project_file_record(path, raw, root_id))
    remember_server_project(root_id, root)
    return {"name": project_name, "root_id": root_id, "path": str(root.relative_to(ROOT)), "files": files}


def save_project_file_payload(payload):
    root = resolve_server_project(payload.get("root_id"))
    path = str(payload.get("path", "")).replace("\\", "/").lstrip("/")
    parts = Path(path).parts
    if not path or ".." in parts or Path(path).suffix.lower() not in TEXT_EXTENSIONS:
        raise ValueError("只能写回项目内的文本文件。")
    destination = (root / path).resolve()
    if root not in [destination.parent, *destination.parents]:
        raise ValueError("写回路径超出项目目录。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(str(payload.get("content", "")), encoding="utf-8")
    return {"ok": True}


def decode_project_files(payload):
    files = payload.get("files", [])
    if not isinstance(files, list) or not files or len(files) > 500:
        raise ValueError("项目必须包含 1 至 500 个文件。")
    decoded = []
    total_size = 0
    for file in files:
        path = str(file.get("path", "")).replace("\\", "/").lstrip("/")
        parts = Path(path).parts
        if not path or ".." in parts:
            raise ValueError("项目中包含无效路径。")
        if file.get("encoding") == "base64":
            raw = base64.b64decode(file.get("content", ""), validate=True)
        else:
            raw = str(file.get("content", "")).encode("utf-8")
        total_size += len(raw)
        if total_size > 100 * 1024 * 1024:
            raise ValueError("项目超过 100 MB。")
        decoded.append((path, raw))
    return decoded


def export_project_zip(payload):
    files = decode_project_files(payload)
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, raw in files:
            archive.writestr(path, raw)
    return archive_buffer.getvalue()


def extract_docx_text(raw_docx):
    archive = zipfile.ZipFile(io.BytesIO(raw_docx))
    try:
        document_xml = archive.read("word/document.xml")
    except KeyError as exc:
        raise ValueError("DOCX 文件缺少正文内容。") from exc
    root = ET.fromstring(document_xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = []
    for paragraph in root.findall(".//w:p", namespace):
        parts = []
        for node in paragraph.iter():
            if node.tag == f"{{{namespace['w']}}}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{{{namespace['w']}}}tab":
                parts.append("\t")
            elif node.tag in {f"{{{namespace['w']}}}br", f"{{{namespace['w']}}}cr"}:
                parts.append("\n")
        text = "".join(parts).strip()
        if text:
            paragraphs.append(text)
    content = "\n\n".join(paragraphs)
    if not content.strip():
        raise ValueError("DOCX 文件没有可提取的文本内容。")
    return content


def import_document_file(raw, filename, mime=""):
    name = Path(str(filename or "document")).name
    suffix = Path(name).suffix.lower()
    if suffix == ".doc":
        raise ValueError("暂不支持旧版 .doc，请另存为 .docx 或 txt 后再打开。")
    if suffix != ".docx":
        raise ValueError("仅支持导入 .docx 文档。")
    return {
        "file": {
            "path": name,
            "kind": "text",
            "mime": mime or "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content": extract_docx_text(raw),
        }
    }
