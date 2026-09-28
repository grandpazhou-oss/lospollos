#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec node tests/run_all_v19_p2.js "$@"
