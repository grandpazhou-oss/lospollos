#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${STCT_RUN_DIR:-$APP_DIR/.run}"
LOG_DIR="$RUN_DIR/logs"
WEB_PORT="${WEB_PORT:-8765}"
OPT_PORT="${OPT_PORT:-8787}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || true)}"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "错误：缺少命令 ${name}。"
    exit 1
  fi
}

validate_port() {
  local value="$1" label="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1024 ] || [ "$value" -gt 65535 ]; then
    echo "错误：$label 必须是 1024-65535 之间的端口。"
    exit 1
  fi
}

port_pids() {
  local port="$1"
  if [ "${STCT_FORCE_SOCKET_FALLBACK:-0}" != "1" ] && command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif [ "${STCT_FORCE_SOCKET_FALLBACK:-0}" != "1" ] && command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null | awk 'NR>1 { if (match($0,/pid=[0-9]+/)) print substr($0,RSTART+4,RLENGTH-4); else print "unknown" }' | sort -u
  elif [ "${STCT_FORCE_SOCKET_FALLBACK:-0}" != "1" ] && command -v fuser >/dev/null 2>&1; then
    fuser "$port/tcp" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' || true
  else
    "$PYTHON_BIN" - "$port" <<'PY'
import socket
import sys

port = int(sys.argv[1])
with socket.socket() as sock:
    sock.settimeout(0.2)
    if sock.connect_ex(("127.0.0.1", port)) == 0:
        print("unknown")
PY
  fi
}

owned_pid() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  local pid
  pid="$(tr -cd '0-9' < "$pid_file")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -F -- "$APP_DIR" >/dev/null 2>&1
}

start_process() {
  local name="$1" port="$2" pid_file="$3" port_file="$4" log_file="$5"
  shift 5

  if owned_pid "$pid_file"; then
    local existing_pid existing_port
    existing_pid="$(cat "$pid_file")"
    existing_port="$(cat "$port_file" 2>/dev/null || true)"
    if [ "$existing_port" = "$port" ] && [ -n "$(port_pids "$port")" ]; then
      echo "${name} 已由本项目启动：PID ${existing_pid}，端口 ${port}"
      return 0
    fi
    echo "错误：$name 已由本项目在端口 ${existing_port:-未知} 运行。请先执行 stop_demo.sh。"
    return 1
  fi

  rm -f "$pid_file" "$port_file"
  local occupants
  occupants="$(port_pids "$port")"
  if [ -n "$occupants" ]; then
    echo "错误：端口 ${port} 已被其他进程占用（PID: ${occupants}），未停止该进程。"
    return 1
  fi

  nohup "$@" >"$log_file" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$pid_file"
  printf '%s\n' "$port" > "$port_file"
  echo "${name} 已启动：PID ${pid}，端口 ${port}"
}

wait_http() {
  local url="$1" attempts="${2:-30}"
  local i status
  for ((i=1; i<=attempts; i++)); do
    status="$(curl -sS --max-time 1 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    if [ "$status" = "200" ]; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

[ -n "$PYTHON_BIN" ] || { echo "错误：未找到 python3。"; exit 1; }
require_command curl
validate_port "$WEB_PORT" WEB_PORT
validate_port "$OPT_PORT" OPT_PORT
mkdir -p "$LOG_DIR"

WEB_PID_FILE="$RUN_DIR/web.pid"
WEB_PORT_FILE="$RUN_DIR/web.port"
OPT_PID_FILE="$RUN_DIR/optimizer.pid"
OPT_PORT_FILE="$RUN_DIR/optimizer.port"
WEB_LOG="$LOG_DIR/web.log"
OPT_LOG="$LOG_DIR/optimizer.log"

cleanup_started() {
  local file pid
  for file in "$WEB_PID_FILE" "$OPT_PID_FILE"; do
    if owned_pid "$file"; then
      pid="$(cat "$file")"
      kill "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$WEB_PID_FILE" "$WEB_PORT_FILE" "$OPT_PID_FILE" "$OPT_PORT_FILE"
}
trap cleanup_started ERR

start_process "页面服务" "$WEB_PORT" "$WEB_PID_FILE" "$WEB_PORT_FILE" "$WEB_LOG" \
  "$PYTHON_BIN" -m http.server "$WEB_PORT" --bind 127.0.0.1 --directory "$APP_DIR"

OPT_START_ERROR=""
if ! start_process "优化服务" "$OPT_PORT" "$OPT_PID_FILE" "$OPT_PORT_FILE" "$OPT_LOG" \
  env OPT_PORT="$OPT_PORT" "$PYTHON_BIN" "$APP_DIR/optimizer/ortools_service.py"; then
  OPT_START_ERROR="优化服务未启动或端口不可用"
fi

WEB_URL="http://127.0.0.1:$WEB_PORT/index.html?optPort=$OPT_PORT"
if ! wait_http "http://127.0.0.1:$WEB_PORT/index.html"; then
  echo "错误：页面服务健康检查失败。查看日志：$WEB_LOG"
  exit 1
fi

OPT_HEALTH=""
if [ -z "$OPT_START_ERROR" ]; then
  OPT_HEALTH="$(curl -sS --max-time 2 "http://127.0.0.1:$OPT_PORT/health" 2>/dev/null || true)"
fi

echo
echo "Smart Transportation Control Tower 本地 Demo 已启动"
echo "访问地址：$WEB_URL"
echo "页面状态：HTTP 200"
if [ -n "$OPT_HEALTH" ]; then
  echo "优化服务：$OPT_HEALTH"
else
  echo "优化服务：连接失败；页面将使用 Demo Heuristic"
fi
trap - ERR
echo "PID 目录：$RUN_DIR"
echo "页面日志：$WEB_LOG"
echo "优化日志：$OPT_LOG"
echo "停止命令：bash \"$APP_DIR/stop_demo.sh\""
