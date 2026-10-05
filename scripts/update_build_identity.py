#!/usr/bin/env python3
"""Regenerate the backend manifest and frontend pin together; --check never writes."""
import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from optimizer.build_identity import MANIFEST, build_manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = build_manifest(ROOT)
    text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    config_path = ROOT / "config.js"
    config = config_path.read_text(encoding="utf-8")
    pattern = r"expectedOptimizerBuildFingerprint:'[a-f0-9]{64}'"
    if len(re.findall(pattern, config)) != 1:
        raise SystemExit("BUILD_FRONTEND_PIN_INVALID")
    updated = re.sub(pattern, "expectedOptimizerBuildFingerprint:'" + manifest["fingerprint"] + "'", config)
    path = ROOT / MANIFEST
    if args.check:
        if not path.is_file() or path.read_text(encoding="utf-8") != text or config != updated:
            raise SystemExit("BUILD_IDENTITY_STALE")
        print("PASS runtime manifest and frontend pin")
    else:
        path.write_text(text, encoding="utf-8")
        config_path.write_text(updated, encoding="utf-8")
        print(manifest["fingerprint"])


if __name__ == "__main__":
    main()
