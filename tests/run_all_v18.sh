#!/usr/bin/env bash
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

exec python3 "$REPO_ROOT/scripts/run_all_v18.py"

