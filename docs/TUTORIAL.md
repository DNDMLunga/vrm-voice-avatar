# Build a talking 3D avatar for your voice assistant

*A step-by-step guide. No 3D or coding background needed. Everything here was worked out while building the "Sophie" stage, an animated 3D character who stands on a screen, moves on her own, and lip-syncs to a voice assistant in real time.*

**What you will end up with:** your own 3D character in a browser window that

- stands there *alive*: breathing, blinking, glancing around, shifting her weight, wandering between poses
- switches to a **talking pose** and moves her mouth to your voice assistant's actual voice
- switches to a **thinking pose** while the assistant works out an answer
- plays little **one-shot reactions** (excited, embarrassed...) when your assistant decides to
- has hair that sways, because the model has physics

**What this guide covers:** making the model, making poses, how the transitions between poses work (the part that makes it feel alive), and how to hook it up to a voice. It does not cover clothing design.

---

## 0. The big picture (read this first, it makes everything else easy)

There are only **four pieces**, and they talk through plain files:

```
 your voice program ──writes small files──▶  the "bus" folder  ──▶  server.py ──/state──▶  the web page
 (any TTS / assistant)                       .voice_state                                  (avatar.js)
                                             .voice_waveform                                  │
                                             .voice_emote                                     ▼
                                                                                  loads your .vrm model,
                                                                                  poses + transitions,
                                                                                  mouth + face
```

1. **The model** (`assets/avatar.vrm`): your character, made in the free program VRoid Studio.
2. **The viewer** (`index.html` + `avatar.js` + `pose-director.js`): a web page that draws the model and animates it.
3. **The server** (`server.py`): a tiny program on your own computer that serves the page and reports what your voice is doing.
4. **The bus** (`bus.py`): the "contract" your voice program follows. It writes three little files saying *what state the voice is in* and *how loud it is right now*. That is all the avatar needs.

Because the bus is just files, **any** voice setup can drive the avatar: Python, Node, a game mod, anything that can write a text file.

---

## 1. What you need

| Thing | Why | Cost |
|---|---|---|
| **VRoid Studio** | to design your character and export it | free (Windows / Mac) |
| **Python 3.9 or newer** | runs the small server and tools (no extra packages needed) | free |
| **A modern browser** (Chrome, Edge, Firefox) | shows the avatar (needs WebGL2, which all of them have) | free |
| A text editor, or an **AI coding agent** | to edit settings; the repo's `AGENTS.md` lets an agent do the setup for you | free / varies |
| *(optional)* ffmpeg | converts audio files for the lip-sync test | free |

Everything runs **locally on your computer**. The server only listens to `127.0.0.1`, so nothing is reachable from the internet.

---

## 2. Step 1: make the model in VRoid Studio

VRoid Studio is a character creator. You do not need to draw or sculpt anything: you pick a base and move sliders. This is the one step that is a human job (an AI agent cannot click through a graphical program for you), but it is a very friendly one.

> Menu names below are from memory of how VRoid Studio works and can differ slightly between versions. If a name does not match, look for the closest one.

1. **Start a new model** from one of VRoid's built-in bases.
2. **Shape the face, hair and body** with the sliders and presets. Take your time with the face: it is what people look at. Hair is built from hair "pieces" you can reshape.
3. **Dress her** from the built-in outfit options. (Fancy custom clothing is optional and a whole topic of its own.)
4. **Check the hair and clothing physics are on.** The sway of hair is what makes a still avatar look alive. The viewer already supports it; you just need the model to have it.
5. **Export as VRM 1.0.** In VRoid Studio use *Export*, choose VRM, and pick **VRM 1.0** if offered. Fill in the model info (title, author, and the usage permissions; this is your licence for the model, so choose deliberately).
6. **Save the file** into the repo as **`assets/avatar.vrm`**.

### Check the export with the included tool

```
python tools/check_vrm.py assets/avatar.vrm
```

It tells you, in plain words, whether the model has what the viewer needs:

```
VRM version : 1.0
bones       : 54 humanoid bones; ALL REQUIRED PRESENT
mouth shapes: aa, ih, ou, ee, oh
face shapes : happy, relaxed, surprised, sad, angry, blink
physics     : hair/clothing spring bones present
RESULT: good to go
```

