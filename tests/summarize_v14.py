#!/usr/bin/env python3
"""Build the v1.4 four-state test summary."""

from __future__ import annotations

import json
import pathlib
import sys


tsv_path = pathlib.Path(sys.argv[1])
json_path = pathlib.Path(sys.argv[2])
text_path = pathlib.Path(sys.argv[3])
mode = sys.argv[4]
allowed = {"PASS", "FAIL", "SKIPPED_DEPENDENCY", "BLOCKED_ENVIRONMENT"}
rows = []
for line in tsv_path.read_text(encoding="utf-8").splitlines():
    if not line:
        continue
    name, status, exit_code, evidence = line.split("\t", 3)
    if status not in allowed:
        raise SystemExit(f"Unknown suite status: {status}")
    rows.append({"suite": name, "status": status, "exitCode": int(exit_code), "evidence": evidence})

counts = {status: sum(row["status"] == status for row in rows) for status in sorted(allowed)}
failed = counts["FAIL"] > 0 or counts["BLOCKED_ENVIRONMENT"] > 0
if mode == "release" and counts["SKIPPED_DEPENDENCY"] > 0:
    failed = True
summary = {
    "version": "v1.4-trust-closure-mission-control",
    "mode": mode,
    "status": "FAIL" if failed else "PASS",
    "counts": counts,
    "suites": rows,
}
json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
lines = [
    f"STCT v1.4 {mode} tests: {summary['status']}",
    "  ".join(f"{key} {value}" for key, value in counts.items()),
]
lines.extend(f"{row['status']:22} {row['suite']:30} {row['evidence']}" for row in rows)
text_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
