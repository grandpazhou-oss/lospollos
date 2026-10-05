"""Exact public assets shared by local Mac/Windows and retained legacy servers."""
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = frozenset(json.loads((ROOT / "public-resources.json").read_text(encoding="utf-8"))["files"])


def public_file(request_path, root=ROOT):
    path = urlsplit(request_path).path
    try:
        path = unquote(path, errors="strict")
    except (UnicodeError, ValueError):
        return None
    if "\\" in path or ":" in path or "%" in path or any(ord(c) < 32 for c in path):
        return None
    parts = path.lstrip("/").split("/")
    if any(part in (".", "..") for part in parts):
        return None
    key = "/".join(parts) if path not in ("", "/") else "index.html"
    if key not in PUBLIC_FILES:
        return None
    target = root
    for part in key.split("/"):
        target = target / part
        if target.is_symlink():
            return None
    if not target.is_file() or root.resolve() not in target.resolve().parents:
        return None
    return target
