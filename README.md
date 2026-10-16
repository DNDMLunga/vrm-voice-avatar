# VRM Voice Avatar

A 3D avatar for your voice assistant, in a browser tab. It idles with natural, never-repeating motion, switches to **talking** and **thinking** poses, plays one-shot **emotes**, and its mouth follows your voice in real time. Your character comes from the free **VRoid Studio**; everything else here is small, dependency-free Python and JavaScript.

```
voice program ──files──▶ bus/ ──▶ server.py ──/state──▶ browser page (your .vrm, poses, transitions, mouth)
```

## Quick start (5 minutes, no voice needed)

```
python tools/fetch_libs.py                       # one-time: downloads three.js + three-vrm into lib/
# put your VRoid export at assets/avatar.vrm
python tools/check_vrm.py assets/avatar.vrm      # does it have what the viewer needs?
python server.py --mock                          # demo mode
```

Open **http://127.0.0.1:8790/**. Then read **[docs/TUTORIAL.md](docs/TUTORIAL.md)** for how to make your model, poses and transitions, and how to connect a real voice.

## Let an AI agent set it up

Point your coding agent at this folder and give it this prompt:

> Read `AGENTS.md` and set up this project for me step by step. Ask me before installing anything, tell me which steps only I can do (creating the character in VRoid Studio), and verify each step before moving on.

## What is inside

| | |
|---|---|
| `pose-director.js` | poses, transitions (staggered timing, spring ease, anticipation, arm swing), breathing, blinking, glances, foot-planted hip sway |
| `avatar.js` / `index.html` | loads the VRM, drives the mouth and face, polls the server |
| `server.py` | local-only server + `/state` (stdlib only) |
| `bus.py` | the voice contract: copy it into your voice program |
| `poses.json`, `avatar.config.json` | the poses and the settings |
| `tools/` | `fetch_libs`, `check_vrm`, `vroidpose_to_pose` (VRoid pose files to poses), `sim_voice`, `wav_to_bus` |

Requirements: Python 3.9+, a modern browser. Nothing else to install.

## Preview helpers

* `index.html?pose=thinking` freezes the avatar in one pose; add `&yaw=70` for a side view.
* `http://127.0.0.1:8790/state` shows exactly what the voice program is telling the avatar.

## Licence

Code: MIT (see `LICENSE`). three.js and @pixiv/three-vrm (downloaded at setup) are MIT. Your character is yours under the licence you set when exporting and VRoid Studio's terms; `assets/*.vrm` is git-ignored by default.
