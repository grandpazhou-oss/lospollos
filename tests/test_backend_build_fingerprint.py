import ast
import hashlib
import re
import runpy
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_FILES = (
    "ortools_service.py",
    "canonical_contract.py",
    "facility_mvp1.py",
    "supply_chain_joint_v19.py",
    "supply_chain_jobs_v6.py",
)


class BuildFingerprintTests(unittest.TestCase):
    def test_service_and_launcher_use_the_same_ordered_scope(self):
        for path, variable in (
            (ROOT / "optimizer" / "ortools_service.py", "_BUILD_FILES"),
            (ROOT / "scripts" / "local_trial.py", "BUILD_FILES"),
        ):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            declarations = [
                ast.literal_eval(node.value)
                for node in tree.body
                if isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == variable for target in node.targets)
            ]
            self.assertEqual(declarations, [BUILD_FILES], str(path))

    def test_frontend_expectation_matches_local_backend_source(self):
        source = (ROOT / "config.js").read_text(encoding="utf-8")
        match = re.search(r"expectedOptimizerBuildFingerprint:'([0-9a-f]{64})'", source)
        self.assertIsNotNone(match)
        actual = hashlib.sha256(b"".join(
            name.encode("utf-8") + b"\0" + (ROOT / "optimizer" / name).read_bytes()
            for name in BUILD_FILES
        )).hexdigest()
        self.assertEqual(match.group(1), actual)
        launcher = runpy.run_path(str(ROOT / "scripts" / "local_trial.py"))
        self.assertEqual(launcher["expected_build"](), actual)


if __name__ == "__main__":
    unittest.main()
