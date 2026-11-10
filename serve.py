#!/usr/bin/env python3
"""Local dev server for sci_globe on port 3000 with GET/POST support for presets and generated maps."""

import http.server
import json
import os
import re
import socket
import socketserver
import urllib.parse

PORT = 3000
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
PRESETS_PATH = os.path.join(PUBLIC_DIR, "presets.json")
GENERATED_MAPS_PATH = os.path.join(PUBLIC_DIR, "generated_maps.json")
GENERATED_DIR = os.path.join(PUBLIC_DIR, "generated")


def _safe_snapshot_filename(map_id):
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", str(map_id or "")).strip("_")
    return f"{safe or 'snapshot'}.json"


class SciGlobeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        # Disable caching for .wasm, .js, and presets during development
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/presets":
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
        elif parsed.path == "/api/generated_maps":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw_body = self.rfile.read(length).decode("utf-8")
                new_map = json.loads(raw_body)

                snapshot_payload = new_map.pop("snapshot", None)
                if isinstance(snapshot_payload, dict):
                    os.makedirs(GENERATED_DIR, exist_ok=True)
                    snap_name = _safe_snapshot_filename(new_map.get("id"))
                    snap_path = os.path.join(GENERATED_DIR, snap_name)
                    with open(snap_path, "w", encoding="utf-8") as sf:
                        json.dump(snapshot_payload, sf, separators=(",", ":"), ensure_ascii=False)
                    new_map["snapshotFile"] = f"generated/{snap_name}"

                maps = []
                if os.path.exists(GENERATED_MAPS_PATH):
                    with open(GENERATED_MAPS_PATH, "r", encoding="utf-8") as f:
                        maps = json.load(f)

                # Prepend new map
                maps = [m for m in maps if m.get("id") != new_map.get("id")]
                maps.insert(0, new_map)

                with open(GENERATED_MAPS_PATH, "w", encoding="utf-8") as f:
                    json.dump(maps, f, indent=2, ensure_ascii=False)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "snapshotFile": new_map.get("snapshotFile")}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/generated_maps":
            try:
                query = urllib.parse.parse_qs(parsed.query)
                map_id = query.get("id", [None])[0]
                if not map_id:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'{"ok":false,"error":"Missing id parameter"}')
                    return

                maps = []
                if os.path.exists(GENERATED_MAPS_PATH):
                    with open(GENERATED_MAPS_PATH, "r", encoding="utf-8") as f:
                        maps = json.load(f)

                removed = [m for m in maps if m.get("id") == map_id]
                for m in removed:
                    rel_snap = m.get("snapshotFile")
                    if isinstance(rel_snap, str) and rel_snap.startswith("generated/"):
                        abs_snap = os.path.abspath(os.path.join(PUBLIC_DIR, rel_snap))
                        if abs_snap.startswith(os.path.abspath(GENERATED_DIR) + os.sep) and os.path.exists(abs_snap):
                            os.remove(abs_snap)

                maps = [m for m in maps if m.get("id") != map_id]
                with open(GENERATED_MAPS_PATH, "w", encoding="utf-8") as f:
                    json.dump(maps, f, indent=2, ensure_ascii=False)

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


class DualStackServer(socketserver.ThreadingTCPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


if __name__ == "__main__":
    DualStackServer.allow_reuse_address = True
    try:
        httpd = DualStackServer(("::", PORT), SciGlobeHandler)
    except Exception:
        # Fallback to standard IPv4 if IPv6 dual-stack fails
        socketserver.TCPServer.allow_reuse_address = True
        httpd = socketserver.TCPServer(("", PORT), SciGlobeHandler)

    print(f"Serving sci_globe on http://localhost:{PORT} (dual-stack IPv4/IPv6)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
