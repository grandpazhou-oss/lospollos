"""Bounded, cancellable jobs for the local supply-chain UI."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path


TERMINAL = {"COMPLETE", "PARTIAL", "CANCELLED", "FAILED"}
HASH = re.compile(r"sha256:[0-9a-f]{64}\Z")
SCHEMAS = {"JOINT": ("stct-supply-chain-joint-request-v1", "stct-supply-chain-joint-request-v2"), "FACILITY": ("stct-facility-solve-request-v1.9-mvp1",)}
RESULT_SCHEMAS = {"JOINT": "stct-supply-chain-joint-result-v1", "FACILITY": "stct-facility-solve-result-v1.9-mvp1"}
MAX_EVENT_CHARS = 32_000_000


class JobError(Exception):
    def __init__(self, code: str, status: int = 400):
        self.code = code
        self.status = status
        super().__init__(code)


def _number(value, minimum, maximum):
    return type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum


def validate_spec(spec):
    """Validate the job envelope before any request is accepted or worker is created."""
    if not isinstance(spec, dict) or spec.get("schemaVersion") != "stct-supply-chain-run-v6":
        raise JobError("SUPPLY_JOB_SPEC_INVALID")
    for field in ("studyHash", "scenarioHash", "runSpecHash"):
        if not isinstance(spec.get(field), str) or not HASH.fullmatch(spec[field]):
            raise JobError("SUPPLY_JOB_HASH_INVALID")
    if spec.get("modelVersion") != "v6-cp-sat-1":
        raise JobError("SUPPLY_JOB_MODEL_VERSION_INVALID")
    budget = spec.get("budgetSeconds")
    declared = spec.get("declaredBudgetSeconds", budget)
    preparation = spec.get("preparationSeconds", 0)
    if not _number(budget, 1, 300) or not _number(declared, 1, 300) or not _number(preparation, 0, 300) or budget > declared or abs(budget + preparation - declared) > 0.001:
        raise JobError("SUPPLY_JOB_BUDGET_INVALID")
    requests = spec.get("requests")
    if not isinstance(requests, list) or not 1 <= len(requests) <= 2:
        raise JobError("SUPPLY_JOB_REQUEST_INVALID")
    phases = []
    for row in requests:
        if not isinstance(row, dict) or not isinstance(row.get("kind"), str) or row["kind"] not in SCHEMAS or row.get("phase") not in ("CANDIDATES", "PLANNING_REFERENCE") or not isinstance(row.get("payload"), dict):
            raise JobError("SUPPLY_JOB_REQUEST_INVALID")
        payload = row["payload"]
        if payload.get("schemaVersion") not in SCHEMAS[row["kind"]] or not isinstance(payload.get("requestId"), str) or not 1 <= len(payload["requestId"]) <= 128:
            raise JobError("SUPPLY_JOB_PAYLOAD_INVALID")
        if payload.get("studyHash") != spec["studyHash"]:
            raise JobError("SUPPLY_JOB_STUDY_MISMATCH")
        if row["phase"] == "PLANNING_REFERENCE" and (row["kind"] != "JOINT" or payload.get("scope") != "FULL_CHAIN" or payload.get("reference") is not True):
            raise JobError("SUPPLY_JOB_PHASE_INVALID")
        if row["phase"] == "CANDIDATES" and payload.get("reference") is True:
            raise JobError("SUPPLY_JOB_PHASE_INVALID")
        phases.append(row["phase"])
    if phases not in (["CANDIDATES"], ["PLANNING_REFERENCE", "CANDIDATES"]):
        raise JobError("SUPPLY_JOB_PHASE_INVALID")
    if len(requests) == 2 and (requests[1]["kind"] != "JOINT" or requests[1]["payload"].get("scope") != "FULL_CHAIN"):
        raise JobError("SUPPLY_JOB_PHASE_INVALID")
    if len(requests) == 2 and (requests[0]["payload"].get("quantityScale", 10000) != requests[1]["payload"].get("quantityScale", 10000)):
        raise JobError("SUPPLY_JOB_QUANTITY_SCALE_MISMATCH")
    try:
        # Reject non-finite numbers and detach the worker input from caller-owned objects.
        spec = json.loads(json.dumps(spec, ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError, OverflowError, RecursionError):
        raise JobError("SUPPLY_JOB_SPEC_INVALID")
    return spec


def validate_payloads(spec):
    try:
        try:
            from facility_mvp1 import _validate as validate_facility
            from supply_chain_joint_v19 import _validate as validate_joint
        except ImportError:
            from optimizer.facility_mvp1 import _validate as validate_facility
            from optimizer.supply_chain_joint_v19 import _validate as validate_joint
        for row in spec["requests"]:
            (validate_joint if row["kind"] == "JOINT" else validate_facility)(row["payload"])
    except Exception as exc:
        code = getattr(exc, "code", None)
        raise JobError(code if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,95}", code) else "SUPPLY_JOB_PAYLOAD_INVALID")


def check_dependencies():
    if os.environ.get("DISABLE_ORTOOLS", "").strip().lower() in {"1", "true", "yes"}:
        raise JobError("ORTOOLS_UNAVAILABLE", 503)
    try:
        from ortools.sat.python import cp_model  # noqa: F401 - load before accepting work
    except Exception:
        raise JobError("ORTOOLS_UNAVAILABLE", 503)


def _diagnostic(line):
    """Keep traceback structure, never echo arbitrary stderr containing business inputs."""
    line = line.strip()
    if not line:
        return ""
    match = re.fullmatch(r'File ".*[/\\]([a-zA-Z0-9_]+\.py)", line (\d+), in ([a-zA-Z0-9_<>]+)', line)
    if match:
        return f"File {match[1]}, line {match[2]}, in {match[3]}"
    match = re.match(r"([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception|Interrupt|Exit))(?::|$)", line)
    if match:
        return match[1] + ": [detail redacted]"
    if line == "Traceback (most recent call last):":
        return line
    return "[stderr content redacted]"


class JobManager:
    def __init__(self):
        self.lock = threading.RLock()
        self.jobs = {}
        self.active_id = None

    def start(self, spec):
        spec = validate_spec(spec)
        check_dependencies()
        validate_payloads(spec)
        # Declared budget is a business input; measured preparation time is not.
        identity = {"studyHash": spec["studyHash"], "scenarioHash": spec["scenarioHash"], "declaredBudgetSeconds": spec.get("declaredBudgetSeconds", spec["budgetSeconds"]), "modelVersion": spec["modelVersion"], "requests": [{"kind": row["kind"], "phase": row["phase"], "payload": {key: value for key, value in row["payload"].items() if key != "requestId"}} for row in spec["requests"]]}
        server_key = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()
        with self.lock:
            if self.active_id:
                active = self.jobs[self.active_id]
                if active["serverKey"] == server_key:
                    return self._public(active)
                raise JobError("SUPPLY_JOB_BUSY", 429)
            completed = sorted((row for row in self.jobs.values() if row["completedAt"]), key=lambda row: row["completedAt"])
            for old in completed[:-15]:
                self.jobs.pop(old["jobId"], None)
            job_id = uuid.uuid4().hex
            job = {"jobId": job_id, "runSpecHash": spec["runSpecHash"], "serverKey": server_key, "studyHash": spec["studyHash"], "scenarioHash": spec["scenarioHash"], "modelVersion": spec["modelVersion"], "acceptedRequestIds": {row["phase"]: row["payload"]["requestId"] for row in spec["requests"]}, "status": "PREPARING", "phase": "PREPARING", "createdAt": time.time(), "startedAt": None, "completedAt": None, "budgetSeconds": spec["budgetSeconds"], "declaredBudgetSeconds": spec.get("declaredBudgetSeconds", spec["budgetSeconds"]), "elapsedSeconds": 0, "feasible": 0, "currentCount": None, "currentRank": None, "results": {}, "error": None, "pid": None, "process": None, "cancelRequested": False, "timeoutRequested": False, "stderrTail": "", "exitCode": None}
            self.jobs[job_id] = job
            self.active_id = job_id
            threading.Thread(target=self._run, args=(job, spec), daemon=True).start()
            return self._public(job)

    def _public(self, job, include_results=False):
        value = {key: item for key, item in job.items() if key not in {"process", "cancelRequested", "timeoutRequested", "results", "serverKey"}}
        value["resultPhases"] = list(job["results"])
        if include_results:
            value["results"] = job["results"]
        return copy.deepcopy(value)

    def get(self, job_id, include_results=False):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise JobError("SUPPLY_JOB_NOT_FOUND", 404)
            value = self._public(job, include_results)
            if job["startedAt"] and not job["completedAt"]:
                value["elapsedSeconds"] = round(time.time()-job["startedAt"], 3)
            return value

    @staticmethod
    def _stop(process):
        if process and process.poll() is None:
            try:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
            except ProcessLookupError:
                pass

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise JobError("SUPPLY_JOB_NOT_FOUND", 404)
            if job["status"] in TERMINAL:
                return self._public(job)
            job["cancelRequested"] = True
            process = job["process"]
        self._stop(process)
        with self.lock:
            job["status"] = "CANCELLED"
            job["phase"] = "CANCELLED"
            job["completedAt"] = job["completedAt"] or time.time()
            if self.active_id == job_id:
                self.active_id = None
            return self._public(job)

    def _stderr(self, job, stream):
        for line in iter(lambda: stream.readline(4096), ""):
            safe = _diagnostic(line)
            if safe:
                with self.lock:
                    job["stderrTail"] = (job["stderrTail"] + safe + "\n")[-4096:]

    def _run(self, job, spec):
        process = timer = reader = None
        started = complete = exhausted = False
        failed = failed_exception = None
        expected = {row["phase"]: row for row in spec["requests"]}
        active_phase = None
        try:
            with self.lock:
                if job["cancelRequested"]:
                    return
                process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("supply_chain_job_worker_v6.py"))], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", bufsize=1, cwd=Path(__file__).parent, start_new_session=True)
                job["process"] = process
                job["pid"] = process.pid
                job["startedAt"] = time.time()
            reader = threading.Thread(target=self._stderr, args=(job, process.stderr), daemon=True)
            reader.start()
            timer = threading.Timer(float(spec["budgetSeconds"])+3, lambda: self._timeout(job["jobId"]))
            timer.daemon = True
            timer.start()
            process.stdin.write(json.dumps(spec, ensure_ascii=False, allow_nan=False))
            process.stdin.close()
            for line in iter(lambda: process.stdout.readline(MAX_EVENT_CHARS+1), ""):
                if len(line) > MAX_EVENT_CHARS:
                    raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INVALID")
                try:
                    event = json.loads(line, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
                except (ValueError, RecursionError):
                    raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INVALID")
                with self.lock:
                    if job["cancelRequested"] or job["timeoutRequested"]:
                        continue
                    if not isinstance(event, dict) or complete or failed:
                        raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INVALID")
                    kind = event.get("event")
                    if kind == "FAILED":
                        error = event.get("error")
                        code = error.get("code") if isinstance(error, dict) else None
                        failed = code if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,95}", code) else "SUPPLY_JOB_WORKER_FAILED"
                        detail = error.get("detail") if isinstance(error, dict) else None
                        exception = detail.get("exception") if isinstance(detail, dict) else None
                        if isinstance(exception, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", exception):
                            failed_exception = exception
                    elif kind == "STARTED" and not started:
                        started = True
                        job["status"] = "SOLVING"
                    elif not started:
                        raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INVALID")
                    elif kind == "PHASE":
                        phase = event.get("phase")
                        index = len(job["results"])
                        if index >= len(spec["requests"]) or phase != spec["requests"][index]["phase"] or active_phase is not None:
                            raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INVALID")
                        active_phase = phase
                        job["phase"] = phase
                    elif kind == "PROGRESS":
                        if active_phase is None or event.get("phase") != active_phase or not _number(event.get("feasible", 0), 0, 10000) or any(event.get(key) is not None and (type(event[key]) is not int or not 1 <= event[key] <= 10000) for key in ("facilityCount", "rank")):
                            raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INVALID")
                        job["currentCount"] = event.get("facilityCount")
                        job["currentRank"] = event.get("rank")
                        job["feasible"] = sum(value.get("feasible", 0) for value in job["results"].values())+event.get("feasible", 0)
                    elif kind == "RESULT":
                        phase, result = event.get("phase"), event.get("result")
                        if phase != active_phase or phase not in expected or phase in job["results"] or not isinstance(result, dict):
                            raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INVALID")
                        item = expected[phase]
                        if result.get("schemaVersion") != RESULT_SCHEMAS[item["kind"]] or result.get("studyHash") != spec["studyHash"] or result.get("requestId") != item["payload"]["requestId"] or not isinstance(result.get("results"), list) or any(not isinstance(row, dict) for row in result["results"]) or not _number(result.get("feasible", 0), 0, 10000):
                            raise JobError("SUPPLY_JOB_WORKER_RESULT_INVALID")
                        job["results"][phase] = result
                        job["feasible"] = sum(value.get("feasible", sum(row.get("status") in {"OPTIMAL", "FEASIBLE"} for row in value["results"])) for value in job["results"].values())
                        active_phase = None
                    elif kind == "BUDGET_EXHAUSTED":
                        exhausted = True
                    elif kind == "COMPLETE":
                        if active_phase is not None or (len(job["results"]) != len(expected) and not exhausted):
                            raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INCOMPLETE")
                        complete = True
                    else:
                        raise JobError("SUPPLY_JOB_WORKER_PROTOCOL_INVALID")
            process.wait(timeout=2)
        except Exception as exc:
            failed = exc.code if isinstance(exc, JobError) else "SUPPLY_JOB_WORKER_FAILED"
        finally:
            if timer:
                timer.cancel()
            self._stop(process)
            if reader:
                reader.join(timeout=2)
            with self.lock:
                job["exitCode"] = process.returncode if process else None
                stage = job["phase"]
                if job["cancelRequested"]:
                    job["status"] = "CANCELLED"
                    job["phase"] = "CANCELLED"
                elif job["timeoutRequested"]:
                    job["status"] = "PARTIAL"
                    job["phase"] = "BUDGET_EXHAUSTED"
                    failed = "SUPPLY_JOB_BUDGET_EXHAUSTED"
                elif failed or not process or process.returncode != 0 or not complete:
                    job["status"] = "FAILED"
                    failed = failed or ("SUPPLY_JOB_WORKER_EXITED" if not process or process.returncode != 0 else "SUPPLY_JOB_WORKER_PROTOCOL_INCOMPLETE")
                else:
                    partial = exhausted or any(result.get("budgetExhausted") or any(row.get("status") in {"TIME_LIMIT", "FEASIBLE"} for row in result["results"]) for result in job["results"].values())
                    job["status"] = "PARTIAL" if partial else "COMPLETE"
                if failed and not job["cancelRequested"]:
                    job["error"] = {"code": failed, "detail": {"exitCode": job["exitCode"], "stage": stage, "stderrTail": job["stderrTail"], "exception": failed_exception}}
                job["completedAt"] = job["completedAt"] or time.time()
                job["elapsedSeconds"] = round(job["completedAt"]-(job["startedAt"] or job["createdAt"]), 3)
                job["process"] = None
                if self.active_id == job["jobId"]:
                    self.active_id = None
            for stream in (getattr(process, "stdin", None), getattr(process, "stdout", None), getattr(process, "stderr", None)):
                if stream:
                    stream.close()

    def _timeout(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job["completedAt"] or job["cancelRequested"]:
                return
            job["timeoutRequested"] = True
            process = job["process"]
        self._stop(process)


JOBS = JobManager()
