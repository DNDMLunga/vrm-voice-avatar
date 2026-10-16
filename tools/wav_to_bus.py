"""
Drive the avatar's mouth from a real audio file, in real time. Python standard library only.

    python tools/wav_to_bus.py speech.wav          # writes the bus; play the same file in your player at the same time
    python tools/wav_to_bus.py speech.wav --play   # Windows only: also plays the sound itself (winsound)

Works with 16-bit PCM .wav files (any sample rate, mono or stereo). Convert other formats first, e.g.
    ffmpeg -i speech.mp3 -ac 1 -ar 22050 -sample_fmt s16 speech.wav

This is exactly what a real voice program does: for each ~1/15 s slice of audio that is playing, hand the
loudness to bus.write_waveform(). Your own text-to-speech code should do the same with the audio it plays.
"""
import array
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bus  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = sys.argv[1]
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            print("This tool needs 16-bit PCM audio (see the ffmpeg line in the help).")
            return 1
        ch, rate, frames = w.getnchannels(), w.getframerate(), w.getnframes()
        pcm = array.array("h")
        pcm.frombytes(w.readframes(frames))
    if sys.byteorder == "big":
        pcm.byteswap()
    if ch > 1:
        pcm = array.array("h", pcm[0::ch])
    if "--play" in sys.argv:
        try:
            import winsound
            winsound.PlaySound(path, winsound.SND_FILENAME | winsound.SND_ASYNC)
        except ImportError:
            print("--play needs Windows; play the file in any player yourself.")
    chunk = int(rate / 15)
    start = time.time()
    bus.set_state("speaking")
    for i in range(0, len(pcm), chunk):
        bus.write_waveform(bus.downsample_to_64(pcm[i:i + chunk]))
        wait = start + (i + chunk) / rate - time.time()
        if wait > 0:
            time.sleep(wait)
    time.sleep(0.4)
    bus.set_state("idle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
