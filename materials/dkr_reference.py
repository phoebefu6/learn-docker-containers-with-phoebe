"""Python twin of assets/dkr-live.js (the layer cache lab). Written independently from the same rules,
so a disagreement with the browser engine is a bug in one of them.

  python3 materials/dkr_reference.py ladder > py.json     every preset x every change + both anti-levers
  python3 materials/dkr_reference.py test                 the shared unit tests (dkr_rule_tests.json)

Cache rules (Docker docs, "Build cache invalidation", read 2026-11-16): COPY/ADD invalidate when a
copied file changes (mtime ignored); RUN is never invalidated by itself; once invalidated, every later
instruction in the stage rebuilds; BuildKit builds only the stages the target depends on.
Times and apt/apk sizes are modelled parameters from the sample file.
"""
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STEP = {"RUN", "COPY", "ADD", "WORKDIR"}
SECRET_RE = re.compile(r"(PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)", re.I)
APT_INSTALL = re.compile(r"\bapt-get\b[^&;|]*\binstall\b")
APT_LISTS_RM = re.compile(r"rm\s+-rf?\s+/var/lib/apt/lists")
CACHE_MOUNT = re.compile(r"--mount=[^\s]*type=cache")


def r1(x):
    return math.floor(x * 10 + 0.5) / 10


def r2(x):
    return math.floor(x * 100 + 0.5) / 100


def load_sample():
    txt = open(os.path.join(HERE, "..", "assets", "dkr-sample.js")).read()
    a = txt.index("window.DKR_SAMPLE = ") + 20
    return json.loads(txt[a:txt.rindex(";")])


def split_words(s):
    out, cur, q = [], "", None
    for c in s:
        if q:
            if c == q:
                q = None
            else:
                cur += c
            continue
        if c in "\"'":
            q = c
            continue
        if c in " \t":
            if cur != "":
                out.append(cur)
                cur = ""
            continue
        cur += c
    if cur != "":
        out.append(cur)
    return out


def parse(text):
    lines = re.sub(r"\r\n?", "\n", text or "").split("\n")
    instrs, errors, buf, start = [], [], "", 0
    for i, raw in enumerate(lines):
        t = raw.lstrip()
        if buf == "" and (t == "" or t.startswith("#")):
            continue
        if buf != "" and t.startswith("#"):
            continue
        if buf == "":
            start = i + 1
        cont = re.search(r"\\\s*$", raw) is not None
        piece = re.sub(r"\\\s*$", "", raw) if cont else raw
        buf += ("" if buf == "" else " ") + piece.strip()
        if cont and i < len(lines) - 1:
            continue
        m = re.match(r"^([A-Za-z]+)\s*(.*)$", buf)
        if not m:
            errors.append(f"line {start}: cannot read")
            buf = ""
            continue
        instrs.append({"line": start, "kw": m.group(1).upper(), "args": m.group(2), "text": buf})
        buf = ""
    stages = []
    for ins in instrs:
        if ins["kw"] == "FROM":
            w = [x for x in split_words(ins["args"]) if not x.startswith("--")]
            name = w[2].lower() if len(w) >= 3 and w[1].upper() == "AS" else None
            stages.append({"index": len(stages), "name": name, "ref": w[0] if w else "", "instrs": []})
        if not stages:
            errors.append(f"line {ins['line']}: {ins['kw']} before any FROM")
            continue
        ins["stage"] = len(stages) - 1
        stages[-1]["instrs"].append(ins)
    if not stages and not errors:
        errors.append("no FROM instruction")
    return {"instrs": instrs, "stages": stages, "errors": errors}


def clean_pat(p):
    p = p.strip()
    while p.startswith("./"):
        p = p[2:]
    return p.lstrip("/").rstrip("/")


def glob_re(p):
    s, i = "", 0
    while i < len(p):
        c = p[i]
        if c == "*":
            if p[i + 1:i + 2] == "*":
                if p[i + 2:i + 3] == "/":
                    s += "(?:.*/)?"
                    i += 2
                else:
                    s += ".*"
                    i += 1
            else:
                s += "[^/]*"
        elif c == "?":
            s += "[^/]"
        elif c in "\\^$.|+()[]{}":
            s += "\\" + c
        else:
            s += c
        i += 1
    return "^" + s + "$"


