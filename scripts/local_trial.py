#!/usr/bin/env python3
"""Isolated local trial launcher; existing macOS demo scripts remain unchanged."""

import argparse
import json
import hashlib
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "stct-local-trial-v1"
LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PROTECTED_PORTS = frozenset((8787, 8877, 8791))
sys.path.insert(0, str(ROOT))
from optimizer.build_identity import verified_identity


def expected_build():
    return verified_identity(ROOT)["fingerprint"]


def run_dir():
    if os.environ.get("STCT_RUN_DIR"):
        return Path(os.environ["STCT_RUN_DIR"]).expanduser().resolve()
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "STCT" / "local-trial"
    return ROOT / ".run" / "local-trial"


def process_info(pid):
    if os.name == "nt":
        command = ("$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + str(pid) +
                   "' -ErrorAction Stop; if($p){@{started=[string]$p.CreationDate;" +
                   "command=[string]$p.CommandLine} | ConvertTo-Json -Compress}")
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                                capture_output=True, text=True, timeout=8, check=True)
        return json.loads(result.stdout) if result.stdout.strip() else None
    started = subprocess.run(["ps", "-p", str(pid), "-o", "lstart="], capture_output=True, text=True)
    if started.returncode or not started.stdout.strip():
        return None
    command = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True)
    if command.returncode or not command.stdout.strip():
        return None
    return {"started": started.stdout.strip(), "command": command.stdout.strip()}


def ownership(record, kind):
    info = process_info(record["pid"])
    if info is None:
        return "MISSING"
    command = info["command"].casefold().replace("/", "\\")
    root = str(ROOT).casefold().replace("/", "\\")
    expected = ("http.server", "local_web.py") if kind == "web" else ("ortools_service.py",)
    if info["started"] != record["started"] or root not in command or not any(value in command for value in expected):
        return "FOREIGN"
    return "OWNED"


def port_free(port):
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def get_json(url):
    with LOCAL_HTTP.open(url, timeout=1) as response:
        return json.load(response)


def ready(web_port, opt_port):
    try:
        with LOCAL_HTTP.open(f"http://127.0.0.1:{web_port}/index.html", timeout=1) as response:
            if response.status != 200 or response.read() != (ROOT / "index.html").read_bytes():
                return False
        health = get_json(f"http://127.0.0.1:{opt_port}/health")
        return health.get("endpoint") == f"http://127.0.0.1:{opt_port}" and health.get("dependencies", {}).get("supplyChainReady") is True and health.get("supplyChainJobsV6") is True and health.get("buildFingerprint") == expected_build()
    except (OSError, ValueError, KeyError):
        return False


def spawn(args, log_path, env=None):
    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
    with log_path.open("ab", buffering=0) as log:
        return subprocess.Popen(args, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=env, **options)


