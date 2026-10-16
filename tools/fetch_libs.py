"""
Download the three JavaScript libraries the viewer needs into ./lib (once). Python standard library only.

    python tools/fetch_libs.py

Pinned versions (tested together; do not bump casually, three-vrm tracks three.js closely):
  three.js          0.170.0   MIT  https://github.com/mrdoob/three.js
  @pixiv/three-vrm  3.5.5     MIT  https://github.com/pixiv/three-vrm
Files come from the public unpkg.com mirror of the official npm packages.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "lib/three/three.module.js": "https://unpkg.com/three@0.170.0/build/three.module.js",
    "lib/three/addons/loaders/GLTFLoader.js": "https://unpkg.com/three@0.170.0/examples/jsm/loaders/GLTFLoader.js",
    "lib/three/addons/utils/BufferGeometryUtils.js": "https://unpkg.com/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js",
    "lib/three-vrm.module.js": "https://unpkg.com/@pixiv/three-vrm@3.5.5/lib/three-vrm.module.js",
}


def main() -> int:
    ok = True
    for rel, url in FILES.items():
        dest = ROOT / rel
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"have  {rel}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
        except Exception as exc:
            print(f"FAIL  {rel}: {exc}")
            ok = False
            continue
        dest.write_bytes(data)
        print(f"got   {rel}  ({len(data) // 1024} KB, sha256 {hashlib.sha256(data).hexdigest()[:12]})")
    print("Libraries ready." if ok else "Some downloads failed: check your internet connection and run again.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