def pat_matches(rx, path):
    parts = path.split("/")
    for n in range(len(parts), 0, -1):
        if rx.search("/".join(parts[:n])):
            return True
    return False


def parse_ignore(text):
    rules = []
    for l in re.sub(r"\r\n?", "\n", text or "").split("\n"):
        if l.startswith("#"):
            continue
        t = l.strip()
        if t == "":
            continue
        neg = t.startswith("!")
        if neg:
            t = t[1:]
        t = clean_pat(t)
        if t == "":
            continue
        rules.append({"neg": neg, "re": re.compile(glob_re(t))})
    return rules


def excluded(rules, path):
    ex = False
    for r in rules:
        if pat_matches(r["re"], path):
            ex = not r["neg"]
    return ex


def context_files(files, ignore_text):
    rules = parse_ignore(ignore_text)
    return [f for f in files if not excluded(rules, f["path"])]


def copy_sources(args):
    w = split_words(args)
    if w and w[0].startswith("["):
        try:
            w = json.loads(args)
        except ValueError:
            w = []
    flags, rest = {}, []
    for x in w:
        if x.startswith("--"):
            kv = x[2:].split("=")
            flags[kv[0].lower()] = "=".join(kv[1:])
        else:
            rest.append(x)
    return {"flags": flags, "srcs": rest[:max(0, len(rest) - 1)], "dest": rest[-1] if rest else ""}


def files_for(srcs, ctx):
    out, seen = [], set()
    for s in srcs:
        c = clean_pat(s)
        rx = re.compile(glob_re(c))
        for f in ctx:
            if f["path"] in seen:
                continue
            if c in ("", ".") or pat_matches(rx, f["path"]):
                seen.add(f["path"])
                out.append(f)
    return out


def resolve_ref(ref, S):
    r, digest = ref.lower(), None
    if "@" in r:
        r, digest = r.split("@", 1)
    tagged = r.rfind(":") > r.rfind("/")
    key = r if tagged else r + ":latest"
    if key.startswith("library/"):
        key = key[8:]
    if key.startswith("docker.io/library/"):
        key = key[18:]
    base = None
    for b in S["bases"]:
        if b["ref"] == key:
            base = b
    return {"key": key, "tagged": tagged, "digest": digest, "scratch": r == "scratch", "base": base,
            "musl": "alpine" in key}


def words_after(cmd, word):
    w = split_words(cmd)
    if word not in w:
        return []
    out = []
    for x in w[w.index(word) + 1:]:
        if x in ("&&", ";", "||", "|"):
            break
        out.append(x)
    return out


