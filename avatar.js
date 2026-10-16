// avatar.js: the viewer. Loads your VRM, polls the voice "bus" for what the voice is doing, and animates.
//   state  "idle" | "listening" | "thinking" | "speaking"   (what the voice is doing right now)
//   level  0..1                                              (how loud the voice is this instant; drives the mouth)
//   alert  true/false                                        (optional "startled" flash)
//   emote  {name, ts} | null                                 (optional one-shot reaction, played once per new ts)
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "./lib/three-vrm.module.js";
import { createDirector } from "./pose-director.js";

const statusEl = document.getElementById("status");
const modeEl = document.getElementById("mode");
const say = (t) => { if (statusEl) statusEl.textContent = t; };

const config = await fetch("avatar.config.json", { cache: "no-store" }).then((r) => r.json());
const poses = await fetch(config.poses || "poses.json", { cache: "no-store" }).then((r) => r.json());

// ---- renderer, scene, lights ----
const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const FOV = 26;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 30);
const keyLight = new THREE.DirectionalLight(0xffffff, Math.PI * 0.95); keyLight.position.set(0.5, 1.0, 1.3).normalize(); scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9aa8ff, Math.PI * 0.45); rimLight.position.set(-0.8, 0.6, -1.0).normalize(); scene.add(rimLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// ---- camera: fit the whole body (measured from the model itself) into whatever shape the window is ----
const body = { top: 1.6, bottom: 0 };
const orbit = (parseFloat(new URLSearchParams(location.search).get("yaw")) || 0) * Math.PI / 180;   // ?yaw=90 views from the side (for checking poses)
function fit() {
  const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight), aspect = w / h;
  renderer.setSize(w, h, false); camera.aspect = aspect; camera.updateProjectionMatrix();
  const bodyH = body.top - body.bottom;
  const visH = Math.max(bodyH * 1.22, 1.15 / aspect);
  const dist = visH / 2 / Math.tan((FOV * Math.PI) / 180 / 2);
  const mid = (body.top + body.bottom) / 2 + visH * 0.02;
  camera.position.set(Math.sin(orbit) * dist, mid, Math.cos(orbit) * dist); camera.lookAt(0, mid, 0);
  renderer.render(scene, camera);
}
new ResizeObserver(fit).observe(canvas); window.addEventListener("resize", fit); fit();

// ---- live state from the server ----
let live = { state: "idle", level: 0, alert: false, emote: null };
let emoteSeen = 0, director = null;
const previewPose = new URLSearchParams(location.search).get("pose");   // ?pose=name freezes the avatar in that pose (for authoring)
(async function poll() {
  try {
    live = await (await fetch("/state", { cache: "no-store" })).json();
    const em = live.emote;                                               // play each NEW emote once; ignore old ones
    if (em && em.ts > emoteSeen) { emoteSeen = em.ts; if (director && Date.now() / 1000 - em.ts < 15) director.playEmote(em.name); }
  } catch (e) { /* server hiccup: keep the last known state */ }
  setTimeout(poll, 50);
})();

// ---- load the avatar ----
let vrm = null;
const loader = new GLTFLoader(); loader.register((parser) => new VRMLoaderPlugin(parser));
loader.load(
  config.model,
  (gltf) => {
    vrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene); VRMUtils.combineSkeletons?.(gltf.scene);
    scene.add(vrm.scene); VRMUtils.rotateVRM0(vrm);                      // no-op for VRM 1.0, flips VRM 0.x to face the camera
    if (vrm.lookAt) vrm.lookAt.target = camera;                         // eyes follow the camera
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene); body.top = box.max.y; body.bottom = box.min.y; fit();
    director = createDirector(THREE, vrm, poses, config.director || {});
    window.__vrm = vrm; window.__director = director;                   // handy in the browser console
    say("");
  },
  (p) => { if (p.total) say("loading " + Math.round((100 * p.loaded) / p.total) + "%"); },
  (err) => { say("could not load " + config.model + " (see the browser console)"); console.error(err); },
);

// ---- face: mouth from the voice level, expression from the state ----
const MODE_LABEL = { idle: "STANDING BY", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING" };
const STATE_EXPR = config.stateExpressions || { idle: { relaxed: 0.25 }, listening: { happy: 0.15 }, thinking: { relaxed: 0.1 }, speaking: { happy: 0.2 } };
const expr = { happy: 0, relaxed: 0, surprised: 0, sad: 0, angry: 0 };
let level = 0, talking = false, thinkingNow = false, lastMode = "";

function applyFace(dt, t) {
  const em = vrm.expressionManager; if (!em) return;
  // mouth: open fast, close slower, and blend a few vowel shapes so it never looks like a flapping hinge
  const target = live.state === "speaking" ? Math.min(1, live.level * (config.mouthGain || 1.6)) : 0;
  level += (target - level) * (target > level ? 1 - Math.exp(-dt * 28) : 1 - Math.exp(-dt * 12));
  const wob = 0.5 + 0.5 * Math.sin(t * 7.3);
  em.setValue("aa", level * (0.55 + 0.45 * wob));
  em.setValue("oh", level * 0.35 * (1 - wob));
  em.setValue("ih", level * 0.2 * Math.max(0, Math.sin(t * 4.1)));
  em.setValue("ou", 0); em.setValue("ee", 0);
  // face: ease toward the expression that belongs to the current state
  const goal = Object.assign({ happy: 0, relaxed: 0, surprised: 0, sad: 0, angry: 0 }, STATE_EXPR[live.state] || {});
  if (live.alert) goal.surprised = 0.6;
  for (const name of Object.keys(expr)) {
    expr[name] += (goal[name] - expr[name]) * (1 - Math.exp(-dt * 6));
    em.setValue(name, name === "happy" ? Math.min(1, expr.happy + (director ? director.smile : 0)) : expr[name]);
  }
}

const clock = new THREE.Clock();
(function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1), now = performance.now() / 1000;
  if (vrm && director) {
    const isTalking = live.state === "speaking";
    if (isTalking !== talking) { talking = isTalking; director.setTalking(talking); }
    const isThinking = live.state === "thinking";
    if (isThinking !== thinkingNow) { thinkingNow = isThinking; director.setThinking(thinkingNow); }
    const mode = MODE_LABEL[live.state] || "STANDING BY";
    if (mode !== lastMode) { lastMode = mode; if (modeEl) modeEl.textContent = mode; }
    if (previewPose && poses[previewPose]) {                           // preview mode: hold one pose, no motion
      for (const [bone, r] of Object.entries(poses[previewPose])) { const n = vrm.humanoid.getNormalizedBoneNode(bone); if (n && Array.isArray(r)) n.rotation.set(r[0], r[1], r[2]); }
    } else director.update(now);   // poses, transitions, breathing, blinking (writes the bones)
    applyFace(dt, now);            // mouth and expressions
    vrm.update(dt);                // hair / clothing physics (spring bones), look-at, expression blending
  }
  renderer.render(scene, camera);
})();
