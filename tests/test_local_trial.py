"""Run the isolated local trial entry without touching the regular demo service."""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "local_trial.py"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LocalTrialTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="stct-local-trial-test-")
        self.env = {**os.environ, "STCT_RUN_DIR": self.directory.name}
        self.web_port, self.opt_port = free_port(), free_port()

    def tearDown(self):
        self.command("stop")
        self.directory.cleanup()

    def command(self, action, *args):
        return subprocess.run([sys.executable, str(SCRIPT), action, *map(str, args)], cwd=ROOT,
                              env=self.env, capture_output=True, text=True, timeout=30)

    def start(self):
        return self.command("start", "--web-port", self.web_port, "--opt-port", self.opt_port)

    def state(self):
        return json.loads((Path(self.directory.name) / "trial.json").read_text(encoding="utf-8"))

    def test_protected_ports_rejected_before_launch(self):
        for port in (8787, 8877, 8791):
            for kind in ("--web-port", "--opt-port"):
                result = self.command("start", kind, port)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("受保护端口", result.stderr)
                self.assertFalse((Path(self.directory.name) / "trial.json").exists())

    def test_repeat_start_and_owned_stop(self):
        first = self.start()
        self.assertEqual(first.returncode, 0, first.stderr)
        initial = self.state()
        self.assertEqual(initial["schema"], "stct-local-trial-v1")
        with urllib.request.urlopen(f"http://127.0.0.1:{self.web_port}/index.html", timeout=2) as page:
            self.assertEqual(page.status, 200)
        with urllib.request.urlopen(f"http://127.0.0.1:{self.opt_port}/health", timeout=2) as service:
            self.assertTrue(json.load(service)["dependencies"]["supplyChainReady"])
        repeated = self.start()
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual(self.state(), initial)
        other_port = free_port()
        while other_port in (self.web_port, self.opt_port):
            other_port = free_port()
        changed = self.command("start", "--web-port", other_port, "--opt-port", self.opt_port)
        self.assertNotEqual(changed.returncode, 0)
        self.assertEqual(self.state(), initial)
        stopped = self.command("stop")
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertFalse((Path(self.directory.name) / "trial.json").exists())

    def test_foreign_port_and_mismatched_pid_record_are_not_stopped(self):
        foreign_port = free_port()
        foreign = subprocess.Popen([sys.executable, "-m", "http.server", str(foreign_port), "--bind", "127.0.0.1"],
                                   cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            attempt = self.command("start", "--web-port", foreign_port, "--opt-port", self.opt_port)
            self.assertNotEqual(attempt.returncode, 0)
            self.assertIsNone(foreign.poll(), "foreign listener was stopped")
            self.assertFalse((Path(self.directory.name) / "trial.json").exists())
        finally:
            foreign.terminate()
            foreign.wait(timeout=3)
        self.assertEqual(self.start().returncode, 0)
        state_file = Path(self.directory.name) / "trial.json"
        state = self.state()
        original_start = state["optimizer"]["started"]
        state["optimizer"]["started"] = "mismatched-start-time"
        state_file.write_text(json.dumps(state), encoding="utf-8")
        refused = self.command("stop")
        self.assertNotEqual(refused.returncode, 0)
        self.assertTrue(state_file.exists())
        with urllib.request.urlopen(f"http://127.0.0.1:{self.opt_port}/health", timeout=2) as service:
            self.assertEqual(service.status, 200)
        state["optimizer"]["started"] = original_start
        state_file.write_text(json.dumps(state), encoding="utf-8")
        self.assertEqual(self.command("stop").returncode, 0)


if __name__ == "__main__":
    unittest.main()
