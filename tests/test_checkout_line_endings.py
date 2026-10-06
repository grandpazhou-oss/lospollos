"""Repository normalization is distinct from Windows workstation acceptance."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CheckoutLineEndingsTests(unittest.TestCase):
    def test_windows_entrypoints_are_normalized_in_git_and_crlf_in_checkout(self):
        for name in ('start_windows.cmd', 'stop_windows.cmd'):
            with self.subTest(path=name):
                blob = subprocess.check_output(['git', 'show', ':' + name], cwd=ROOT)
                self.assertNotIn(b'\r', blob, 'Git index must store normalized LF text')
                checkout = (ROOT / name).read_bytes()
                self.assertEqual(checkout.replace(b'\r\n', b'\n'), blob)
                self.assertIn(b'\r\n', checkout, 'eol=crlf must produce a Windows-compatible checkout')
                self.assertNotIn(b'\r\r\n', checkout)


if __name__ == '__main__':
    unittest.main()
