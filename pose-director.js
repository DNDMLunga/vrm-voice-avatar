// pose-director.js: gives a VRM avatar a life of its own.
//
// What it does, in one sentence: it holds named poses, moves between them with natural-looking
// transitions, and layers small "alive" motion (breathing, head drift, glances, blinks, hip sway
// with planted feet) on top. It also switches to a talking pose, a thinking pose and one-shot
// "emote" poses when you tell it to.
//
// Usage (after the VRM is loaded and VRMUtils.rotateVRM0(vrm) was called):
//   import { createDirector } from "./pose-director.js";
//   const director = createDirector(THREE, vrm, posesJson, config);
//   // every frame, BEFORE vrm.update(dt):
//   director.update(performance.now() / 1000);
//   // when your app's state changes:
//   director.setTalking(true | false);   director.setThinking(true | false);   director.playEmote("excited");
//
// A pose is an object of bone name -> [x, y, z] Euler angles in RADIANS (order XYZ) on the VRM
// *normalized humanoid* bones (hips, spine, chest, leftUpperArm ...). Bones a pose leaves out are 0.

export function createDirector(THREE, vrm, poseData, opts = {}) {
  const { Vector3: V3, Quaternion: Q, Euler: E } = THREE;
  const N = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const ALL = Object.keys(vrm.humanoid.humanBones).filter((k) => N(k));
  const has = (b) => ALL.includes(b);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  const merge = (d, o) => {                                              // deep merge: your options override the defaults, nested objects merge
    const out = Array.isArray(d) ? d.slice() : Object.assign({}, d);
    for (const k of Object.keys(o || {})) out[k] = o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) && d[k] && typeof d[k] === "object" ? merge(d[k], o[k]) : o[k];
    return out;
  };
  const cfg = merge(
    {
      rest: ["rest"],                 // pose names that make up the resting loop; the FIRST one is "home"
      talking: "talking",             // pose held while talking (optional)
      thinking: "thinking",           // pose held while thinking (optional)
      emotes: {},                     // e.g. { excited: "excited", embarrassed: "embarrassed" } (emote name -> pose name)
      firstHold: 4,                   // seconds in the first pose before the loop starts
      holdHome: [6, 13],              // seconds she stays in the home pose before moving on
      holdOther: [4, 8],              // seconds in the other rest poses
      moveDur: [1.8, 3.0],            // seconds a transition takes
      swing: { rest: 0.3, other: 0.35 }, // how far arms swing OUTSIDE the body in a transition (radians)
      talk: { hangover: 3.5, enter: [1.5, 2.2], exit: [1.8, 2.6] },   // waits `hangover` s after the last word before relaxing
      think: { hangover: 0.6, enter: [1.2, 1.8], exit: [1.6, 2.4] },
      emote: { enter: [1.0, 1.4], hold: [3.5, 5.5], exit: [1.6, 2.4] },
      sway: { on: true, period: 5, dx: 0.006, dy: 0.003, hz: 0.02, hyaw: 0.02, twist: 0.05 },   // hip sway, feet stay planted
      smile: { on: true, gap: [4, 9], peak: [0.25, 0.6] },   // random small smiles while talking; read director.smile (0..1)
      blink: true,
    },
    opts,
  );

  // ---- poses as full arrays (every bone present, missing = 0)
  const full = (p) => { const o = {}; for (const b of ALL) o[b] = (p && p[b] ? p[b] : [0, 0, 0]).slice(); return o; };
  const P = {};
  for (const [name, p] of Object.entries(poseData)) if (!name.startsWith("_") && p && typeof p === "object") P[name] = full(p);
  const restNames = cfg.rest.filter((n) => P[n]);
  if (!restNames.length) throw new Error("pose-director: none of the rest poses exist in poses.json: " + cfg.rest.join(", "));
  const HOME = restNames[0];
  const isHold = (n) => n === cfg.talking || n === cfg.thinking || Object.values(cfg.emotes).includes(n);   // poses held until released

  const hips = N("hips");
  const HIPS_POS = hips.position.clone();
  const HIPS_BASE = HIPS_POS.y;
  const DOWN = new V3(0, -1, 0);

  // ---- bone groups: each group starts moving at a slightly different moment (see "staggered timing" in the tutorial)
  const grp = (b) => {
    if (/Leg|Foot|Toes|^hips$/.test(b)) return "legs";
    if (/^(spine|chest|upperChest)$/.test(b)) return "torso";
    if (/Shoulder/.test(b)) return "sh";
    if (/^(neck|head)$/.test(b) || /Eye|Jaw/.test(b)) return "head";
    if (/^left/.test(b)) return "armL";
    if (/^right/.test(b)) return "armR";
    return "torso";
  };
  const G = {}; for (const b of ALL) G[b] = grp(b);

  // ---- easing
  const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);          // smootherstep: gentle start AND stop
  const smooth = (x) => x * x * (3 - 2 * x);
  const spring = (l) => {                                               // underdamped spring step: overshoots a little, settles
    const z = 0.62, w0 = 9, wd = w0 * Math.sqrt(1 - z * z);
    const f = (x) => 1 - Math.exp(-z * w0 * x) * (Math.cos(wd * x) + ((z * w0) / wd) * Math.sin(wd * x));
    return f(l) / f(1);
  };

  // ---- blending two poses at time t (0..1) with staggered timing, spring arms/head, anticipation and arm swing
  const qcache = new WeakMap();
  const Qs = (pose) => {
    if (!qcache.has(pose)) {
      const m = {}; for (const b of ALL) m[b] = new Q().setFromEuler(new E(pose[b][0], pose[b][1], pose[b][2], "XYZ"));
      qcache.set(pose, m);
    }
    return qcache.get(pose);
  };
  const zAxis = new V3(0, 0, 1);
  const poseAt = (A, B, t, tr) => {
    const a = Qs(A), b = Qs(B), o = {};
    for (const k of ALL) {
      const g = G[k], off = tr.off[g] ?? 0, W = 1 - tr.maxOff;
      const l = clamp((t - off) / W);                                   // this bone's own 0..1 progress
      let s = g === "armL" || g === "armR" || g === "head" ? spring(l) : smoother(l);
      if (g === "legs" || g === "torso") s -= tr.anti * Math.sin(Math.PI * clamp(l / 0.35)) * (1 - l);   // anticipation: tiny move the wrong way first
      const q = a[k].clone().slerp(b[k], s);
      if ((k === "leftUpperArm" || k === "rightUpperArm") && tr.swing) {   // swing the arms OUTSIDE the body so hands never cut through it
        const bump = Math.sin(Math.PI * l) * tr.swing;
        q.multiply(new Q().setFromAxisAngle(zAxis, k === "leftUpperArm" ? bump : -bump));
      }
      if ((k === "leftLowerArm" || k === "rightLowerArm") && tr.swing) {
        const bump = Math.sin(Math.PI * l) * tr.swing * 0.5;
        q.multiply(new Q().setFromAxisAngle(zAxis, k === "leftLowerArm" ? -bump : bump));
      }
      const e = new E().setFromQuaternion(q, "XYZ"); o[k] = [e.x, e.y, e.z];
    }
    return o;
  };
  const mkTr = (swing) => {                                              // a transition's random personality
    const sgn = Math.random() < 0.5 ? 1 : -1;                            // which arm leads
    return {
      off: { legs: 0, torso: 0.07, sh: 0.12, armL: 0.16 + (sgn > 0 ? 0.07 : 0), armR: 0.16 + (sgn < 0 ? 0.07 : 0), head: 0.26 + rnd(0, 0.06) },
      maxOff: 0.36, swing, anti: rnd(0.04, 0.08),
    };
  };
  const swingFor = (a, b) => (isHold(a) || isHold(b) || a === "mid" || b === "mid" ? cfg.swing.other : cfg.swing.rest);
  const jitter = (base) => {                                             // each visit to a pose lands a little differently
    const o = {}; for (const k in base) o[k] = base[k].slice();
    for (const [k, i, a] of [["head", 1, 0.08], ["head", 2, 0.05], ["hips", 2, 0.03], ["spine", 1, 0.05], ["leftShoulder", 2, 0.03], ["rightShoulder", 2, 0.03], ["neck", 0, 0.03]]) if (o[k]) o[k][i] += rnd(-a, a);
    return o;
  };

  // ---- state machine
  const now0 = performance.now() / 1000;
  const S = { i: 0, cur: HOME, curPose: P[HOME], next: null, nextPose: null, tr: null, phase: "hold", phaseStart: now0, hold: cfg.firstHold, dur: 0 };
  const noise = (t, a, b, c) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.7) * 0.3 + Math.sin(t * c + 4.1) * 0.2;   // smooth, never-repeating-looking wobble
  let glance = { t0: -99, dir: 0, len: 2.6 }, nextGlance = now0 + rnd(4, 8);
  const H = { cur: [0, 0, 0], tgt: [0, 0, 0], next: 0 };               // head wander
  let blinkAt = now0 + 1.5, blinkStart = -1, dbl = false, blinkVal = 0;
  const SW = { ph: 0 };
  let last = now0;
  let talking = false, talkOffAt = 0, lastBase = null;
  let thinking = false, thinkOffAt = 0;
  let emote = null;
  const sm = { val: 0, ev: null, next: 0 };                              // smile layer

  function setTalking(v) {
    const was = talking; talking = !!v;
    if (!talking) talkOffAt = performance.now() / 1000;
    else if (!was) sm.next = performance.now() / 1000 + 2.5 + rnd(0, 3);
  }
  function setThinking(v) { thinking = !!v; if (!thinking) thinkOffAt = performance.now() / 1000; }
  function playEmote(name) { const pose = cfg.emotes[name]; if (pose && P[pose]) emote = { pose, started: false, endAt: 0 }; }
  function getEmote() { return emote && emote.started && performance.now() / 1000 < emote.endAt ? emote.pose : null; }   // pose name while an emote is on
  function startMove(toName, toPose, dur, now, fromPose) {
    S.curPose = fromPose || lastBase || S.curPose; S.cur = "mid"; S.next = toName; S.nextPose = toPose;
    S.tr = mkTr(swingFor("mid", toName)); S.dur = rnd(...dur); S.phase = "move"; S.phaseStart = now;
  }
  function goHome(now, from, dur) {
    S.i = 0; S.next = HOME; S.nextPose = jitter(P[HOME]);
    S.tr = mkTr(swingFor(from, HOME)); S.dur = rnd(...dur); S.phase = "move"; S.phaseStart = now;
  }

  // ---- helpers for the hip-sway IK
  const applyP = (q, hx, hy) => {
    for (const b of ALL) { const r = q[b]; if (r) N(b).rotation.set(r[0], r[1], r[2]); }
    hips.position.set(hx, hy, HIPS_POS.z);
    vrm.scene.updateMatrixWorld(true);
  };
  const wp = (n) => { const v = new V3(); N(n).getWorldPosition(v); return v; };
  const wq = (n) => { const q = new Q(); N(n).getWorldQuaternion(q); return q; };
  const canIK = ["leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot"].every(has);

  function update(now) {
    const dt = Math.min(0.1, now - last); last = now;
    let base;

    // 1) which pose do we want right now? (emote beats talking beats thinking beats the resting loop)
    let emoteActive = false;
    if (emote) {
      if (!emote.started) {
        emote.started = true;
        startMove(emote.pose, P[emote.pose], cfg.emote.enter, now);
        emote.endAt = now + S.dur + rnd(...cfg.emote.hold);
      }
      emoteActive = now < emote.endAt;
      if (!emoteActive && S.phase === "hold" && S.cur === emote.pose) {
        if (!talking && !thinking) goHome(now, emote.pose, cfg.emote.exit);
        emote = null;                                                    // if talking/thinking, the blocks below take over
      }
    }
    if (P[cfg.talking] && !emoteActive) {
      const at = S.phase === "hold" && S.cur === cfg.talking, going = S.phase === "move" && S.next === cfg.talking;
      if (talking && !at && !going) startMove(cfg.talking, P[cfg.talking], cfg.talk.enter, now);
      else if (!talking && at && now - talkOffAt > cfg.talk.hangover && now - S.phaseStart > 1) goHome(now, cfg.talking, cfg.talk.exit);
    }
    if (P[cfg.thinking] && !talking && !emoteActive) {
      const at = S.phase === "hold" && S.cur === cfg.thinking, going = S.phase === "move" && S.next === cfg.thinking;
      if (thinking && !at && !going && S.cur !== cfg.talking) startMove(cfg.thinking, P[cfg.thinking], cfg.think.enter, now);
      else if (!thinking && at && now - thinkOffAt > cfg.think.hangover && now - S.phaseStart > 0.8) goHome(now, cfg.thinking, cfg.think.exit);
    }

    // 2) hold, or move (blend) between poses
    if (S.phase === "hold") {
      base = S.curPose;
      if (now - S.phaseStart > S.hold) {                                 // time to wander to the next resting pose
        S.i = (S.i + 1) % restNames.length; S.next = restNames[S.i]; S.nextPose = jitter(P[S.next]);
        S.tr = mkTr(swingFor(S.cur, S.next)); S.dur = rnd(...cfg.moveDur); S.phase = "move"; S.phaseStart = now;
      }
    }
    if (S.phase === "move") {
      const t = Math.min(1, (now - S.phaseStart) / S.dur);
      base = poseAt(S.curPose, S.nextPose, t, S.tr);
      if (t >= 1) {
        S.cur = S.next; S.curPose = S.nextPose; S.phase = "hold"; S.phaseStart = now;
        S.hold = isHold(S.cur) ? Infinity : S.cur === HOME ? rnd(...cfg.holdHome) : rnd(...cfg.holdOther);
        H.next = now + rnd(0.6, 1.5);
      }
    }
    lastBase = base;
    const p = {}; for (const k in base) p[k] = base[k].slice();
    const add = (b, i, v) => { if (p[b]) p[b][i] += v; };

    // 3) alive motion on top: breathing, head drift, glance, head wander, blink
    const br = (Math.sin(now * 1.45) * 0.5 + 0.5) * (0.85 + 0.15 * Math.sin(now * 0.3));
    add("chest", 0, 0.014 * br); add("upperChest", 0, 0.016 * br); add("spine", 0, 0.005 * br);
    add("leftShoulder", 2, 0.012 * br); add("rightShoulder", 2, -0.012 * br); add("neck", 0, -0.006 * br);
    add("head", 1, 0.05 * noise(now, 0.37, 0.21, 0.11)); add("head", 2, 0.03 * noise(now, 0.23, 0.13, 0.07)); add("head", 0, 0.02 * noise(now, 0.29, 0.17, 0.09));
    add("hips", 2, 0.012 * noise(now, 0.19, 0.11, 0.07)); add("hips", 1, 0.015 * noise(now, 0.17, 0.09, 0.05)); add("spine", 1, 0.012 * noise(now, 0.21, 0.13, 0.06));
    if (S.phase === "hold" && S.cur === HOME && now > nextGlance && now - glance.t0 > glance.len + 1) {
      glance = { t0: now, dir: Math.random() < 0.5 ? -1 : 1, len: rnd(2.2, 3.4) }; nextGlance = now + rnd(7, 14);
    }
    const gd = (now - glance.t0) / glance.len;
    if (gd >= 0 && gd <= 1) { const g = Math.sin(Math.PI * gd), gg = g * g * (3 - 2 * g); add("head", 1, glance.dir * 0.32 * gg); add("neck", 1, glance.dir * 0.12 * gg); add("head", 0, -0.03 * gg); }
    if (S.phase === "hold" && S.cur !== HOME) {
      const hs = S.cur === cfg.talking ? 0.6 : S.cur === cfg.thinking ? 0.2 : isHold(S.cur) ? 0.25 : 1;   // calmer head while talking / thinking / emoting
      if (now > H.next) { H.tgt = [rnd(-0.06, 0.07) * hs, rnd(-0.28, 0.28) * hs, rnd(-0.14, 0.14) * hs]; H.next = now + rnd(1.4, 3); }
    } else H.tgt = [0, 0, 0];
    const kH = 1 - Math.exp(-dt * (S.phase === "hold" ? 2.2 : 1.2));
    for (let i = 0; i < 3; i++) H.cur[i] += (H.tgt[i] - H.cur[i]) * kH;
    add("head", 0, H.cur[0]); add("head", 1, H.cur[1]); add("head", 2, H.cur[2]); add("neck", 1, H.cur[1] * 0.35); add("neck", 2, H.cur[2] * 0.35);
    if (cfg.blink && vrm.expressionManager) {
      if (blinkStart < 0 && now > blinkAt) { blinkStart = now; dbl = Math.random() < 0.2; }
      if (blinkStart >= 0) {
        const d = Math.max(0, (now - blinkStart) / 0.2); blinkVal = d < 1 ? Math.sin(d * Math.PI) : 0;
        if (d >= 1) { blinkVal = 0; if (dbl) { dbl = false; blinkStart = now + 0.12; } else { blinkStart = -1; blinkAt = now + rnd(2.2, 6); } }
      }
      vrm.expressionManager.setValue("blink", blinkVal);
    }

    // 4) random small smiles while she is settled into the talking pose (read director.smile and add it to your "happy" weight)
    if (cfg.smile.on) {
      const active = talking && S.cur === cfg.talking && S.phase === "hold";
      if (active && !sm.ev && now > sm.next) sm.ev = { t0: now, rise: rnd(0.4, 0.7), hold: rnd(1, 2.2), fall: rnd(0.6, 1.0), peak: rnd(...cfg.smile.peak) };
      let target = 0;
      if (sm.ev) {
        const e = sm.ev, t = now - e.t0;
        if (t < e.rise) target = e.peak * smooth(t / e.rise);
        else if (t < e.rise + e.hold) target = e.peak;
        else if (t < e.rise + e.hold + e.fall) target = e.peak * (1 - smooth((t - e.rise - e.hold) / e.fall));
        else { sm.ev = null; sm.next = now + rnd(...cfg.smile.gap); }
      }
      sm.val = target;
    }

    // 5) hip sway with leg IK: the ankles stay exactly where the pose put them while hips and knees absorb the motion
    let dx = 0, dy = 0;
    if (cfg.sway.on && canIK) {
      SW.ph += (dt * 2 * Math.PI) / cfg.sway.period;
      applyP(p, 0, HIPS_BASE);
      const base2 = {};
      for (const s of ["left", "right"]) {
        const b = { A: wp(s + "Foot"), K0: wp(s + "LowerLeg"), H: wp(s + "UpperLeg"), FQ: wq(s + "Foot") };
        b.L1 = b.H.distanceTo(b.K0); b.L2 = b.K0.distanceTo(b.A); base2[s] = b;
      }
      const ph = SW.ph, sn = Math.sin(ph);
      dx = cfg.sway.dx * sn; dy = -cfg.sway.dy * (0.5 - 0.5 * Math.cos(2 * ph + 0.4));
      const hz = cfg.sway.hz * Math.sin(ph + 0.3), hyaw = cfg.sway.hyaw * Math.sin(ph - 1.2), tw = cfg.sway.twist * Math.sin(ph - 0.5);
      p.hips = [p.hips[0], p.hips[1] + hyaw, p.hips[2] + hz];
      if (p.spine) p.spine = [p.spine[0], p.spine[1] - hyaw * 0.8 + tw * 0.65, p.spine[2] - hz * 0.6];
      if (p.chest) p.chest = [p.chest[0], p.chest[1] + tw * 0.35, p.chest[2] - hz * 0.25];
      if (p.head) p.head = [p.head[0], p.head[1] - tw * 0.5, p.head[2]];
      applyP(p, dx, HIPS_BASE + dy);
      for (const s of ["left", "right"]) {                              // two-bone IK: put each ankle back where it was
        const B = base2[s], Hp = wp(s + "UpperLeg"), AH = B.A.clone().sub(Hp);
        let d = Math.min(AH.length(), B.L1 + B.L2 - 1e-4); const dir = AH.normalize();
        const a = (B.L1 * B.L1 - B.L2 * B.L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, B.L1 * B.L1 - a * a));
        const pole = B.K0.clone().sub(B.H); const perp = pole.clone().addScaledVector(dir, -pole.dot(dir));
        if (perp.length() < 1e-5) perp.set(0, 0, 1); perp.normalize();
        const K = Hp.clone().addScaledVector(dir, a).addScaledVector(perp, h), Aeff = Hp.clone().addScaledVector(dir, d);
        const pq = wq("hips");
        const qU = new Q().setFromUnitVectors(DOWN, K.clone().sub(Hp).normalize().applyQuaternion(pq.clone().invert()));
        const qWU = pq.clone().multiply(qU);
        const qL = new Q().setFromUnitVectors(DOWN, Aeff.clone().sub(K).normalize().applyQuaternion(qWU.clone().invert()));
        const qWL = qWU.clone().multiply(qL), qF = qWL.clone().invert().multiply(B.FQ);
        const eU = new E().setFromQuaternion(qU, "XYZ"), eL = new E().setFromQuaternion(qL, "XYZ"), eF = new E().setFromQuaternion(qF, "XYZ");
        p[s + "UpperLeg"] = [eU.x, eU.y, eU.z]; p[s + "LowerLeg"] = [eL.x, eL.y, eL.z]; p[s + "Foot"] = [eF.x, eF.y, eF.z];
        N(s + "UpperLeg").rotation.set(eU.x, eU.y, eU.z); N(s + "LowerLeg").rotation.set(eL.x, eL.y, eL.z); vrm.scene.updateMatrixWorld(true);
      }
    }

    // 6) write the final pose to the avatar
    for (const b of ALL) { const r2 = p[b]; N(b).rotation.set(r2[0], r2[1], r2[2]); }
    hips.position.set(dx, HIPS_BASE + dy, HIPS_POS.z);
  }

  return { update, setTalking, setThinking, playEmote, getEmote, get smile() { return sm.val; }, state: S, config: cfg, poses: P };
}