If it says a mouth shape or `blink` is missing, lip-sync or blinking will not work. Re-export from VRoid Studio.

> **Why VRM?** VRM is a standard file format for 3D characters. It guarantees every character has the *same named bones* (`hips`, `head`, `leftUpperArm`...) and the *same named facial expressions* (`aa`, `happy`, `blink`...). That is the trick that lets one set of poses and one animation program work on **any** character you or anyone else makes.

---

## 3. Step 2: see it move (no voice needed)

```
python tools/fetch_libs.py        # downloads the 2 JavaScript libraries (about 2 MB), once
python server.py --mock           # starts the demo mode
```

Open **http://127.0.0.1:8790/** in your browser. In `--mock` mode the server pretends a voice is running and loops through *idle, listening, thinking, speaking, alert*, so you will see the avatar wander between poses, switch to its thinking pose, then its talking pose with a moving mouth.

If you see "loading..." and nothing else, press **F12** and look at the Console for the error. The most common causes are a missing `assets/avatar.vrm` or skipping `fetch_libs.py`.

The two libraries are **three.js** (draws 3D in the browser) and **three-vrm** (understands VRM files: bones, expressions, hair physics). Both are free and open source (MIT licence).

---

## 4. Step 3: poses

### 4.1 What a pose is

A pose is just a list of **rotations**: for each bone, three numbers `[x, y, z]` saying how far to rotate it, in **radians** (3.14 radians is a half turn; 1.0 is about 57 degrees). Bones you leave out stay at `[0, 0, 0]`. This is the whole file, `poses.json`:

```json
{
  "rest":    { "leftUpperArm": [0, -0.05, -1.25], "rightUpperArm": [0, 0.05, 1.25], "head": [0.02, 0, 0] },
  "talking": { "leftUpperArm": [0, -0.45, -1.1],  "leftLowerArm": [0, -1.3, 0], "rightUpperArm": [0, 0.45, 1.1], "rightLowerArm": [0, 1.3, 0] }
}
```

The model's neutral shape (all zeros) is a **T-pose**: standing with arms straight out to the sides. Every pose is "how far from the T-pose".

### 4.2 The rules of the rig (this saves hours)

Rotations are not intuitive until you know the three rules. These were **measured on a real VRM** by moving one bone at a time on the left arm and checking where the hand ended up. The right arm is its mirror image, which was checked by eye on the finished poses:

| Bone | Axis | What it does | Left side | Right side |
|---|---|---|---|---|
| `upperArm` | **Z** | lowers / raises the arm | **negative** = down | **positive** = down |
| `upperArm` | **Y** | swings the arm forward / back | **negative** = forward | **positive** = forward |
| `upperArm` | X | *twists* the arm (no movement of the hand) | - | - |
| `lowerArm` | **Y** | bends the elbow so the forearm comes **forward** | **negative** = forward | **positive** = forward |
| `lowerArm` | X | twists the forearm only | - | - |

Quick feel for the numbers (left arm): `z = -1.25` hangs the arm almost straight down, `z = -0.6` is a diagonal, `z = 0` is the T-pose, `z = +1.5` is a cheer. For the elbow, `y = -1.3` is a bent elbow with the forearm pointing forward.

**The mirror rule:** the right side is the left side with the **sign flipped**. If you write a left-arm pose and want the matching right arm, copy the numbers and negate the Y and Z values.

Other bones to know: `hips` (turns/tilts the whole body), `spine`, `chest`, `upperChest` (bend/twist the torso), `neck`, `head` (nod = X, turn = Y, tilt = Z), `leftShoulder`/`rightShoulder` (shrug), `leftUpperLeg`/`leftLowerLeg`/`leftFoot` (and right).

### 4.3 Making poses: two ways

**Way A: type numbers and look (always works).**
Add a pose to `poses.json`, then open it **frozen**:

```
http://127.0.0.1:8790/?pose=talking          front view
http://127.0.0.1:8790/?pose=talking&yaw=70   side view (the camera orbits 70 degrees)
```

Refresh after each edit. Always check the **side view** too: arms that look fine from the front can be buried inside the body or pointing backwards. Change a number, refresh, look. A pose usually takes 4-6 rounds. Start with the arms (they define the pose), then add small head, spine and hip tilts for attitude.

