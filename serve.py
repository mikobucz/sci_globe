#!/usr/bin/env python3
"""Local dev server for MathMap on port 3000 with GET/POST support for public/presets.json."""

import http.server
import json
import os
import socketserver

PORT = 3000
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
PRESETS_PATH = os.path.join(PUBLIC_DIR, "presets.json")


class MathMapHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        # Disable caching for .wasm, .js, and presets.json during development
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

    def do_POST(self):
        if self.path == "/api/presets":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw_body = self.rfile.read(length).decode("utf-8")
                data = json.loads(raw_body)
                with open(PRESETS_PATH, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), MathMapHandler) as httpd:
        print(f"Serving MathMap on http://localhost:{PORT} (with /api/presets sync)")
        httpd.serve_forever()

