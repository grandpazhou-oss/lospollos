"""Check-runner reporting contract, controlled commands; not domain acceptance."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('enterprise_checks', ROOT/'scripts/run_enterprise_checks.py')
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class ReportingTests(unittest.TestCase):
    def execute(self, mode, runner):
        with tempfile.TemporaryDirectory(prefix='stct-check-report-') as output:
            with patch.object(sys, 'argv', ['checks', '--mode', mode, '--output', output]), \
                 patch.object(checks.subprocess, 'run', side_effect=runner), \
                 patch.object(checks.subprocess, 'check_output', side_effect=['a'*40+'\n', ' M intentional-test.js\n']), \
                 contextlib.redirect_stdout(io.StringIO()):
                code = checks.main()
            return code, json.loads((Path(output)/'summary.json').read_text())

    def test_missing_native_dependency_is_blocked_and_selected_checks_not_run(self):
        code, summary = self.execute('native', lambda command, **kw: subprocess.CompletedProcess(command, 1, '', 'ModuleNotFoundError: ortools'))
        self.assertEqual(code, 1)
        self.assertEqual(summary['status'], 'BLOCKED_ENVIRONMENT')
        self.assertEqual(summary['tests'][0]['status'], 'BLOCKED_ENVIRONMENT')
        self.assertEqual(len(summary['tests']), 1+len(checks.NATIVE_JS)+len(checks.NATIVE_PY))
        self.assertTrue(all(t['status']=='NOT_RUN' for t in summary['tests'][1:]))
        self.assertEqual(summary['sourceCommit'], 'a'*40)
        self.assertTrue(summary['sourceDirty'])
        self.assertEqual(summary['sourceChanges'], [' M intentional-test.js'])

    def test_browser_launch_failure_does_not_claim_storage_ran(self):
        def run(command, **kw):
            failed='chromium.launch' in command[-1]
            return subprocess.CompletedProcess(command, 1 if failed else 0, '', 'permission denied' if failed else '')
        code, summary=self.execute('browser', run)
        self.assertEqual(code, 1)
        self.assertEqual(summary['status'], 'BLOCKED_ENVIRONMENT')
        self.assertEqual(summary['tests'][-1]['status'], 'NOT_RUN')

    def test_real_test_failure_remains_fail_after_successful_dependencies(self):
        def run(command, **kw):
            failed=command[-1].endswith('test_enterprise_indexeddb.py')
            return subprocess.CompletedProcess(command, 1 if failed else 0, '', 'AssertionError' if failed else '')
        code, summary=self.execute('browser', run)
        self.assertEqual(code, 1)
        self.assertEqual(summary['status'], 'FAIL')
        self.assertEqual(next(t for t in summary['tests'] if t['name']=='native-indexeddb')['status'], 'FAIL')


if __name__=='__main__': unittest.main()