def run_cost(ins, ctx):
    S = ctx["S"]
    M, cmd = S["model"], ins["args"]
    parts, s, mb, pip_mb, notes = [], 0, 0, 0, []
    cache_mount = CACHE_MOUNT.search(cmd) is not None
    if APT_INSTALL.search(cmd):
        pk = [x for x in words_after(cmd, "install") if not x.startswith("-")]
        rec = "--no-install-recommends" not in cmd
        amb = 0
        for p in pk:
            t = M["apt"].get(p.split("=")[0], [5.0, 10.0])
            amb += t[1] if rec else t[0]
        lists = re.search(r"\bapt-get\s+update\b", cmd) is not None and not APT_LISTS_RM.search(cmd)
        if lists:
            amb += M["apt_lists_mb"]
            notes.append("apt lists left in the layer")
        s += M["apt_base_s"] + len(pk) * M["apt_pkg_s"]
        mb += amb
        if any(p.split("=")[0] in ("build-essential", "gcc") for p in pk):
            ctx["compiler"] = True
        parts.append("apt")
    if re.search(r"\bapk\s+add\b", cmd):
        ak = [x for x in words_after(cmd, "add") if not x.startswith("-")]
        bmb = 0
        for p in ak:
            bmb += M["apk"].get(p.split("=")[0], 5.0)
        if "--no-cache" not in cmd:
            bmb += M["apk_cache_mb"]
        s += M["apk_base_s"] + len(ak) * M["apt_pkg_s"]
        mb += bmb
        if any(p.split("=")[0] in ("build-base", "gcc") for p in ak):
            ctx["compiler"] = True
        parts.append("apk")
    if re.search(r"\bpip3?\s+install\b", cmd) or re.search(r"python3?\s+-m\s+pip\s+install\b", cmd):
        pw, pkgs, reqs = words_after(cmd, "install"), [], False
        i = 0
        while i < len(pw):
            if pw[i] in ("-r", "--requirement"):
                reqs = True
                i += 2
                continue
            if pw[i].startswith("--requirement="):
                reqs = True
            elif not pw[i].startswith("-"):
                pkgs.append(pw[i])
            i += 1
        lst = list(S["packages"]) if reqs else []
        for n in pkgs:
            nm = re.split(r"[=<>!~\[]", n)[0].lower()
            hit = next((p for p in S["packages"] if p["name"] == nm), None)
            if hit is None or hit not in lst:
                lst.append(hit or {"name": nm, "glibc_mb": M["pip_unknown_mb"], "musl_mb": M["pip_unknown_mb"]})
        no_cache = "--no-cache-dir" in cmd or bool(ctx["env"].get("PIP_NO_CACHE_DIR")) or cache_mount
        warm = cache_mount and not ctx["cold"]
        sizes, sdists = 0, []
        for p in lst:
            sd = False
            if ctx["musl"]:
                if p.get("musl_mb") is None:
                    sz, sd = p["glibc_mb"], True
                else:
                    sz = p["musl_mb"]
            else:
                sz = p["glibc_mb"]
            s += M["pip_pkg_s"] + sz * M["pip_s_per_mb"] + (0 if warm else sz * M["pip_dl_s_per_mb"]) + (M["sdist_build_s"] if sd else 0)
            sizes += sz
            if sd:
                sdists.append(p["name"])
        pip_mb += sizes
        mb += sizes + (0 if no_cache else sizes)
        if not no_cache:
            notes.append("pip cache kept in the layer")
        if sdists:
            notes.append("no musllinux wheel: " + ", ".join(sdists) + " compiled from source")
            if not ctx["compiler"]:
                ctx["fails"].append(f"line {ins['line']}: no compiler")
        parts.append("pip")
    if re.search(r"\b(useradd|adduser|groupadd|addgroup)\b", cmd):
        s += M["user_s"]
        mb += M["user_mb"]
        parts.append("user")
    if not parts:
        s += M["run_other_s"]
    return {"s": s, "mb": mb, "pip_mb": pip_mb, "note": "; ".join(notes)}