**Way B: pose the character in VRoid Studio, then convert the file.**
VRoid Studio's posing screen can save a pose as a **`.vroidpose`** file. Posing there is much more visual than typing numbers. Convert it:

```
python tools/vroidpose_to_pose.py "My Pose.vroidpose" --name thinking --into poses.json
```

(It makes a `.bak` backup of `poses.json` first.) The conversion rule was verified exactly: arms, legs and hands convert perfectly. In detail:

* a `.vroidpose` is JSON with one **quaternion** (a 4-number rotation) per bone, in the Unity convention
* the tool mirrors it into VRM's convention, `(x, y, z, w) -> (x, -y, -z, w)`
* it keeps bone names as they are (**do not** swap left and right)
* it converts to the three Euler angles `poses.json` uses
* it skips VRoid-only data (hips position, toes, the spine control point)

**Two known fixes** for the spine and hips, because VRoid bends the spine with a hidden control point that the file does not store:

* **Back arched too much?** Use `--chest-scale 0.3` (try 0.3 to 0.5). It shrinks the chest bend and rotates the neck and shoulders back by the amount removed. The rule behind it: *whenever you reduce a parent bone's bend, counter-rotate its children by the same amount, so hands and head keep the orientation the file gave them.* Add `--left-shoulder-factor 0.6` to pull one arm slightly away from the chest.
* **Whole body turned sideways?** The file's hips have a big turn in them (VRoid's own view was front-on). The tool warns you; fix it with `--hips-yaw-deg -90` and then fine-tune by eye against your VRoid screenshot.

Always finish by looking at it with `?pose=name` and from the side.

Facial expressions and blush are **not** stored in pose files. Faces are handled separately (section 6).

### 4.4 Which poses do you need?

| Pose | Used when | Notes |
|---|---|---|
| `rest` (and 1-3 more, e.g. `shift`) | idle, a loop of resting poses | the **first** one is "home". Variety here is what stops it looking like a statue |
| `talking` | while the voice speaks | hands low and forward, "explaining" |
| `thinking` | while the assistant works out an answer | a hand to the chin works well |
| any number of **emotes** | one-shot reactions (`excited`, `embarrassed`...) | held for a few seconds, then back to rest |

The starter `poses.json` has all five so you can see everything working before you make your own.

---

## 5. Step 4: transitions (why it looks alive and not robotic)

Moving between two poses by simply sliding every bone from A to B at the same speed looks like a mannequin being cranked. Real bodies are never that tidy, so `pose-director.js` adds six small ideas. Together they are the difference between "a model that plays animations" and "a character who is standing there." Every number below is a setting you can change.

### 5.1 Staggered timing: nothing starts at once

When you decide to move, your **legs** start first, then your **torso**, then your **shoulders**, then your **arms**, then your **head** trails a little behind. The director gives every body part its own start delay:

| Part | Starts after (fraction of the move) |
|---|---|
| legs, hips | 0 |
| torso | 0.07 |
| shoulders | 0.12 |
| arms | 0.16 (one arm leads; the other follows 0.07 later, picked at random each move) |
| head | 0.26 to 0.32 |

All the delays together use up 36% of the move, so each bone's own movement takes the remaining 64%.

### 5.2 Two kinds of ease

* **Arms and head use a "spring"**: they swing a little *past* the target and settle back, like something with a bit of weight. (An underdamped spring step, damping 0.62.)
* **Legs and torso use "smootherstep"**: a very gentle start and a very gentle stop with no overshoot, so the body does not wobble.

### 5.3 Anticipation: a tiny move the wrong way first

Before the body moves toward a new pose it dips very slightly *away* from it (about 4-8% of the move). People do this unconsciously before every motion; animators call it anticipation. It is subtle, but without it the start of every move feels mechanical.

### 5.4 Arm swing outside the body

When a hand travels from one pose to another, the straight-line path often passes *through* the torso. So during the move the upper arm gets an extra outward arc (0.3-0.35 radians at its peak), and the forearm half that, so hands go *around* the body. This one fixed the most obvious "clipping" problem.

### 5.5 Every visit is slightly different

Each time the character enters a pose, it is nudged a little (head turn up to about 5 degrees, hip tilt, spine twist, shoulders). She never lands in exactly the same spot twice.

