"""Verified runtime source manifest; an integrity check, NOT a signature or credential."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "optimizer/build-manifest.json"
EXTRA_FILES = (
    "shared/planning-contract-v13.json",
    "scripts/local_trial.py",
    "scripts/local_web.py",
    "scripts/public_resources.py",
    "public-resources.json",
)


def build_manifest(root: Path = ROOT) -> dict:
    root = Path(root).resolve()
    files = sorted({p.relative_to(root).as_posix() for p in (root / "optimizer").glob("*.py")} | set(EXTRA_FILES))
    if "optimizer/supply_chain_job_worker_v6.py" not in files:
        raise RuntimeError("BUILD_RUNTIME_FILE_MISSING")
    combined = hashlib.sha256()
    entries = []
    for name in files:
        target = root / name
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(root):
            raise RuntimeError("BUILD_RUNTIME_FILE_INVALID")
        data = target.read_bytes()
        entries.append({"path": name, "sha256": hashlib.sha256(data).hexdigest()})
        combined.update(name.encode("utf-8") + b"\0" + data)
    return {"schemaVersion": "stct-runtime-manifest-v1", "files": entries, "fingerprint": combined.hexdigest()}


def verified_identity(root: Path = ROOT) -> dict:
    root = Path(root).resolve()
    path = root / MANIFEST
    if path.is_symlink():
        raise RuntimeError("BUILD_MANIFEST_INVALID")
    try:
        expected = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("BUILD_MANIFEST_MISSING_OR_INVALID") from exc
    actual = build_manifest(root)
    if expected != actual:
        raise RuntimeError("BUILD_MANIFEST_MISMATCH: regenerate manifest and frontend pin before starting")
    return actual
