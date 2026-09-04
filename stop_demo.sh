#!/usr/bin/env bash
set -u

APP_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${STCT_RUN_DIR:-$APP_DIR/.run}"

stop_process() {
  local name="$1" pid_file="$2" port_file="$3"
  if [ ! -f "$pid_file" ]; then
    echo "$name 未由本项目启动或已经停止"
    rm -f "$port_file"
    return 0
  fi

  local pid port command
  pid="$(tr -cd '0-9' < "$pid_file")"
  port="$(cat "$port_file" 2>/dev/null || true)"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    echo "$name PID 已失效，清理记录"
    rm -f "$pid_file" "$port_file"
    return 0
  fi

  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if ! printf '%s' "$command" | grep -F -- "$APP_DIR" >/dev/null 2>&1; then
    echo "警告：PID $pid 不属于当前项目，未停止。"
    rm -f "$pid_file" "$port_file"
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  local i
  for ((i=1; i<=30; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "警告：$name PID $pid 未在等待时间内退出，请人工检查。"
  else
    echo "$name 已停止：PID $pid${port:+，端口 $port}"
  fi
  rm -f "$pid_file" "$port_file"
}

stop_process "页面服务" "$RUN_DIR/web.pid" "$RUN_DIR/web.port"
stop_process "优化服务" "$RUN_DIR/optimizer.pid" "$RUN_DIR/optimizer.port"
exit 0
