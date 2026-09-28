#!/usr/bin/env bash
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec node "$REPO_ROOT/tests/run_all_v19_p1.js" "$@"
