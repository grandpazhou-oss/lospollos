#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node tests/run_all_v19_p3.js "$@"
