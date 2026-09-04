#!/usr/bin/env python3
"""Build machine-readable and text summaries for the v1.3 test runner."""

from __future__ import annotations

import json
import pathlib
import sys


tsv_path = pathlib.Path(sys.argv[1])
json_path = pathlib.Path(sys.argv[2])
text_path = pathlib.Path(sys.argv[3])
rows = []
for line in tsv_path.read_text(encoding="utf-8").splitlines():
    if not line:
        continue
    name, status, exit_code, evidence = line.split("\t", 3)
    rows.append({"suite": name, "status": status, "exitCode": int(exit_code), "evidence": evidence})
summary = {
    "status": "FAIL" if any(row["status"] == "FAIL" for row in rows) else "PASS",
    "pass": sum(row["status"] == "PASS" for row in rows),
    "fail": sum(row["status"] == "FAIL" for row in rows),
    "skip": sum(row["status"].startswith("SKIPPED") for row in rows),
    "suites": rows,
}
json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
lines = [f"STCT v1.3 tests: {summary['status']}", f"PASS {summary['pass']}  FAIL {summary['fail']}  SKIP {summary['skip']}"]
lines.extend(f"{row['status']:20} {row['suite']:28} {row['evidence']}" for row in rows)
text_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