### 5.6 Holds and the wander loop

* She starts in the home pose, holds **4 s**, then begins wandering.
* She holds the home pose **6-13 s**, the other resting poses **4-8 s**, and each move takes **1.8-3.0 s**.
* The order is a fixed loop (`rest -> shift -> rest ...`), configurable in `avatar.config.json`.

### 5.7 Alive motion layered on top

While holding a pose she is never frozen:

* **Breathing**: chest, spine and shoulders rise and fall (about a 4-second cycle)
* **Head drift**: tiny smooth wobble in all three directions
* **Glances**: in the home pose, every 7-14 s she turns her head to look to one side for 2-3 s
* **Blinking**: every 2-6 s, and one blink in five is a quick double blink
* **Hip sway with planted feet**: the hips move a few millimetres in a 5-second cycle, and a small **two-bone IK** step puts each ankle back exactly where the pose put it, so the feet do not skate on the floor. (Measured: hips sway 5 mm while the feet move about 1 mm.)

The smooth "never repeats" wobble is a sum of three sine waves at unrelated speeds, which looks organic and costs almost nothing.

---

## 6. Step 5: states, face and emotes

The viewer reads four states from the voice and reacts:

| Voice state | Body | Face |
|---|---|---|
| `idle` | the resting loop | slightly relaxed |
| `listening` | resting loop | a hint of a smile |
| `thinking` | eases into the **thinking** pose; relaxes 0.6 s after thinking ends | calm |
| `speaking` | eases into the **talking** pose (1.5-2.2 s); stays in it until 3.5 s after the last word, then relaxes (so she does not flap between poses during short pauses) | a little happy; random small smiles |

**The mouth** is driven by the loudness of the actual audio: it opens quickly and closes more slowly (so it follows syllables without flickering), and the vowels `aa`, `oh` and `ih` are mixed with slightly different wobbles so the mouth shape keeps changing. Turn it up or down with `mouthGain` in `avatar.config.json`.

**Expressions** (`happy`, `relaxed`, `surprised`, `sad`, `angry`) ease toward a target for each state (set in `stateExpressions`). The talking smiles are added on top of `happy`.

**Emotes** are one-shot reactions. Declare them in `avatar.config.json`:

```json
"emotes": { "excited": "excited", "embarrassed": "embarrassed" }
```

(the name your voice program sends -> the pose to play). Each plays once: ease in (1-1.4 s), hold (3.5-5.5 s), ease back to rest. An emote beats talking and thinking while it lasts. To send one:

```python
import bus
bus.set_emote("excited")
```

A neat trick: let the assistant itself decide when. Teach it to put a hidden tag like `[emote:excited]` at the start of a reply; your program strips the tag before speaking and calls `bus.set_emote("excited")`.

---

## 7. Step 6: connect a voice

The bus is three tiny files in the `bus/` folder:

| File | Contents | Meaning |
|---|---|---|
| `.voice_state` | one word: `idle`, `listening`, `thinking` or `speaking` | what the voice is doing |
| `.voice_waveform` | `{"ts": 1700000000.1, "samples": [64 numbers]}` | how loud the audio is *right now* |
| `.voice_emote` | `{"name": "excited", "ts": 1700000000.1}` | one-shot reaction |

`bus.py` is the whole contract in code. Copy it next to your voice program:

```python
import bus

bus.set_state("listening")           # microphone is open
bus.set_state("thinking")            # waiting for the AI's answer

# while each piece of speech audio plays (16-bit PCM samples):
bus.write_waveform(bus.downsample_to_64(chunk))

bus.set_state("idle")                # finished talking
```

Rules built in so it never causes trouble:

* every write is wrapped in a try/except, so a bus problem can **never crash your voice program**
* the waveform is limited to 15 writes per second (plenty for a mouth)
* **a fresh waveform file always means "speaking"**, even if something overwrote the state file. This self-heals races between programs.
* the server treats a waveform older than 2 seconds as "not speaking"

### Test it in three steps, with no assistant at all