def build(dockerfile, ignore_text, change_id, S):
    P, M = parse(dockerfile), S["model"]
    res = {"ok": not P["errors"], "errors": list(P["errors"])}
    if not res["ok"]:
        return res
    ctx_files = context_files(S["files"], ignore_text)
    change = next((c for c in S["changes"] if c["id"] == change_id), S["changes"][0])
    changed_path, base_moved = change["path"], change["id"] == "base"
    names = {st["name"]: st["index"] for st in P["stages"] if st["name"]}

    def stage_ref(v):
        if v is None:
            return -1
        lv = str(v).lower()
        if lv in names:
            return names[lv]
        if re.fullmatch(r"\d+", lv) and int(lv) < len(P["stages"]):
            return int(lv)
        return -1

    final, need = len(P["stages"]) - 1, set()

    def mark(i):
        if i in need:
            return
        need.add(i)
        for ins in P["stages"][i]["instrs"]:
            if ins["kw"] == "FROM":
                f = stage_ref(P["stages"][i]["ref"])
                if f >= 0 and f != i:
                    mark(f)
            if ins["kw"] in ("COPY", "ADD"):
                f2 = stage_ref(copy_sources(ins["args"])["flags"].get("from"))
                if f2 >= 0 and f2 != i:
                    mark(f2)
    mark(final)

    def walk(cold):
        out = {"rows": [], "s": 0, "steps": 0, "hits": 0, "pulls": set(), "fails": []}
        sinfo = []
        for si, st in enumerate(P["stages"]):
            info = {"name": st["name"] or f"stage {si}", "needed": si in need, "changed": False, "pip_mb": 0,
                    "layers_mb": 0, "base_mb": 0, "base": None, "secret": False}
            sinfo.append(info)
            if si not in need:
                for ins in st["instrs"]:
                    out["rows"].append({"stage": si, "line": ins["line"], "kw": ins["kw"], "status": "skipped", "s": 0, "mb": 0})
                continue
            invalid = False
            ctx = {"S": S, "env": {}, "cold": cold, "musl": False, "compiler": False, "fails": out["fails"]}
            for ins in st["instrs"]:
                cost, mb, causes = 0, 0, False
                kw = ins["kw"]
                if kw == "FROM":
                    fs = stage_ref(st["ref"])
                    if fs >= 0 and fs != si:
                        src = sinfo[fs]
                        info["base_mb"] = src["base_mb"] + src["layers_mb"]
                        info["pip_mb"] = src["pip_mb"]
                        info["base"] = src["base"]
                        ctx["musl"] = src["base"]["musl"] if src["base"] else False
                        causes = src["changed"]
                    else:
                        rr = resolve_ref(st["ref"], S)
                        info["base"] = rr
                        ctx["musl"] = rr["musl"]
                        info["base_mb"] = rr["base"]["mb"] if rr["base"] else 0
                        pulled = rr["key"] in out["pulls"]
                        if cold and not pulled and rr["base"]:
                            cost = rr["base"]["mb"] * M["pull_s_per_mb"]
                            out["pulls"].add(rr["key"])
                        if not cold and base_moved and not rr["digest"] and not rr["scratch"]:
                            causes = True
                            if not pulled and rr["base"]:
                                cost = rr["base"]["mb"] * M["pull_s_per_mb"]
                                out["pulls"].add(rr["key"])
                elif kw in ("COPY", "ADD"):
                    cs = copy_sources(ins["args"])
                    if "from" in cs["flags"]:
                        fs = stage_ref(cs["flags"]["from"])
                        if fs >= 0:
                            mb = sinfo[fs]["pip_mb"]
                            causes = sinfo[fs]["changed"]
                            info["pip_mb"] += sinfo[fs]["pip_mb"]
                    else:
                        fl = files_for(cs["srcs"], ctx_files)
                        tot = 0
                        for f in fl:
                            tot += f["mb"]
                            if f["kind"] == "secret":
                                info["secret"] = True
                        mb = tot
                        if changed_path and not cold and any(f["path"] == changed_path for f in fl):
                            causes = True
                    cost = M["copy_s"] + mb * M["copy_s_per_mb"]
                elif kw == "RUN":
                    rc = run_cost(ins, ctx)
                    cost, mb = rc["s"], rc["mb"]
                    info["pip_mb"] += rc["pip_mb"]
                elif kw == "ENV":
                    ew = split_words(ins["args"])
                    if len(ew) == 2 and "=" not in ew[0]:
                        ctx["env"][ew[0]] = ew[1]
                    else:
                        for kv in ew:
                            p = kv.split("=")
                            if len(p) > 1:
                                ctx["env"][p[0]] = "=".join(p[1:])
                    cost = M["meta_s"]
                else:
                    cost = M["meta_s"]
                if cold or causes:
                    invalid = True
                rebuilt = cold or invalid
                if kw == "FROM":
                    rebuilt = cold or causes
                if kw in STEP:
                    out["steps"] += 1
                    if not rebuilt:
                        out["hits"] += 1
                row_s = 0
                if rebuilt:
                    row_s = cost
                    out["s"] += cost
                    info["changed"] = True
                row_mb = 0 if kw == "FROM" else mb
                info["layers_mb"] += row_mb
                out["rows"].append({"stage": si, "line": ins["line"], "kw": kw,
                                    "status": "rebuilt" if rebuilt else "cached", "s": row_s, "mb": row_mb})
        out["sinfo"] = sinfo
        return out

    ctx_mb = 0
    for f in ctx_files:
        ctx_mb += f["mb"]
    cold, warm = walk(True), walk(False)
    send_warm = 0
    if changed_path:
        for f in ctx_files:
            if f["path"] == changed_path:
                send_warm += f["mb"]
    fin = warm["sinfo"][final]
    res.update({
        "context_mb": r2(ctx_mb), "context_files": len(ctx_files),
        "cold_s": r1(cold["s"] + ctx_mb * M["context_s_per_mb"]),
        "rebuild_s": r1(warm["s"] + send_warm * M["context_s_per_mb"]),
        "hits": warm["hits"], "steps": warm["steps"],
        "base_mb": r2(fin["base_mb"]), "image_mb": r2(fin["base_mb"] + fin["layers_mb"]),
        "secret_file_in_image": fin["secret"], "fails": list(cold["fails"]),
        "rows": [{**r, "s": r1(r["s"]), "mb": r2(r["mb"])} for r in warm["rows"]],
    })
    return res


