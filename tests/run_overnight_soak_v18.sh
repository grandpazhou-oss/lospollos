#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_DIR=${STCT_V18_RUN_DIR:-${TMPDIR:-/tmp}/stct-v18-overnight}
DURATION_SECONDS=${STCT_SOAK_DURATION_SECONDS:-21600}
CYCLE_SECONDS=${STCT_SOAK_CYCLE_SECONDS:-180}
TARGET_SECONDS=${STCT_SOAK_TARGET_SECONDS:-28800}

exec node --expose-gc "$ROOT/tests/run_overnight_soak_v18.js" \
  --run-dir "$RUN_DIR" \
  --duration-seconds "$DURATION_SECONDS" \
  --cycle-seconds "$CYCLE_SECONDS" \
  --target-seconds "$TARGET_SECONDS"
