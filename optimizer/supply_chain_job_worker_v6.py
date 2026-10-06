"""One isolated local supply-chain run. Protocol: JSON lines on stdout."""

from __future__ import annotations

import json
import os
import sys
import threading
import time



def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def _watch_parent():
    """The manager keeps stdin open until reap; EOF means ownership was lost.

    Exit the whole process, even when a native solve is still running. This is
    portable across POSIX and Windows and never targets an unrelated process.
    """
    try:
        # Use the raw descriptor so a blocked daemon never holds a buffered I/O
        # lock during normal interpreter shutdown.
        while os.read(sys.stdin.fileno(), 1):
            pass
    finally:
        os._exit(1)


def main():
    from supply_chain_jobs_v6 import validate_spec
    spec = validate_spec(json.loads(sys.stdin.readline()))
    threading.Thread(target=_watch_parent, daemon=True).start()
    import ortools
    from ortools.sat.python import cp_model
    from facility_mvp1 import solve_facility
    from supply_chain_joint_v19 import solve_joint
    budget = float(spec["budgetSeconds"])
    deadline = time.monotonic() + budget
    emit({"event": "STARTED", "budgetSeconds": budget})
    for index, item in enumerate(spec["requests"]):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            emit({"event": "BUDGET_EXHAUSTED", "requestIndex": index})
            break
        kind = item["kind"]
        emit({"event": "PHASE", "phase": item["phase"], "requestIndex": index})
        def progress(row):
            emit({"event": "PROGRESS", "phase": item["phase"], "requestIndex": index, **row})
        if kind == "JOINT":
            result = solve_joint(item["payload"], cp_model, ortools.__version__, deadline, progress)
        elif kind == "FACILITY":
            result = solve_facility(item["payload"], cp_model, ortools.__version__, deadline, progress)
        else:
            raise ValueError("Unsupported supply-chain job kind")
        emit({"event": "RESULT", "phase": item["phase"], "requestIndex": index, "result": result})
        if result.get("budgetExhausted"):
            emit({"event": "BUDGET_EXHAUSTED", "requestIndex": index})
            break
    emit({"event": "COMPLETE"})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"event": "FAILED", "error": {"code": getattr(error, "code", "SUPPLY_JOB_FAILED"), "detail": {"exception": type(error).__name__}}})
        sys.exit(1)