def lint(dockerfile, ignore_text, S):
    P, out = parse(dockerfile), []
    if P["errors"]:
        return out
    hit = lambda rid, line: out.append({"rule": rid, "line": line})
    names = {st["name"] for st in P["stages"] if st["name"]}
    env_excluded = excluded(parse_ignore(ignore_text), ".env")
    for si, st in enumerate(P["stages"]):
        is_final = si == len(P["stages"]) - 1
        last_user, last_user_line, saw_whole, whole_line, order_fired, pip_env_off = None, 0, False, 0, False, False
        for ins in st["instrs"]:
            a, kw = ins["args"], ins["kw"]
            if kw == "FROM":
                ref = st["ref"].lower()
                if ref not in names and ref != "scratch" and "@" not in ref:
                    if ref.rfind(":") <= ref.rfind("/"):
                        hit("DL3006", ins["line"])
                    elif ref.endswith(":latest"):
                        hit("DL3007", ins["line"])
            if kw == "WORKDIR":
                w = split_words(a)
                wd = w[0] if w else ""
                if not wd.startswith("/") and not wd.startswith("$") and not re.match(r"^[A-Za-z]:", wd):
                    hit("DL3000", ins["line"])
            if kw == "ADD":
                c = copy_sources(a)
                if any(not re.match(r"^(https?|git)://", s) and not re.search(r"\.(tar|tar\.gz|tgz|tar\.bz2|tar\.xz|txz)$", s) for s in c["srcs"]):
                    hit("DL3020", ins["line"])
            if kw == "ENV":
                ew = split_words(a)
                if len(ew) == 2 and "=" not in ew[0]:
                    if ew[0] == "PIP_NO_CACHE_DIR":
                        pip_env_off = True
                elif any(kv.split("=")[0] == "PIP_NO_CACHE_DIR" for kv in ew):
                    pip_env_off = True
            if kw in ("ENV", "ARG"):
                w2 = split_words(a)
                keys = [w2[0]] if kw == "ENV" and len(w2) == 2 and "=" not in w2[0] else [kv.split("=")[0] for kv in w2]
                if any(SECRET_RE.search(k) for k in keys):
                    hit("DL3064", ins["line"])
            if kw == "RUN":
                if APT_INSTALL.search(a):
                    if "--no-install-recommends" not in a:
                        hit("DL3015", ins["line"])
                    if not APT_LISTS_RM.search(a):
                        hit("DL3009", ins["line"])
                is_pip = re.search(r"\bpip3?\s+install\b", a) or re.search(r"python3?\s+-m\s+pip\s+install\b", a)
                if is_pip and "--no-cache-dir" not in a and not pip_env_off and not CACHE_MOUNT.search(a):
                    hit("DL3042", ins["line"])
                if is_pip and saw_whole and not order_fired:
                    hit("DKR-ORDER", whole_line)
                    order_fired = True
            if kw in ("COPY", "ADD"):
                cc = copy_sources(a)
                if "from" not in cc["flags"] and any(clean_pat(s) in ("", ".") for s in cc["srcs"]):
                    if not saw_whole:
                        saw_whole, whole_line = True, ins["line"]
                    if not env_excluded:
                        hit("DKR-CONTEXT", ins["line"])
            if kw in ("CMD", "ENTRYPOINT") and not a.lstrip().startswith("["):
                hit("DL3025", ins["line"])
            if kw == "USER":
                w = split_words(a)
                last_user, last_user_line = (w[0] if w else "").split(":")[0], ins["line"]
        if is_final:
            if last_user is None:
                hit("DKR-USER", st["instrs"][0]["line"])
            elif last_user in ("root", "0"):
                hit("DL3002", last_user_line)
    return out


