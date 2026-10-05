#!/usr/bin/env python3
"""Loopback-only static trial server, shared by the Mac and Windows launcher."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from public_resources import public_file

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".css": "text/css"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        if public_file(self.path) is None:
            self.send_error(404, "Resource is not public")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be in 1024–65535")
    with Server(("127.0.0.1", args.port), Handler) as server:
        server.serve_forever()
