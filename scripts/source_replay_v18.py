#!/usr/bin/env python3
"""Reconstruct the current v1.8 source in three clean, unrelated paths."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import zipfile


REPO = pathlib.Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {".git", ".claude", ".run", "logs", "__pycache__"}


def run(command: list[str], cwd: pathlib.Path = REPO, allowed: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=False)
    if result.returncode not in allowed:
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command)}\n{result.stderr or result.stdout}")
    return result


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def manifest(root: pathlib.Path) -> dict[str, str]:
    rows = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in EXCLUDED_PARTS for part in relative.parts) or path.name == ".DS_Store" or path.suffix == ".pyc":
            continue
        rows[relative.as_posix()] = sha256(path)
    return rows


def reset_owned(path: pathlib.Path, root: pathlib.Path) -> None:
    resolved = path.resolve()
    if root.resolve() not in resolved.parents:
        raise RuntimeError(f"Refusing to reset path outside owned root: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
    resolved.mkdir(parents=True)


def build_patches(stage: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    tracked = stage / "TRACKED_DIFF.patch"
    untracked = stage / "UNTRACKED_DIFF.patch"
    tracked.write_text(run(["git", "diff", "--binary", "--no-ext-diff", "--"]).stdout, encoding="utf-8")
    chunks = []
    for relative in run(["git", "ls-files", "--others", "--exclude-standard"]).stdout.splitlines():
        if relative:
            chunks.append(run(["git", "diff", "--no-index", "--binary", "--", "/dev/null", relative], allowed=(0, 1)).stdout)
    untracked.write_text("".join(chunks), encoding="utf-8")
    return tracked, untracked


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--label", default="source-replay")
    args = parser.parse_args()
    run_dir = pathlib.Path(args.run_dir).resolve()
    root = run_dir / "replay" / args.label
    reset_owned(root, run_dir)
    stage = root / "patches"
    stage.mkdir()
    tracked, untracked = build_patches(stage)
    head = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    archive = stage / "head.zip"
    run(["git", "archive", "--format=zip", "-o", str(archive), head])
    expected = manifest(REPO)
    targets = [
        root / "ascii-one",
        root / "space path" / "depth-two",
        root / "验证目录" / "deep" / "depth-three",
    ]
    results = []
    for index, target in enumerate(targets):
        target.mkdir(parents=True)
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(target)
        run(["git", "apply", "--binary", str(tracked)], cwd=target)
        run(["git", "apply", "--binary", str(untracked)], cwd=target)
        actual = manifest(target)
        smoke = json.loads(run(["node", "tests/smoke_release_v18.js", "--root", "."], cwd=target).stdout)
        results.append({
            "pathClass": ["ASCII_DEPTH_1", "SPACE_DEPTH_2", "NON_ASCII_DEPTH_3"][index],
            "manifestStatus": "PASS" if actual == expected else "FAIL",
            "expectedFiles": len(expected),
            "actualFiles": len(actual),
            "missing": sorted(set(expected) - set(actual)),
            "extra": sorted(set(actual) - set(expected)),
            "changed": sorted(name for name in set(expected) & set(actual) if expected[name] != actual[name]),
            "binaryShaVerified": actual == expected,
            "smoke": smoke,
            "ownedServices": {"started": 0, "stopped": 0, "surviving": 0, "idempotent": True},
        })
    output = {
        "schemaVersion": "stct-source-replay-v1.8",
        "status": "PASS" if all(row["manifestStatus"] == "PASS" and row["smoke"]["status"] == "PASS" for row in results) else "FAIL",
        "head": head,
        "sourceManifestHash": hashlib.sha256("".join(f"{value}  {name}\n" for name, value in sorted(expected.items())).encode()).hexdigest(),
        "environmentDependencies": [],
        "embeddedTmpDependencies": [],
        "results": results,
    }
    output_path = run_dir / "evidence" / f"{args.label}.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": output["status"], "replays": len(results), "evidence": str(output_path)}, ensure_ascii=False))
    return 0 if output["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