1. **Fake voice:** run `python server.py` (no `--mock`) in one terminal and `python tools/sim_voice.py` in another. Reload the page: the avatar listens, thinks, talks and does an emote.
2. **Real audio:** `python tools/wav_to_bus.py speech.wav --play` drives the mouth from a real recording, in real time. (Needs a 16-bit PCM .wav; the tool shows an ffmpeg line to convert other formats.)
3. **Your own program:** add the `bus.set_state` and `bus.write_waveform` calls where your text-to-speech plays audio.

If the mouth barely moves or is always wide open, change `LEVEL_FULL_SCALE` in `server.py` (lower = more sensitive) or `mouthGain` in the config.

### Putting the avatar on your stream or screen

The page is plain HTML, so you can open it full-screen on a second monitor, or add it to OBS as a **Browser Source** pointing at `http://127.0.0.1:8790/`. The 3D drawing itself is transparent; the dark background comes from the page's CSS. For a see-through OBS source, set `background: transparent` on `html, body` in `index.html` (and hide the small status text if you like).

---

## 8. Tuning cheat-sheet

All in `avatar.config.json` (the `director` block overrides the defaults in `pose-director.js`):

| I want... | Change |
|---|---|
| more or less movement between poses | `holdHome`, `holdOther`, `moveDur` |
| slower or smoother transitions | raise `moveDur` (e.g. `[2.5, 4]`) |
| arms to swing wider around the body | `swing: {"rest": 0.5, "other": 0.5}` |
| her to stay in the talking pose between sentences | raise `talk.hangover` |
| no hip sway | `sway: {"on": false}` |
| no random smiles | `smile: {"on": false}` |
| a bigger or smaller mouth | `mouthGain` (top level) |
| different faces per state | `stateExpressions` |
| a different model or poses file | `model`, `poses` |

---

## 9. When something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| Blank page, "loading..." forever | open the console (F12). Usually `assets/avatar.vrm` is missing, or `fetch_libs.py` was not run |
| "could not load assets/avatar.vrm" | wrong filename or path; the file must be exactly `assets/avatar.vrm` (or change `model` in the config) |
| Character faces away from the camera | this is a VRM 0.x model; the viewer handles it, but re-exporting as VRM 1.0 is cleaner |
| Mouth does not move | `python tools/check_vrm.py` shows if `aa/ih/ou/ee/oh` exist; check `GET /state` at `http://127.0.0.1:8790/state` while speaking: `level` should move |
| Mouth always stuck open | lower `mouthGain` or raise `LEVEL_FULL_SCALE`; make sure `write_waveform` is only called while audio plays |
| Arms inside the body | check the **side view** (`&yaw=70`); raise `swing`, or raise the upper-arm Z magnitude |
| Hands point backward | upper-arm / forearm Y has the wrong sign for that side; remember left is negative = forward, right is positive |
| Pose from VRoid looks twisted | try `--chest-scale 0.3`; if the body is sideways, `--hips-yaw-deg -90` |
| Hair does not move | the export has no physics; check with `check_vrm.py` and re-export |
| Page does not update after edits | refresh with Ctrl+F5; the server already tells the browser not to cache |
| Port 8790 busy | set `VRM_PORT=8791` before starting the server |

---

## 10. What is in the repo

```
avatar.config.json   settings: model path, poses file, state faces, director overrides
poses.json           the poses (start here)
pose-director.js     poses, transitions, alive motion        <- the heart of it
avatar.js            loads the model, mouth + face, polls the server
index.html           the page
server.py            local server + /state
bus.py               the voice contract (copy into your voice program)
assets/              put avatar.vrm here
tools/               fetch_libs.py, check_vrm.py, vroidpose_to_pose.py, sim_voice.py, wav_to_bus.py
docs/TUTORIAL.md     this guide
AGENTS.md            instructions for an AI coding agent that sets this up for you
```

### Licences and credit

* This project's code is MIT-licensed (see `LICENSE`).
* three.js and @pixiv/three-vrm are MIT-licensed, downloaded by `tools/fetch_libs.py`.
* **Your character is yours** under the terms you chose when exporting, and under VRoid Studio's own terms of use (read them if you plan to publish or sell anything). Do not commit your `.vrm` to a public repo unless its licence allows redistribution; the included `.gitignore` leaves it out by default.

*Built from the real Sophie stage: a VRoid model, hand-made poses, a transition engine and a live voice bus. The model and its poses were made by hand; the code is the reusable part.*