def break_copy_first(dockerfile):
    P = parse(dockerfile)
    if P["errors"]:
        return dockerfile
    target = next((st for st in P["stages"] if any(i["kw"] == "RUN" and re.search(r"pip3?\s+install", i["args"]) for i in st["instrs"])), P["stages"][-1])
    for tj in target["instrs"]:
        if tj["kw"] == "RUN" and re.search(r"pip3?\s+install", tj["args"]):
            break
        if tj["kw"] == "COPY":
            cs = copy_sources(tj["args"])
            if "from" not in cs["flags"] and any(clean_pat(s) in ("", ".") for s in cs["srcs"]):
                return dockerfile
    after = next((i for i in target["instrs"] if i["kw"] == "WORKDIR"), target["instrs"][0])
    lines = re.sub(r"\r\n?", "\n", dockerfile).split("\n")
    lines.insert(after["line"], "COPY . .")
    return "\n".join(lines)


def break_latest(dockerfile):
    return re.sub(r"^(\s*FROM\s+(?:--\S+\s+)*)python:[^\s@]+(@sha256:[0-9a-f]+)?", r"\1python:latest", dockerfile, flags=re.I | re.M)


def run(dockerfile, ignore_text, change_id, S):
    b = build(dockerfile, ignore_text, change_id, S)
    b["lint"] = lint(dockerfile, ignore_text, S) if b["ok"] else []
    return b


def ladder(S):
    out = {}
    for p in S["presets"]:
        row = {}
        for c in ["code", "deps", "data", "docs", "none", "base"]:
            r = run(p["dockerfile"], p["ignore"], c, S)
            row[c] = {"rebuild_s": r["rebuild_s"], "hits": r["hits"], "steps": r["steps"]}
            if c == "code":
                row.update({"cold_s": r["cold_s"], "image_mb": r["image_mb"], "base_mb": r["base_mb"],
                            "context_mb": r["context_mb"], "context_files": r["context_files"],
                            "secret_file_in_image": r["secret_file_in_image"],
                            "lint": [x["rule"] for x in r["lint"]], "fails": len(r["fails"])})
        out[p["id"]] = row
        bc = run(break_copy_first(p["dockerfile"]), p["ignore"], "code", S)
        out[p["id"] + "+copyfirst"] = {"code_rebuild_s": bc["rebuild_s"], "hits": bc["hits"], "steps": bc["steps"], "image_mb": bc["image_mb"]}
        bl = run(break_latest(p["dockerfile"]), p["ignore"], "base", S)
        out[p["id"] + "+latest"] = {"base_rebuild_s": bl["rebuild_s"], "hits": bl["hits"], "steps": bl["steps"], "image_mb": bl["image_mb"]}
    return out


if __name__ == "__main__":
    S = load_sample()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "ladder"
    if cmd == "ladder":
        print(json.dumps(ladder(S), indent=1))
    else:
        cases = json.load(open(os.path.join(HERE, "dkr_rule_tests.json")))
        fails = 0
        for c in cases:
            if c["kind"] == "lint":
                got = any(x["rule"] == c["rule"] for x in lint(c["dockerfile"], c.get("ignore", ""), S))
            else:
                got = excluded(parse_ignore(c["ignore"]), c["path"])
            if got != c["expect"]:
                fails += 1
                print("FAIL", c["kind"], c.get("rule") or c["path"], c["desc"])
        print(f"{len(cases) - fails}/{len(cases)} cases pass in python")
        sys.exit(1 if fails else 0)
