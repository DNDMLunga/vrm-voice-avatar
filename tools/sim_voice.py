"""
Pretend to be a voice program, so you can test the avatar WITHOUT any real voice setup.
Writes the bus files exactly as a real voice program would. Python standard library only.

    python tools/sim_voice.py            # loops: idle > listening > thinking > speaking > (emote) > idle
    python tools/sim_voice.py once       # one round, then exit
Run `python server.py` (NOT --mock) in another terminal and open http://127.0.0.1:8790/
"""
import math
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bus  # noqa: E402


def hold(state, seconds):
    bus.set_state(state)
    time.sleep(seconds)


def speak(seconds):
    """Fake speech: bursts of loudness with small pauses, written at ~15 Hz like real audio chunks."""
    t0 = time.time()
    while time.time() - t0 < seconds:
        t = time.time() - t0
        loud = max(0.0, 0.5 + 0.35 * math.sin(t * 5.1) + 0.15 * math.sin(t * 11.3)) * (0.0 if int(t * 1.7) % 5 == 4 else 1.0)
        bus.write_waveform([loud * 2600 * (0.7 + 0.3 * random.random()) for _ in range(64)])
        time.sleep(1 / 15)


def main():
    once = "once" in sys.argv
    print("simulating a voice; Ctrl+C to stop. Bus folder:", bus.BUS_DIR)
    while True:
        hold("idle", 5)
        hold("listening", 3)
        hold("thinking", 3.5)
        speak(8)
        bus.set_emote("excited")     # needs "excited" in avatar.config.json -> director.emotes
        speak(3)
        hold("idle", 1)
        if once:
            break


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        bus.set_state("idle")
