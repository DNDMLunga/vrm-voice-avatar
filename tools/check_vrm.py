"""
Inspect a .vrm file and say whether it will work with this viewer. Python standard library only.

    python tools/check_vrm.py assets/avatar.vrm

Reports: VRM version, the humanoid bones it has, whether the face expressions the viewer uses exist,
and whether hair/clothing physics (spring bones) were exported. Exit code 0 = good to go, 1 = problems.
"""
import json
import struct
import sys

NEEDED_BONES = ["hips", "spine", "chest", "neck", "head", "leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm",
                "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot"]
MOUTH = ["aa", "ih", "ou", "ee", "oh"]
FACES = ["happy", "relaxed", "surprised", "sad", "angry", "blink"]


def read_glb_json(path):
    with open(path, "rb") as f:
        magic, version, _ = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF":
            raise ValueError("not a .vrm/.glb file (missing glTF header)")
        length, ctype = struct.unpack("<II", f.read(8))
        return json.loads(f.read(length))


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    try:
        j = read_glb_json(sys.argv[1])
    except Exception as exc:
        print("PROBLEM: could not read file:", exc)
        return 1
    ext = j.get("extensions", {})
    problems = []
    if "VRMC_vrm" in ext:
        vrm = ext["VRMC_vrm"]
        print("VRM version : 1.0 (VRMC_vrm", vrm.get("specVersion", "?") + ")")
        bones = {k for k, v in vrm.get("humanoid", {}).get("humanBones", {}).items() if v}
        exprs = vrm.get("expressions", {})
        names = set(exprs.get("preset", {}).keys()) | set(exprs.get("custom", {}).keys())
        springs = "VRMC_springBone" in ext
    elif "VRM" in ext:
        vrm = ext["VRM"]
        print("VRM version : 0.x  (works: the viewer calls VRMUtils.rotateVRM0)")
        bones = {b.get("bone") for b in vrm.get("humanoid", {}).get("humanBones", [])}
        names = {g.get("presetName", "").lower() for g in vrm.get("blendShapeMaster", {}).get("blendShapeGroups", [])}
        springs = bool(vrm.get("secondaryAnimation", {}).get("boneGroups"))
        print("note        : VRM 0.x names expressions differently (joy/sorrow/fun, a/i/u/e/o); three-vrm maps them, but re-export as VRM 1.0 if the face looks wrong")
    else:
        print("PROBLEM: no VRM data in this file. It is a plain glTF/GLB, not a VRM. Export from VRoid Studio as VRM.")
        return 1
    missing = [b for b in NEEDED_BONES if b not in bones]
    print("bones       :", len(bones), "humanoid bones;", ("ALL REQUIRED PRESENT" if not missing else "MISSING " + ", ".join(missing)))
    if missing:
        problems.append("missing required bones")
    print("optional    :", ", ".join(b for b in ["upperChest", "leftShoulder", "rightShoulder", "leftToes", "rightToes"] if b in bones) or "none", "(poses use these when present)")
    if "VRMC_vrm" in ext:
        print("mouth shapes:", ", ".join(f"{m}{'' if m in names else ' (MISSING)'}" for m in MOUTH))
        print("face shapes :", ", ".join(f"{m}{'' if m in names else ' (MISSING)'}" for m in FACES))
        if any(m not in names for m in MOUTH + ["blink"]):
            problems.append("mouth/blink expressions missing: lip sync or blinking will not work")
    print("physics     :", "hair/clothing spring bones present" if springs else "NO spring bones (hair will be stiff). In VRoid, check Hair > Physics before exporting")
    meta = ext.get("VRMC_vrm", {}).get("meta") or ext.get("VRM", {}).get("meta") or {}
    print("licence info:", meta.get("licenseUrl") or meta.get("licenseName") or meta.get("otherLicenseUrl") or "(not set)", "| author:", meta.get("authors") or meta.get("author") or "(not set)")
    print()
    print("RESULT:", "good to go" if not problems else "problems found: " + "; ".join(problems))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