def stop_started(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


def start(args):
    if PROTECTED_PORTS.intersection((args.web_port, args.opt_port)):
        raise RuntimeError("隔离入口拒绝使用受保护端口 8787/8877/8791；未启动或停止任何进程")
    if args.web_port == args.opt_port or any(port < 1024 or port > 65535 for port in (args.web_port, args.opt_port)):
        raise RuntimeError("两个端口必须不同，且处于 1024–65535 范围内")
    directory = run_dir()
    directory.mkdir(parents=True, exist_ok=True)
    state_file = directory / "trial.json"
    if state_file.exists():
        state = json.loads(state_file.read_text(encoding="utf-8"))
        if state.get("schema") != SCHEMA or state.get("root") != str(ROOT):
            raise RuntimeError("运行记录不属于当前项目；未覆盖或停止任何进程")
        owners = [ownership(state[kind], kind) for kind in ("web", "optimizer")]
        if owners == ["OWNED", "OWNED"] and ready(state["web"]["port"], state["optimizer"]["port"]):
            if (args.web_port, args.opt_port) != (state["web"]["port"], state["optimizer"]["port"]):
                raise RuntimeError("试用服务已在其他端口运行；请先运行 stop_windows.cmd 再更换端口")
            print(f"试用服务已运行：http://127.0.0.1:{state['web']['port']}/index.html?optPort={state['optimizer']['port']}#/")
            return
        if "OWNED" in owners:
            raise RuntimeError("存在本试用实例的部分进程；请先运行 stop_windows.cmd 或本脚本 stop")
        state_file.unlink()
    if not port_free(args.web_port) or not port_free(args.opt_port):
        raise RuntimeError("所选端口已被占用；没有停止占用端口的进程")
    web = optimizer = None
    try:
        web = spawn([sys.executable, str(ROOT / "scripts" / "local_web.py"), "--port", str(args.web_port)], directory / "web.log")
        optimizer = spawn([sys.executable, str(ROOT / "optimizer" / "ortools_service.py")], directory / "optimizer.log", {**os.environ, "OPT_PORT": str(args.opt_port)})
        for _ in range(100):
            if web.poll() is not None or optimizer.poll() is not None:
                break
            if ready(args.web_port, args.opt_port):
                break
            time.sleep(.1)
        else:
            raise RuntimeError("页面或原生求解服务未在 10 秒内就绪；请查看试用日志")
        if not ready(args.web_port, args.opt_port):
            raise RuntimeError("页面或原生求解服务未就绪；请查看试用日志")
        web_info, optimizer_info = process_info(web.pid), process_info(optimizer.pid)
        if not web_info or not optimizer_info:
            raise RuntimeError("无法确认试用服务的进程身份；未保存运行记录")
        state = {"schema": SCHEMA, "root": str(ROOT), "backendBuildFingerprint": expected_build(), "web": {"pid": web.pid, "started": web_info["started"], "port": args.web_port}, "optimizer": {"pid": optimizer.pid, "started": optimizer_info["started"], "port": args.opt_port}}
        temporary = directory / "trial.json.tmp"
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(state_file)
        url = f"http://127.0.0.1:{args.web_port}/index.html?optPort={args.opt_port}#/"
        print(f"受控本地试用已启动：{url}\n日志目录：{directory}")
        if args.open:
            webbrowser.open(url)
    except Exception:
        for process in (optimizer, web):
            if process:
                stop_started(process)
        raise


def stop():
    state_file = run_dir() / "trial.json"
    if not state_file.exists():
        print("未找到本试用实例的运行记录；未停止任何进程")
        return
    state = json.loads(state_file.read_text(encoding="utf-8"))
    if state.get("schema") != SCHEMA or state.get("root") != str(ROOT):
        raise RuntimeError("运行记录不属于当前项目；未停止任何进程")
    for kind in ("optimizer", "web"):
        record = state[kind]
        status = ownership(record, kind)
        if status == "FOREIGN":
            raise RuntimeError(f"PID {record['pid']} 身份不匹配；未停止该进程，运行记录已保留")
        if status == "MISSING":
            continue
        if os.name == "nt":
            subprocess.run(["taskkill.exe", "/PID", str(record["pid"]), "/T", "/F"], check=True, capture_output=True, text=True, timeout=8)
        else:
            if os.getpgid(record["pid"]) != record["pid"]:
                raise RuntimeError("进程组身份不匹配；未停止该进程")
            os.killpg(record["pid"], signal.SIGTERM)
        for _ in range(30):
            if ownership(record, kind) == "MISSING":
                break
            time.sleep(.1)
        else:
            raise RuntimeError(f"PID {record['pid']} 未确认退出；运行记录已保留")
    state_file.unlink()
    print("本试用实例已停止；其他服务未受影响")


def main():
    parser = argparse.ArgumentParser(description="STCT 隔离本地试用")
    subcommands = parser.add_subparsers(dest="action", required=True)
    start_command = subcommands.add_parser("start")
    start_command.add_argument("--web-port", type=int, default=8865)
    start_command.add_argument("--opt-port", type=int, default=8887)
    start_command.add_argument("--open", action="store_true")
    subcommands.add_parser("stop")
    args = parser.parse_args()
    try:
        start(args) if args.action == "start" else stop()
    except Exception as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
