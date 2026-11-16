"""Compare the python and node ladders BY VALUE (not as text), and prove the comparer can fail.
   python3 materials/compare-ladder.py py.json node.json
Numbers compare numerically (JSON 0 and 0.0 are the same value). Exit 0 only if every value matches
AND a planted fault (one rebuild time +0.1 s, one lint id dropped) is caught."""
import copy, json, sys


def walk(a, b, path, bad):
    num = (int, float)
    if isinstance(a, bool) or isinstance(b, bool):
        if a is not b:
            bad.append(f"{path}: {a!r} != {b!r}")
        return 1
    if isinstance(a, num) and isinstance(b, num):
        if a != b:
            bad.append(f"{path}: {a!r} != {b!r}")
        return 1
    if type(a) != type(b):
        bad.append(path + " type"); return 1
    if isinstance(a, dict):
        if set(a) != set(b):
            bad.append(path + " keys " + str(sorted(set(a) ^ set(b)))); return 1
        return sum(walk(a[k], b[k], path + "/" + k, bad) for k in a)
    if isinstance(a, list):
        if len(a) != len(b):
            bad.append(path + " len"); return 1
        return sum(walk(x, y, f"{path}[{i}]", bad) for i, (x, y) in enumerate(zip(a, b)))
    if a != b:
        bad.append(f"{path}: {a!r} != {b!r}")
    return 1


py, nd = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
bad = []
n = walk(py, nd, "", bad)
print(f"{n} values compared, {len(bad)} differ")
for b in bad[:20]:
    print("  ", b)
planted = copy.deepcopy(nd)
planted["slim"]["deps"]["rebuild_s"] = round(planted["slim"]["deps"]["rebuild_s"] + 0.1, 1)
planted["naive"]["lint"] = planted["naive"]["lint"][1:]
pb = []
walk(py, planted, "", pb)
print("planted fault caught:", len(pb) == 2)
sys.exit(0 if not bad and len(pb) == 2 else 1)
