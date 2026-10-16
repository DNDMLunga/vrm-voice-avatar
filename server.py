"""
Tiny local web server for the avatar. Python standard library only; listens on 127.0.0.1 (this computer only).

  python server.py            real mode: reads what your voice program wrote to the bus folder
  python server.py --mock     demo mode: a scripted loop of idle > listening > thinking > speaking > alert,
                              so you can see the avatar move without any voice program running

It does two jobs:
  1. serves the files in this folder (index.html, avatar.js, assets/, lib/ ...)
  2. answers GET /state with JSON the viewer polls ~20 times a second:
       {"state": "idle|listening|thinking|speaking", "level": 0..1, "alert": bool, "emote": {"name","ts"} | null}

The "bus" is just a folder of small files that a voice program writes (see bus.py). Default folder: ./bus
Change it with the environment variable VRM_BUS_DIR, or --bus <folder>.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("VRM_PORT", "8790"))
VALID_STATES = {"idle", "listening", "thinking", "speaking"}
WAVEFORM_FRESH_SECONDS = 2.0   # a waveform file newer than this means "audio is playing right now"
LEVEL_FULL_SCALE = 3000.0      # mean |sample| (16-bit PCM units) that counts as "full mouth"; lower = more sensitive

BUS_DIR = Path(os.environ.get("VRM_BUS_DIR", ROOT / "bus"))
if "--bus" in sys.argv:
    BUS_DIR = Path(sys.argv[sys.argv.index("--bus") + 1])

STATE_FILE, WAVEFORM_FILE, ALERT_FILE, EMOTE_FILE = (BUS_DIR / n for n in (".voice_state", ".voice_waveform", ".voice_alert", ".voice_emote"))

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".vrm": "model/gltf-binary", ".glb": "model/gltf-binary",
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
}


def read_emote():
    try:
        d = json.loads(EMOTE_FILE.read_text(encoding="utf-8"))
        return {"name": str(d["name"]), "ts": float(d["ts"])}
    except Exception:
        return None


def read_real_state() -> dict:
    state, level, fresh = "idle", 0.0, False
    try:
        raw = STATE_FILE.read_text(encoding="utf-8").strip()
        if raw in VALID_STATES:
            state = raw
    except Exception:
        pass
    try:
        payload = json.loads(WAVEFORM_FILE.read_text(encoding="utf-8"))
        samples = [float(s) for s in payload.get("samples", [])]
        if time.time() - float(payload.get("ts", 0)) <= WAVEFORM_FRESH_SECONDS:
            fresh = True
            if samples:
                level = max(0.0, min(1.0, (sum(abs(s) for s in samples) / len(samples)) / LEVEL_FULL_SCALE))
    except Exception:
        pass
    if fresh:                       # fresh audio always means "speaking", whatever the state file says
        state = "speaking"
    return {"state": state, "level": level, "alert": ALERT_FILE.exists()}


MOCK_SCRIPT = [("idle", 5.0), ("listening", 3.0), ("thinking", 3.5), ("speaking", 7.0), ("alert", 2.5), ("idle", 3.0)]
MOCK_TOTAL = sum(d for _, d in MOCK_SCRIPT)


def read_mock_state() -> dict:
    t, acc, phase, phase_t = time.monotonic() % MOCK_TOTAL, 0.0, "idle", 0.0
    for name, dur in MOCK_SCRIPT:
        if t < acc + dur:
            phase, phase_t = name, t - acc
            break
        acc += dur
    alert = phase == "alert"
    state = "idle" if alert else phase
    level = 0.0
    if state == "speaking":
        raw = 0.55 + 0.3 * math.sin(phase_t * 2.6) + 0.15 * math.sin(phase_t * 5.3 + 1.0)   # speech-like wobble
        level = max(0.05, min(1.0, raw))
    return {"state": state, "level": level, "alert": alert}


class Handler(BaseHTTPRequestHandler):
    mock = False

    def log_message(self, fmt, *args):   # keep the console quiet
        pass

    def _send(self, code: int, body: bytes = b"", ctype: str = "application/octet-stream") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")     # always show the latest files while you iterate
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/state":
            data = read_mock_state() if self.mock else read_real_state()
            data["emote"] = read_emote()
            self._send(200, json.dumps(data).encode("utf-8"), "application/json")
            return
        rel = path.lstrip("/") or "index.html"
        target = (ROOT / rel).resolve()
        try:
            target.relative_to(ROOT)            # block ../ escapes
        except ValueError:
            self._send(403)
            return
        if not target.is_file() or any(part.startswith(".") for part in target.relative_to(ROOT).parts):
            self._send(404)
            return
        self._send(200, target.read_bytes(), CONTENT_TYPES.get(target.suffix.lower(), "application/octet-stream"))


def main() -> None:
    Handler.mock = "--mock" in sys.argv
    BUS_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[server] {'MOCK demo' if Handler.mock else 'REAL'} mode -> http://127.0.0.1:{PORT}/")
    if not Handler.mock:
        print(f"[server] reading the voice bus from: {BUS_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
