"""Manifest verifies transitive solver runtime, launcher and frontend pin as one source identity."""
import json
import re
import runpy
import shutil
import tempfile
import unittest
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from optimizer.build_identity import MANIFEST, build_manifest, verified_identity


class BuildFingerprintTests(unittest.TestCase):
    def test_frontend_expectation_matches_verified_runtime_and_launcher(self):
        manifest = verified_identity(ROOT)
        match = re.search(r"expectedOptimizerBuildFingerprint:'([0-9a-f]{64})'", (ROOT / 'config.js').read_text())
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), manifest['fingerprint'])
        launcher = runpy.run_path(str(ROOT / 'scripts/local_trial.py'))
        self.assertEqual(launcher['expected_build'](), manifest['fingerprint'])
        self.assertIn("optimizerBuildPolicy:'STRICT_PINNED'", (ROOT/'config.js').read_text())
        self.assertIn('optimizer/supply_chain_job_worker_v6.py', [row['path'] for row in manifest['files']])

    def test_mutations_missing_files_and_extra_runtime_code_are_rejected(self):
        original = verified_identity(ROOT)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for item in original['files'] + [{'path': MANIFEST}]:
                target = root/item['path'];target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT/item['path'], target)
            self.assertEqual(verified_identity(root), original)
            worker = root/'optimizer/supply_chain_job_worker_v6.py'
            before = worker.read_bytes()
            worker.write_bytes(before+b'\n# mutation\n')
            self.assertNotEqual(build_manifest(root)['fingerprint'], original['fingerprint'])
            with self.assertRaisesRegex(RuntimeError,'BUILD_MANIFEST_MISMATCH'):verified_identity(root)
            worker.write_bytes(before)
            worker.unlink()
            with self.assertRaises(RuntimeError):verified_identity(root)
            worker.write_bytes(before)
            extra=root/'optimizer/unregistered.py';extra.write_text('pass\n')
            with self.assertRaisesRegex(RuntimeError,'BUILD_MANIFEST_MISMATCH'):verified_identity(root)
            extra.unlink()
            data=json.loads((root/MANIFEST).read_text());data['files'][0]['sha256']='0'*64
            (root/MANIFEST).write_text(json.dumps(data))
            with self.assertRaisesRegex(RuntimeError,'BUILD_MANIFEST_MISMATCH'):verified_identity(root)


if __name__ == '__main__':unittest.main()
