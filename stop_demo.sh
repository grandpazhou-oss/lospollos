#!/bin/bash
set -euo pipefail
for port in 8765 8787; do
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "停止端口 $port: $pids"
    kill $pids 2>/dev/null || true
  else
    echo "端口 $port 没有运行中的服务"
  fi
done
