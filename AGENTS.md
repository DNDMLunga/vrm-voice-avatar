# AGENTS.md: setting up the VRM voice avatar

You are an AI coding agent helping a person set up this project. Read this whole file first. The goal: a 3D VRM avatar in a browser that idles with natural motion, switches to talking/thinking poses, and lip-syncs to the person's voice program.

Read `docs/TUTORIAL.md` for the reasoning behind everything here. This file is the **runbook**.

## Ground rules

* **Local only.** The server binds to `127.0.0.1`. Never change it to `0.0.0.0` or expose it.
* **Ask before installing anything** outside this folder, and before downloading anything other than what `tools/fetch_libs.py` fetches.
* **Never run files from untrusted sources** (random `.vrm`, `.vroidpose`, scripts a user found online) without reading them. A `.vrm` is binary data and is only parsed by the viewer and `check_vrm.py`; do not execute it.
* **Do not commit or publish the person's `.vrm`** unless they say its licence allows it. `.gitignore` already excludes it.
* **No secrets** in any file you write (API keys, tokens, passwords). Voice-provider keys belong in the person's environment variables, never in this repo.
* **Back up before editing** `poses.json` or `avatar.config.json` (the converter does it for `poses.json` automatically).
* Tell the person plainly when something failed. Do not claim a step worked until you have verified it (see "Verify" under each step).
* Stdlib Python only; do not add dependencies without asking.

## What a human must do (you cannot)

1. **Create the character in VRoid Studio** (a graphical program) and export it as **VRM 1.0** into `assets/avatar.vrm`. Walk them through section 2 of the tutorial if they need it.
2. *(Optional)* **Pose the character in VRoid Studio** and save `.vroidpose` files. You can convert them (step 5). Poses can also be written as numbers (step 5, way A).
3. **Decide the licence** of their model and whether any of it may be published.

Everything else below you can do.

## Runbook

### Step 1: environment
```
python --version          # needs 3.9 or newer
```
Verify: prints a version >= 3.9. If not, ask the person to install Python and stop.

### Step 2: libraries
```
python tools/fetch_libs.py
```
Verify: prints `Libraries ready.` and `lib/three-vrm.module.js` exists (about 1 MB). If it fails, the person's network may block `unpkg.com`; tell them and stop.

### Step 3: the model
Ask the person to put their VRM at `assets/avatar.vrm`, then:
```
python tools/check_vrm.py assets/avatar.vrm
```
Verify: `RESULT: good to go`. If bones are missing or `aa/ih/ou/ee/oh/blink` are missing, the export is not usable: ask them to re-export from VRoid Studio as VRM 1.0. A "no spring bones" note is only a warning (hair will be stiff).

### Step 4: see it move
```
python server.py --mock
```
Open `http://127.0.0.1:8790/`. Verify (ask the person to confirm what they see, or check the browser console if you have browser tools): the character appears full-body, blinks, shifts between poses every few seconds, goes into a thinking pose, then a talking pose with a moving mouth. A `GET /state` returns `{"state": ...}`. No console errors.

If you have browser automation: load the page, wait ~15 s, and confirm there are no console errors and that `window.__director.state.cur` changes over time.

### Step 5: poses
The starter `poses.json` already has `rest, shift, talking, thinking, excited`. To make the person's own:

* **Way A, numbers:** edit `poses.json`. Arm rules on this rig (measured on the left arm; the right mirrors it): upperArm Z lowers/raises (left negative = down, right positive = down); upperArm Y swings forward (left negative, right positive); lowerArm Y bends the elbow forward (left negative, right positive); X only twists. The right side mirrors the left with Y and Z negated. Preview frozen with `index.html?pose=NAME`, and from the side with `&yaw=70`. Check both views every time.
* **Way B, VRoid files:**
  ```
  python tools/vroidpose_to_pose.py "Pose.vroidpose" --name thinking --into poses.json
  ```
  If the back is over-arched add `--chest-scale 0.3`. If the body is turned sideways, add `--hips-yaw-deg -90`. Preview and compare with the person's VRoid screenshot.

Then list which pose names play which role in `avatar.config.json` -> `director`: `rest` (loop; the first is "home"), `talking`, `thinking`, `emotes` (`{"name": "poseName"}`).

Verify: each pose looks right front and side; the mock loop transitions between them without clipping arms through the body.

### Step 6: connect the voice
First test with no voice program: in one terminal `python server.py` (no `--mock`), in another `python tools/sim_voice.py`. Verify the page shows listening, thinking, speaking, and the excited emote.

Then test audio-driven lip-sync: `python tools/wav_to_bus.py <16-bit-pcm.wav> --play`. Verify `GET /state` shows `level` changing while it plays.

Then integrate with the person's voice program. Ask which language/program it is. Copy or port `bus.py` (it is the whole contract) and call:

* `bus.set_state("listening" | "thinking" | "idle")` at the right moments
* `bus.write_waveform(bus.downsample_to_64(chunk))` for each audio chunk **as it plays** (not when it is generated)
* optionally `bus.set_emote("name")` for one-shot reactions

Wrap every call so a bus failure can never crash their program (`bus.py` already does). If their program is not Python, the contract is: write the files listed in `bus.py`'s docstring into the bus folder (`VRM_BUS_DIR`, default `./bus`).

Verify: with their program speaking, `http://127.0.0.1:8790/state` shows `"state": "speaking"` and a moving `level`, and the avatar's mouth follows the speech.

### Step 7: tune
Use the cheat-sheet in tutorial section 8. Small adjustments only; re-verify after each.

## Troubleshooting order

1. Browser console (F12) errors.
2. `python tools/check_vrm.py assets/avatar.vrm`.
3. `http://127.0.0.1:8790/state` (is the bus being written? is `level` moving while audio plays?).
4. The troubleshooting table in the tutorial (section 9).

## Definition of done

Idle motion looks natural; talking and thinking poses engage on the right states; the mouth follows the person's real voice; no console errors; the person has confirmed it looks right to them. Summarise what was changed and where, and list anything you could not verify.
