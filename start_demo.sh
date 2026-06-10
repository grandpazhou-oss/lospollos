#!/bin/bash
set -euo pipefail

APP_DIR="/Users/gz/Documents/lospollos"
LOG_DIR="$APP_DIR/logs"
WEB_PORT="8765"
OPT_PORT="8787"
PYTHON_BIN="$(command -v python3)"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

stop_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "停止占用端口 $port 的旧服务: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

check_ortools() {
  if ! "$PYTHON_BIN" -c "from ortools.constraint_solver import pywrapcp" >/dev/null 2>&1; then
    echo "错误：当前 python3 未安装 OR-Tools。"
    echo "当前 Python: $PYTHON_BIN"
    echo "请先运行：python3 -m pip install ortools"
    exit 1
  fi
}

stop_port "$WEB_PORT"
stop_port "$OPT_PORT"
check_ortools

nohup "$PYTHON_BIN" -m http.server "$WEB_PORT" > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
nohup "$PYTHON_BIN" "$APP_DIR/optimizer/ortools_service.py" > "$LOG_DIR/ortools.log" 2>&1 &
OPT_PID=$!

sleep 1

WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$WEB_PORT/index.html" || true)
OPT_STATUS=$(curl -s "http://127.0.0.1:$OPT_PORT/health" || true)

echo ""
echo "Smart Transportation Control Tower 已启动"
echo "页面服务 PID: $WEB_PID"
echo "OR-Tools PID: $OPT_PID"
echo ""
echo "打开页面："
echo "http://127.0.0.1:$WEB_PORT/index.html"
echo ""
echo "页面状态: $WEB_STATUS"
echo "OR-Tools 状态: $OPT_STATUS"
echo ""
echo "日志文件："
echo "$LOG_DIR/web.log"
echo "$LOG_DIR/ortools.log"
echo ""
echo "如需停止服务，运行："
echo "bash $APP_DIR/stop_demo.sh"
