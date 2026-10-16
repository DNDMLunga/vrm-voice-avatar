"""
Convert a VRoid Studio pose file (.vroidpose) into a pose for poses.json. Python standard library only.

    python tools/vroidpose_to_pose.py "My Pose.vroidpose" --name talking --into poses.json
    python tools/vroidpose_to_pose.py "My Pose.vroidpose" --name thinking --chest-scale 0.3 --into poses.json
    python tools/vroidpose_to_pose.py "My Pose.vroidpose"            # just print the pose JSON

HOW THE CONVERSION WORKS (this exact rule was verified against VRoid screenshots):
  * a .vroidpose is JSON; BoneDefinition holds one quaternion {x,y,z,w} per bone (Unity convention, left-handed).
  * VRM / three.js use a right-handed system, so each quaternion (x, y, z, w) becomes (x, -y, -z, w).
  * bone names keep their meaning: "LeftUpperArm" -> "leftUpperArm" (do NOT swap left and right).
  * the quaternion is then written as Euler XYZ angles in radians (three.js order), which is what poses.json stores.
  * HipsPosition, toes and the spine control point are skipped (VRoid-only data).
  * Arms, legs and hands convert exactly. The SPINE needs help: VRoid also bends the spine with a hidden
    "control point" that the file does not store, so a raw conversion can look over-arched. Two optional fixes:
      --chest-scale 0.3   scale the chest and upperChest forward/back bend (x) to 30% (try 0.3 to 0.5)
                          and counter-rotate the neck and shoulders by the amount removed so the head and hands keep
                          the orientation the file gave them.  Rule: whenever you reduce chest pitch, rotate every
                          child bone back by the same amount.
      --left-shoulder-factor 0.6   use less than 100% of that counter-rotation on the left shoulder (tilts that arm
                          forward, away from the chest). Mirror it with --right-shoulder-factor.
  * If the whole body comes out turned sideways, the file's Hips has a large yaw (VRoid's view was frontal).
    Fix with --hips-yaw-deg -90 (then fine-tune by eye against your VRoid screenshot).
"""
import argparse
import json
import math
import shutil
import sys
from pathlib import Path

SKIP = {"HipsPosition", "SpineControlPointDeltaPosition", "LeftToes", "RightToes"}


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)


def quat_to_euler_xyz(q):
    """three.js Euler 'XYZ' from a quaternion (via the rotation matrix, same maths as three.js)."""
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    m11, m12, m13 = 1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)
    m22, m23 = 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)
    m32, m33 = 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)
    ey = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        ex, ez = math.atan2(-m23, m33), math.atan2(-m12, m11)
    else:
        ex, ez = math.atan2(m32, m22), 0.0
    return [ex, ey, ez]


def convert(path, chest_scale=None, left_sh=1.0, right_sh=1.0, hips_yaw_deg=0.0):
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    bones = data["BoneDefinition"]
    pose = {}
    for name, q in bones.items():
        if name in SKIP or not isinstance(q, dict) or "w" not in q:
            continue
        quat = (q["x"], -q["y"], -q["z"], q["w"])                          # Unity -> three.js handedness
        if name == "Hips" and hips_yaw_deg:
            h = math.radians(hips_yaw_deg) / 2
            quat = quat_mul((0, math.sin(h), 0, math.cos(h)), quat)       # premultiply a yaw about Y
        key = name[0].lower() + name[1:]
        pose[key] = [round(v, 4) for v in quat_to_euler_xyz(quat)]
    if chest_scale is not None:
        removed = 0.0
        for b in ("chest", "upperChest"):
            if b in pose:
                new = pose[b][0] * chest_scale
                removed += pose[b][0] - new
                pose[b][0] = round(new, 4)
        # children keep their file orientation: rotate them back by what was removed from the chest
        for b, f in (("neck", 1.0), ("leftShoulder", left_sh), ("rightShoulder", right_sh)):
            if b in pose:
                pose[b][0] = round(pose[b][0] + removed * f, 4)
    return pose, data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", help=".vroidpose file")
    ap.add_argument("--name", default="pose", help="key to store the pose under in poses.json")
    ap.add_argument("--into", help="poses.json to update (a .bak copy is made first)")
    ap.add_argument("--chest-scale", type=float, help="scale chest/upperChest bend, e.g. 0.3")
    ap.add_argument("--left-shoulder-factor", type=float, default=1.0)
    ap.add_argument("--right-shoulder-factor", type=float, default=1.0)
    ap.add_argument("--hips-yaw-deg", type=float, default=0.0)
    a = ap.parse_args()
    pose, data = convert(a.file, a.chest_scale, a.left_shoulder_factor, a.right_shoulder_factor, a.hips_yaw_deg)
    hips = pose.get("hips", [0, 0, 0])
    if abs(math.degrees(hips[1])) > 45 and not a.hips_yaw_deg:
        print(f"WARNING: hips yaw is {math.degrees(hips[1]):.0f} degrees. If the body looks sideways, retry with --hips-yaw-deg {-round(math.degrees(hips[1]))}", file=sys.stderr)
    if not a.into:
        print(json.dumps({a.name: pose}, indent=1))
        return 0
    target = Path(a.into)
    store = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
    if target.exists():
        shutil.copy2(target, str(target) + ".bak")
    store[a.name] = pose
    target.write_text(json.dumps(store, indent=1), encoding="utf-8")
    print(f"saved pose '{a.name}' ({len(pose)} bones) into {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
