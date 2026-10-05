"""One process-wide solver slot shared by jobs and legacy HTTP endpoints.

This is single-process resource governance, not user authentication or a distributed queue.
A lease is released only by its holder, after the actual computation/worker has stopped.
"""
from __future__ import annotations
import threading


class SolverBusy(Exception):
    code = "SUPPLY_JOB_BUSY"
    status = 429


class SolveAdmission:
    def __init__(self):
        self._lock = threading.Lock()
        self._owner: str | None = None

    def acquire(self, owner: str) -> None:
        if not isinstance(owner, str) or not owner:
            raise ValueError("Solver lease owner is required")
        with self._lock:
            if self._owner is not None:
                raise SolverBusy(self._owner)
            self._owner = owner

    def release(self, owner: str) -> None:
        with self._lock:
            if self._owner == owner:
                self._owner = None

    @property
    def busy(self) -> bool:
        with self._lock:
            return self._owner is not None


SOLVE_ADMISSION = SolveAdmission()
