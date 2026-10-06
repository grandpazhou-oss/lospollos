"""Required local scripts/styles must be served by the exact public allowlist."""
from html.parser import HTMLParser
from pathlib import Path
import sys
import unittest
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
from public_resources import public_file


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        value = attrs.get('src') if tag == 'script' else attrs.get('href') if tag == 'link' and attrs.get('rel') == 'stylesheet' else None
        if value and not urlsplit(value).scheme and not value.startswith('//'):
            self.urls.append('/' + value.removeprefix('./').lstrip('/'))


class RequiredAssetTests(unittest.TestCase):
    def test_every_index_script_and_style_is_public(self):
        parser = AssetParser()
        parser.feed((ROOT/'index.html').read_text(encoding='utf-8'))
        self.assertGreater(len(parser.urls), 10)
        for url in parser.urls:
            with self.subTest(url=url):
                self.assertIsNotNone(public_file(url), 'Required page asset is denied by the local server')

    def test_private_resources_and_path_aliases_stay_denied(self):
        for url in ('/.git/config', '/backend/server.py', '/backend/delivery_plan.xlsx',
                    '/data/uc-study-package.json', '/.run/local-trial/web.log',
                    '/../index.html', '/%2e%2e/index.html', '/index.html%00', '/C:/index.html'):
            with self.subTest(url=url):
                self.assertIsNone(public_file(url))


if __name__ == '__main__':
    unittest.main()
