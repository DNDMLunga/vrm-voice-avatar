"""
bus.py: the whole voice <-> avatar contract, in one small file. Copy it into your voice program (or import it).

The "bus" is a folder of tiny files. Your voice program writes them, server.py reads them:

    .voice_state     one word: idle | listening | thinking | speaking
    .voice_waveform  {"ts": <unix time>, "samples": [64 numbers]}   written while audio is audibly playing
    .voice_emote     {"name": "excited", "ts": <unix time>}         optional one-shot reaction
    .voice_alert     (the file merely existing means "startled"; create/delete it yourself)

Rules that keep it robust:
  * every write is wrapped so a bus problem can NEVER crash your voice program
  * the waveform is rate-limited to 15 writes/sec (plenty for a mouth)
  * a fresh waveform file means "speaking", even if the state file says otherwise (self-heals if something stomps it)

Typical use inside a voice program:
    import bus
    bus.set_state("listening")      # microphone open
    bus.set_state("thinking")       # waiting for the AI's reply
    # while each chunk of speech audio plays (int16 PCM samples as a list or numpy array):
    bus.write_waveform(bus.downsample_to_64(chunk))
    bus.set_state("idle")           # done talking
    bus.set_emote("excited")        # optional
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

BUS_DIR = Path(os.environ.get("VRM_BUS_DIR", Path(__file__).resolve().parent / "bus"))
STATE_FILE = BUS_DIR / ".voice_state"
WAVEFORM_FILE = BUS_DIR / ".voice_waveform"
EMOTE_FILE = BUS_DIR / ".voice_emote"

_WAVEFORM_MIN_INTERVAL = 1.0 / 15.0
_last_waveform_write = 0.0


def _write(path: Path, text: str) -> None:
    try:
        BUS_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    except Exception:
        pass


def set_state(state: str) -> None:
    """state is one of: idle, listening, thinking, speaking"""
    _write(STATE_FILE, state)


def write_waveform(samples: list[float]) -> None:
    """Pass 64 magnitude values (see downsample_to_64). Also marks the state as 'speaking'."""
    global _last_waveform_write
    now = time.monotonic()
    if now - _last_waveform_write < _WAVEFORM_MIN_INTERVAL:
        return
    _last_waveform_write = now
    _write(WAVEFORM_FILE, json.dumps({"ts": time.time(), "samples": samples}))
    _write(STATE_FILE, "speaking")


def downsample_to_64(pcm) -> list[float]:
    """int16 PCM (list or numpy array) -> 64 mean-absolute-value points. Works without numpy."""
    try:
        vals = [abs(float(x)) for x in pcm]
        if not vals:
            return [0.0] * 64
        n = len(vals)
        return [sum(vals[i * n // 64:(i + 1) * n // 64] or [0.0]) / max(1, len(vals[i * n // 64:(i + 1) * n // 64])) for i in range(64)]
    except Exception:
        return [0.0] * 64


def set_emote(name: str) -> None:
    """One-shot reaction, e.g. 'excited'. Must match a key in avatar.config.json -> director.emotes."""
    _write(EMOTE_FILE, json.dumps({"name": name, "ts": time.time()}))
