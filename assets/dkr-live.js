/* learn-docker-containers-with-phoebe - the layer cache lab engine.
   Pure functions (parse, ignore matcher, cache walk, lint) plus a small DOM widget.
   Runs in the browser and in node (materials/dkr-node.js); materials/dkr_reference.py is its
   Python twin and must print the same numbers (materials/compare-ladder.py checks by value).

   Cache rules implemented, from Docker's docs ("Build cache invalidation", read 2026-11-16):
   - each instruction is checked against the cache in order; COPY/ADD compare a checksum of the
     copied files' content and metadata (mtime is ignored), so a COPY invalidates when any file it
     copies changes;
   - RUN is not invalidated by itself between builds: only by an earlier invalidation;
   - once an instruction is invalidated, every later instruction in that stage rebuilds;
   - BuildKit only builds the stages the target stage depends on.
   Lint rules: modelled on hadolint's documented rules (ids cited per rule), plus three DKR rules
   of our own, labelled as such. Times and apt/apk sizes are MODELLED parameters (see the sample). */
(function (root) {
  "use strict";

  var META = { WORKDIR: 1, ENV: 1, EXPOSE: 1, CMD: 1, ENTRYPOINT: 1, USER: 1, LABEL: 1, ARG: 1,
               HEALTHCHECK: 1, SHELL: 1, STOPSIGNAL: 1, VOLUME: 1, ONBUILD: 1, MAINTAINER: 1 };
  var STEP = { RUN: 1, COPY: 1, ADD: 1, WORKDIR: 1 };
  var SECRET_RE = /(PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)/i;

  function r1(x) { return Math.floor(x * 10 + 0.5) / 10; }
  function r2(x) { return Math.floor(x * 100 + 0.5) / 100; }

  /* ---------- parsing ---------- */
  function splitWords(s) {
    var out = [], cur = "", q = null;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (q) { if (c === q) { q = null; } else { cur += c; } continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === " " || c === "\t") { if (cur !== "") { out.push(cur); cur = ""; } continue; }
      cur += c;
    }
    if (cur !== "") out.push(cur);
    return out;
  }

  function parse(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var instrs = [], errors = [], buf = "", start = 0;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var t = raw.replace(/^\s+/, "");
      if (buf === "" && (t === "" || t.charAt(0) === "#")) continue;
      if (buf !== "" && t.charAt(0) === "#") continue;
      if (buf === "") start = i + 1;
      var cont = /\\\s*$/.test(raw);
      buf += (buf === "" ? "" : " ") + (cont ? raw.replace(/\\\s*$/, "") : raw).replace(/^\s+|\s+$/g, "");
      if (cont && i < lines.length - 1) continue;
      var m = /^([A-Za-z]+)\s*(.*)$/.exec(buf);
      if (!m) { errors.push("line " + start + ": cannot read '" + buf.slice(0, 40) + "'"); buf = ""; continue; }
      instrs.push({ line: start, kw: m[1].toUpperCase(), args: m[2], text: buf });
      buf = "";
    }
    var stages = [];
    for (var k = 0; k < instrs.length; k++) {
      var ins = instrs[k];
      if (ins.kw === "FROM") {
        var w = splitWords(ins.args).filter(function (x) { return x.indexOf("--") !== 0; });
        var name = null;
        if (w.length >= 3 && w[1].toUpperCase() === "AS") name = w[2].toLowerCase();
        stages.push({ index: stages.length, name: name, ref: w[0] || "", instrs: [] });
      }
      if (!stages.length) { errors.push("line " + ins.line + ": " + ins.kw + " before any FROM"); continue; }
      ins.stage = stages.length - 1;
      stages[stages.length - 1].instrs.push(ins);
    }
    if (!stages.length && !errors.length) errors.push("no FROM instruction");
    return { instrs: instrs, stages: stages, errors: errors };
  }

  /* ---------- .dockerignore and COPY sources: one glob grammar ---------- */
  function cleanPat(p) {
    p = p.replace(/^\s+|\s+$/g, "");
    while (p.indexOf("./") === 0) p = p.slice(2);
    p = p.replace(/^\/+/, "").replace(/\/+$/, "");
    return p;
  }
  function globRe(p) {
    var s = "";
    for (var i = 0; i < p.length; i++) {
      var c = p.charAt(i);
      if (c === "*") {
        if (p.charAt(i + 1) === "*") {
          if (p.charAt(i + 2) === "/") { s += "(?:.*/)?"; i += 2; } else { s += ".*"; i += 1; }
        } else { s += "[^/]*"; }
      } else if (c === "?") { s += "[^/]"; }
      else if ("\\^$.|+()[]{}".indexOf(c) >= 0) { s += "\\" + c; }
      else { s += c; }
    }
    return "^" + s + "$";
  }
  /* a pattern matches a path if it matches the path itself or any parent directory of it */
  function patMatches(re, path) {
    var parts = path.split("/");
    for (var n = parts.length; n >= 1; n--) {
      if (re.test(parts.slice(0, n).join("/"))) return true;
    }
    return false;
  }
  function parseIgnore(text) {
    var rules = [];
    String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (l) {
      if (l.charAt(0) === "#") return;
      var t = l.replace(/^\s+|\s+$/g, "");
      if (t === "") return;
      var neg = false;
      if (t.charAt(0) === "!") { neg = true; t = t.slice(1); }
      t = cleanPat(t);
      if (t === "") return;
      rules.push({ neg: neg, pat: t, re: new RegExp(globRe(t)) });
    });
    return rules;
  }
  function excluded(rules, path) {
    var ex = false;
    for (var i = 0; i < rules.length; i++) if (patMatches(rules[i].re, path)) ex = !rules[i].neg;
    return ex;
  }
  function contextFiles(files, ignoreText) {
    var rules = parseIgnore(ignoreText);
    return files.filter(function (f) { return !excluded(rules, f.path); });
  }
  function copySources(args) {
    var w = splitWords(args), flags = {}, rest = [];
    if (w.length && w[0].charAt(0) === "[") {
      try { w = JSON.parse(args); } catch (e) { w = []; }
    }
    w.forEach(function (x) {
      if (x.indexOf("--") === 0) { var kv = x.slice(2).split("="); flags[kv[0].toLowerCase()] = kv.slice(1).join("="); }
      else rest.push(x);
    });
    return { flags: flags, srcs: rest.slice(0, Math.max(0, rest.length - 1)), dest: rest[rest.length - 1] || "" };
  }
  function filesFor(srcs, ctx) {
    var out = [], seen = {};
    srcs.forEach(function (s) {
      var c = cleanPat(s);
      ctx.forEach(function (f) {
        if (seen[f.path]) return;
        if (c === "" || c === "." || patMatches(new RegExp(globRe(c)), f.path)) { seen[f.path] = 1; out.push(f); }
      });
    });
    return out;
  }

  /* ---------- base images ---------- */
  function resolveRef(ref, S) {
    var r = ref.toLowerCase(), digest = null;
    var at = r.indexOf("@");
    if (at >= 0) { digest = r.slice(at + 1); r = r.slice(0, at); }
    var lastSlash = r.lastIndexOf("/"), colon = r.lastIndexOf(":");
    var tagged = colon > lastSlash;
    var key = tagged ? r : r + ":latest";
    if (key.indexOf("library/") === 0) key = key.slice(8);
    if (key.indexOf("docker.io/library/") === 0) key = key.slice(18);
    var base = null;
    for (var i = 0; i < S.bases.length; i++) if (S.bases[i].ref === key) base = S.bases[i];
    return { key: key, tagged: tagged, digest: digest, latest: /:latest$/.test(key),
             scratch: r === "scratch", base: base, musl: key.indexOf("alpine") >= 0 };
  }

  /* ---------- RUN cost model (MODELLED) ---------- */
  function wordsAfter(cmd, word) {
    var w = splitWords(cmd), i = w.indexOf(word), out = [];
    if (i < 0) return out;
    for (var k = i + 1; k < w.length; k++) {
      if (w[k] === "&&" || w[k] === ";" || w[k] === "||" || w[k] === "|") break;
      out.push(w[k]);
    }
    return out;
  }
  function runCost(ins, ctx) {
    var S = ctx.S, M = S.model, cmd = ins.args, parts = [], s = 0, mb = 0, pipMb = 0, notes = [];
    var cacheMount = /--mount=[^\s]*type=cache/.test(cmd);
    if (/\bapt-get\b[^&;|]*\binstall\b/.test(cmd)) {
      var pk = wordsAfter(cmd, "install").filter(function (x) { return x.charAt(0) !== "-"; });
      var rec = cmd.indexOf("--no-install-recommends") < 0;
      var amb = 0;
      pk.forEach(function (p) { var n = p.split("=")[0]; var t = M.apt[n] || [5.0, 10.0]; amb += rec ? t[1] : t[0]; });
      var lists = /\bapt-get\s+update\b/.test(cmd) && !/rm\s+-rf?\s+\/var\/lib\/apt\/lists/.test(cmd);
      if (lists) { amb += M.apt_lists_mb; notes.push("apt lists left in the layer"); }
      s += M.apt_base_s + pk.length * M.apt_pkg_s; mb += amb;
      if (pk.some(function (p) { return /^(build-essential|gcc)$/.test(p.split("=")[0]); })) ctx.compiler = true;
      parts.push("apt");
    }
    if (/\bapk\s+add\b/.test(cmd)) {
      var ak = wordsAfter(cmd, "add").filter(function (x) { return x.charAt(0) !== "-"; });
      var bmb = 0;
      ak.forEach(function (p) { var n = p.split("=")[0]; bmb += (M.apk[n] !== undefined ? M.apk[n] : 5.0); });
      if (cmd.indexOf("--no-cache") < 0) bmb += M.apk_cache_mb;
      s += M.apk_base_s + ak.length * M.apt_pkg_s; mb += bmb;
      if (ak.some(function (p) { return /^(build-base|gcc)$/.test(p.split("=")[0]); })) ctx.compiler = true;
      parts.push("apk");
    }
    if (/\bpip3?\s+install\b/.test(cmd) || /python3?\s+-m\s+pip\s+install\b/.test(cmd)) {
      var pw = wordsAfter(cmd, "install"), pkgs = [], reqs = false;
      for (var i = 0; i < pw.length; i++) {
        if (pw[i] === "-r" || pw[i] === "--requirement") { reqs = true; i++; continue; }
        if (/^--requirement=/.test(pw[i])) { reqs = true; continue; }
        if (pw[i].charAt(0) === "-") continue;
        pkgs.push(pw[i]);
      }
      var list = [];
      if (reqs) S.packages.forEach(function (p) { list.push(p); });
      pkgs.forEach(function (n) {
        var nm = n.split(/[=<>!~\[]/)[0].toLowerCase(), hit = null;
        S.packages.forEach(function (p) { if (p.name === nm) hit = p; });
        if (!hit || list.indexOf(hit) < 0) list.push(hit || { name: nm, glibc_mb: M.pip_unknown_mb, musl_mb: M.pip_unknown_mb, unknown: true });
      });
      var noCache = cmd.indexOf("--no-cache-dir") >= 0 || ctx.env.PIP_NO_CACHE_DIR || cacheMount;
      var warm = cacheMount && !ctx.cold;
      var sizes = 0, sdists = [];
      list.forEach(function (p) {
        var sz, sd = false;
        if (ctx.musl) { if (p.musl_mb === null || p.musl_mb === undefined) { sz = p.glibc_mb; sd = true; } else sz = p.musl_mb; }
        else sz = p.glibc_mb;
        s += M.pip_pkg_s + sz * M.pip_s_per_mb + (warm ? 0 : sz * M.pip_dl_s_per_mb) + (sd ? M.sdist_build_s : 0);
        sizes += sz;
        if (sd) sdists.push(p.name);
      });
      pipMb += sizes;
      mb += sizes + (noCache ? 0 : sizes);
      if (!noCache) notes.push("pip cache kept in the layer");
      if (sdists.length) {
        notes.push("no musllinux wheel: " + sdists.join(", ") + " compiled from source");
        if (!ctx.compiler) ctx.fails.push("line " + ins.line + ": " + sdists.join(", ") + " has no musllinux wheel and the stage has no compiler (apk add build-base)");
      }
      parts.push("pip");
    }
    if (/\b(useradd|adduser|groupadd|addgroup)\b/.test(cmd)) { s += M.user_s; mb += M.user_mb; parts.push("user"); }
    if (!parts.length) { s += M.run_other_s; notes.push("unrecognised command: modelled at " + M.run_other_s + " s, 0 MB"); }
    return { s: s, mb: mb, pipMb: pipMb, note: notes.join("; ") };
  }

  /* ---------- the build walk ---------- */
  function build(dockerfile, ignoreText, changeId, S, opts) {
    opts = opts || {};
    var P = parse(dockerfile), M = S.model;
    var res = { ok: !P.errors.length, errors: P.errors.slice(), rows: [], fails: [], stages: [] };
    if (!res.ok) return res;
    var ctxFiles = contextFiles(S.files, ignoreText);
    var change = null;
    S.changes.forEach(function (c) { if (c.id === changeId) change = c; });
    if (!change) change = S.changes[0];
    var changedPath = change.path, baseMoved = change.id === "base";
    var names = {};
    P.stages.forEach(function (st) { if (st.name) names[st.name] = st.index; });
    function stageRef(v) {
      if (v === undefined || v === null) return -1;
      var lv = String(v).toLowerCase();
      if (names[lv] !== undefined) return names[lv];
      if (/^\d+$/.test(lv) && +lv < P.stages.length) return +lv;
      return -1;
    }
    // which stages the final stage needs (BuildKit skips the rest)
    var final = P.stages.length - 1, need = {};
    (function mark(i) {
      if (need[i]) return; need[i] = true;
      P.stages[i].instrs.forEach(function (ins) {
        if (ins.kw === "FROM") { var f = stageRef(P.stages[i].ref); if (f >= 0 && f !== i) mark(f); }
        if (ins.kw === "COPY" || ins.kw === "ADD") { var c = copySources(ins.args); var f2 = stageRef(c.flags.from); if (f2 >= 0 && f2 !== i) mark(f2); }
      });
    })(final);

    function walk(cold) {
      var out = { rows: [], s: 0, steps: 0, hits: 0, pulls: {}, stageInfo: [], fails: [] };
      var sInfo = [];
      P.stages.forEach(function (st, si) {
        var info = { name: st.name || ("stage " + si), needed: !!need[si], changed: false, pipMb: 0, layersMb: 0, baseMb: 0, base: null, secret: false };
        sInfo.push(info);
        if (!need[si]) {
          st.instrs.forEach(function (ins) { out.rows.push({ stage: si, line: ins.line, kw: ins.kw, text: ins.text, status: "skipped", s: 0, mb: 0, note: "stage not needed by the final stage" }); });
          return;
        }
        var invalid = false;
        var ctx = { S: S, env: {}, cold: cold, musl: false, compiler: false, fails: out.fails };
        st.instrs.forEach(function (ins) {
          var row = { stage: si, line: ins.line, kw: ins.kw, text: ins.text, status: "cached", s: 0, mb: 0, note: "" };
          var cost = 0, mb = 0, causes = false;
          if (ins.kw === "FROM") {
            var fromStage = stageRef(st.ref);
            if (fromStage >= 0 && fromStage !== si) {
              var src = sInfo[fromStage];
              info.baseMb = src.baseMb + src.layersMb; info.pipMb = src.pipMb; info.base = src.base;
              ctx.musl = src.base ? src.base.musl : false;
              causes = src.changed; row.note = "built on stage " + src.name;
            } else {
              var rr = resolveRef(st.ref, S);
              info.base = rr; ctx.musl = rr.musl;
              info.baseMb = rr.base ? rr.base.mb : 0;
              if (!rr.base && !rr.scratch) row.note = "base not in the lab's size table: counted as 0 MB";
              else row.note = rr.scratch ? "empty base" : (rr.base.ref + " · " + rr.base.mb + " MB compressed (Docker Hub, " + rr.base.updated + ")");
              var pulled = out.pulls[rr.key];
              if (cold && !pulled && rr.base) { cost = rr.base.mb * M.pull_s_per_mb; out.pulls[rr.key] = 1; }
              if (!cold && baseMoved && !rr.digest && !rr.scratch) {
                causes = true;
                if (!pulled && rr.base) { cost = rr.base.mb * M.pull_s_per_mb; out.pulls[rr.key] = 1; }
                row.note = "tag re-pointed upstream: new base pulled";
              }
              if (!cold && baseMoved && rr.digest) row.note = "pinned by digest: the moved tag does not reach this build";
            }
            mb = 0;
          } else if (ins.kw === "COPY" || ins.kw === "ADD") {
            var cs = copySources(ins.args), fs = stageRef(cs.flags.from);
            if (cs.flags.from !== undefined) {
              if (fs >= 0) {
                mb = sInfo[fs].pipMb; causes = sInfo[fs].changed;
                info.pipMb += sInfo[fs].pipMb;
                row.note = "copies the packages installed in " + sInfo[fs].name + " (" + r2(mb) + " MB)";
              } else { mb = 0; row.note = "--from an image outside the lab: 0 MB"; }
            } else {
              var fl = filesFor(cs.srcs, ctxFiles), tot = 0;
              fl.forEach(function (f) { tot += f.mb; if (f.kind === "secret") info.secret = true; });
              mb = tot;
              if (changedPath && !cold) fl.forEach(function (f) { if (f.path === changedPath) causes = true; });
              row.note = fl.length + " file" + (fl.length === 1 ? "" : "s") + ", " + r2(tot) + " MB" + (causes && !cold ? " · includes the changed file" : "");
            }
            cost = M.copy_s + mb * M.copy_s_per_mb;
          } else if (ins.kw === "RUN") {
            var rc = runCost(ins, ctx);
            cost = rc.s; mb = rc.mb; info.pipMb += rc.pipMb; row.note = rc.note;
          } else if (ins.kw === "ENV") {
            var ew = splitWords(ins.args);
            if (ew.length === 2 && ew[0].indexOf("=") < 0) ctx.env[ew[0]] = ew[1];
            else ew.forEach(function (kv) { var p = kv.split("="); if (p.length > 1) ctx.env[p[0]] = p.slice(1).join("="); });
            cost = M.meta_s;
          } else {
            cost = M.meta_s;
          }
          if (cold || causes) invalid = true;
          var rebuilt = cold || invalid;
          if (ins.kw === "FROM") rebuilt = cold || causes;
          row.status = rebuilt ? "rebuilt" : "cached";
          if (STEP[ins.kw]) { out.steps++; if (!rebuilt) out.hits++; }
          if (rebuilt) { row.s = cost; out.s += cost; info.changed = true; }
          row.mb = ins.kw === "FROM" ? 0 : mb;
          info.layersMb += row.mb;
          out.rows.push(row);
        });
      });
      out.stageInfo = sInfo;
      return out;
    }

    var ctxMb = 0;
    ctxFiles.forEach(function (f) { ctxMb += f.mb; });
    var cold = walk(true), warm = walk(false);
    var sendWarm = 0;
    if (changedPath) ctxFiles.forEach(function (f) { if (f.path === changedPath) sendWarm += f.mb; });
    var fin = warm.stageInfo[final];
    res.context_mb = r2(ctxMb);
    res.context_files = ctxFiles.length;
    res.cold_s = r1(cold.s + ctxMb * M.context_s_per_mb);
    res.rebuild_s = r1(warm.s + sendWarm * M.context_s_per_mb);
    res.hits = warm.hits; res.steps = warm.steps;
    res.base_mb = r2(fin.baseMb);
    res.image_mb = r2(fin.baseMb + fin.layersMb);
    res.secret_file_in_image = fin.secret;
    res.rows = warm.rows.map(function (r) { return { stage: r.stage, line: r.line, kw: r.kw, text: r.text, status: r.status, s: r1(r.s), mb: r2(r.mb), note: r.note }; });
    res.fails = cold.fails.slice();
    res.stages = warm.stageInfo.map(function (x) { return { name: x.name, needed: x.needed }; });
    res.change = change.id;
    return res;
  }

  /* ---------- lint ---------- */
  var RULES = [
    { id: "DL3006", sev: "warning", own: false, msg: "Always tag the version of an image explicitly." },
    { id: "DL3007", sev: "warning", own: false, msg: "Using latest is prone to errors if the image will ever update. Pin the version explicitly to a release tag." },
    { id: "DL3000", sev: "error", own: false, msg: "Use absolute WORKDIR." },
    { id: "DL3020", sev: "error", own: false, msg: "Use COPY instead of ADD for files and folders." },
    { id: "DL3015", sev: "info", own: false, msg: "Avoid additional packages by specifying --no-install-recommends." },
    { id: "DL3009", sev: "info", own: false, msg: "Delete the apt-get lists after installing something." },
    { id: "DL3042", sev: "warning", own: false, msg: "Avoid cache directory with pip install --no-cache-dir <package>." },
    { id: "DL3025", sev: "warning", own: false, msg: "Use arguments JSON notation for CMD and ENTRYPOINT arguments." },
    { id: "DL3002", sev: "warning", own: false, msg: "Last user should not be root." },
    { id: "DL3064", sev: "warning", own: false, msg: "Potentially sensitive data should not be used in the ARG or ENV commands." },
    { id: "DKR-ORDER", sev: "warning", own: true, msg: "The whole project is copied before dependencies install: every code change reinstalls them." },
    { id: "DKR-USER", sev: "warning", own: true, msg: "The final stage never sets USER, so the container runs as root." },
    { id: "DKR-CONTEXT", sev: "warning", own: true, msg: "The whole context is copied and .dockerignore does not exclude .env: the secrets file lands in a layer." }
  ];
  function rule(id) { for (var i = 0; i < RULES.length; i++) if (RULES[i].id === id) return RULES[i]; return null; }

  function lint(dockerfile, ignoreText, S) {
    var P = parse(dockerfile), out = [];
    if (P.errors.length) return out;
    function hit(id, line) { var r = rule(id); out.push({ rule: id, line: line, sev: r.sev, own: r.own, msg: r.msg }); }
    var names = {};
    P.stages.forEach(function (st) { if (st.name) names[st.name] = 1; });
    var rules = parseIgnore(ignoreText);
    var envExcluded = excluded(rules, ".env");
    P.stages.forEach(function (st, si) {
      var isFinal = si === P.stages.length - 1, lastUser = null, lastUserLine = 0, sawWholeCopy = false, wholeCopyLine = 0, orderFired = false, pipEnvOff = false;
      st.instrs.forEach(function (ins) {
        var a = ins.args;
        if (ins.kw === "FROM") {
          var ref = st.ref.toLowerCase();
          if (!names[ref] && ref !== "scratch" && ref.indexOf("@") < 0) {
            var ls = ref.lastIndexOf("/"), co = ref.lastIndexOf(":");
            if (co <= ls) hit("DL3006", ins.line);
            else if (/:latest$/.test(ref)) hit("DL3007", ins.line);
          }
        }
        if (ins.kw === "WORKDIR") {
          var wd = splitWords(a)[0] || "";
          if (wd.charAt(0) !== "/" && wd.charAt(0) !== "$" && !/^[A-Za-z]:/.test(wd)) hit("DL3000", ins.line);
        }
        if (ins.kw === "ADD") {
          var c = copySources(a);
          var local = c.srcs.some(function (s) { return !/^(https?|git):\/\//.test(s) && !/\.(tar|tar\.gz|tgz|tar\.bz2|tar\.xz|txz)$/.test(s); });
          if (local) hit("DL3020", ins.line);
        }
        if (ins.kw === "ENV") {
          var ew = splitWords(a);
          if (ew.length === 2 && ew[0].indexOf("=") < 0) { if (ew[0] === "PIP_NO_CACHE_DIR") pipEnvOff = true; }
          else ew.forEach(function (kv) { if (kv.split("=")[0] === "PIP_NO_CACHE_DIR") pipEnvOff = true; });
        }
        if (ins.kw === "ENV" || ins.kw === "ARG") {
          var keys = [], w2 = splitWords(a);
          if (ins.kw === "ENV" && w2.length === 2 && w2[0].indexOf("=") < 0) keys.push(w2[0]);
          else w2.forEach(function (kv) { keys.push(kv.split("=")[0]); });
          if (keys.some(function (k) { return SECRET_RE.test(k); })) hit("DL3064", ins.line);
        }
        if (ins.kw === "RUN") {
          if (/\bapt-get\b[^&;|]*\binstall\b/.test(a)) {
            if (a.indexOf("--no-install-recommends") < 0) hit("DL3015", ins.line);
            if (!/rm\s+-rf?\s+\/var\/lib\/apt\/lists/.test(a)) hit("DL3009", ins.line);
          }
          var isPip = /\bpip3?\s+install\b/.test(a) || /python3?\s+-m\s+pip\s+install\b/.test(a);
          if (isPip && a.indexOf("--no-cache-dir") < 0 && !pipEnvOff && !/--mount=[^\s]*type=cache/.test(a)) hit("DL3042", ins.line);
          if (isPip && sawWholeCopy && !orderFired) { hit("DKR-ORDER", wholeCopyLine); orderFired = true; }
        }
        if (ins.kw === "COPY" || ins.kw === "ADD") {
          var cc = copySources(a);
          if (cc.flags.from === undefined && cc.srcs.some(function (s) { var x = cleanPat(s); return x === "" || x === "."; })) {
            if (!sawWholeCopy) { sawWholeCopy = true; wholeCopyLine = ins.line; }
            if (!envExcluded) hit("DKR-CONTEXT", ins.line);
          }
        }
        if ((ins.kw === "CMD" || ins.kw === "ENTRYPOINT") && a.replace(/^\s+/, "").charAt(0) !== "[") hit("DL3025", ins.line);
        if (ins.kw === "USER") { lastUser = (splitWords(a)[0] || "").split(":")[0]; lastUserLine = ins.line; }
      });
      if (isFinal) {
        if (lastUser === null) hit("DKR-USER", st.instrs[0].line);
        else if (lastUser === "root" || lastUser === "0") hit("DL3002", lastUserLine);
      }
    });
    return out;
  }

  /* ---------- the anti-levers ---------- */
  function breakCopyFirst(dockerfile) {
    // insert "COPY . ." right after the WORKDIR (or FROM) of the first stage that installs with pip
    var P = parse(dockerfile);
    if (P.errors.length) return dockerfile;
    var target = null;
    P.stages.forEach(function (st) {
      if (target) return;
      if (st.instrs.some(function (i) { return i.kw === "RUN" && /pip3?\s+install/.test(i.args); })) target = st;
    });
    if (!target) target = P.stages[P.stages.length - 1];
    // already broken: the whole project is copied before the first pip install, so leave it alone
    for (var j = 0; j < target.instrs.length; j++) {
      var tj = target.instrs[j];
      if (tj.kw === "RUN" && /pip3?\s+install/.test(tj.args)) break;
      if (tj.kw === "COPY" && copySources(tj.args).flags.from === undefined &&
          copySources(tj.args).srcs.some(function (s) { var x = cleanPat(s); return x === "" || x === "."; })) return dockerfile;
    }
    var after = target.instrs[0];
    for (var i = 0; i < target.instrs.length; i++) if (target.instrs[i].kw === "WORKDIR") { after = target.instrs[i]; break; }
    var lines = String(dockerfile).replace(/\r\n?/g, "\n").split("\n");
    lines.splice(after.line, 0, "COPY . .");
    return lines.join("\n");
  }
  function breakLatest(dockerfile) {
    return String(dockerfile).replace(/^(\s*FROM\s+(?:--\S+\s+)*)python:[^\s@]+(@sha256:[0-9a-f]+)?/gim, "$1python:latest");
  }

  function run(dockerfile, ignoreText, changeId, S) {
    var b = build(dockerfile, ignoreText, changeId, S);
    b.lint = b.ok ? lint(dockerfile, ignoreText, S) : [];
    return b;
  }

  /* ladder used for canon: every preset x the four file changes */
  function ladder(S) {
    var out = {};
    S.presets.forEach(function (p) {
      var row = {};
      ["code", "deps", "data", "docs", "none", "base"].forEach(function (c) {
        var r = run(p.dockerfile, p.ignore, c, S);
        row[c] = { rebuild_s: r.rebuild_s, hits: r.hits, steps: r.steps };
        if (c === "code") {
          row.cold_s = r.cold_s; row.image_mb = r.image_mb; row.base_mb = r.base_mb; row.context_mb = r.context_mb;
          row.context_files = r.context_files; row.secret_file_in_image = r.secret_file_in_image;
          row.lint = r.lint.map(function (x) { return x.rule; }); row.fails = r.fails.length;
        }
      });
      out[p.id] = row;
      var bc = run(breakCopyFirst(p.dockerfile), p.ignore, "code", S);
      out[p.id + "+copyfirst"] = { code_rebuild_s: bc.rebuild_s, hits: bc.hits, steps: bc.steps, image_mb: bc.image_mb };
      var bl = run(breakLatest(p.dockerfile), p.ignore, "base", S);
      out[p.id + "+latest"] = { base_rebuild_s: bl.rebuild_s, hits: bl.hits, steps: bl.steps, image_mb: bl.image_mb };
    });
    return out;
  }

  var API = { parse: parse, parseIgnore: parseIgnore, excluded: excluded, contextFiles: contextFiles,
              build: build, lint: lint, run: run, ladder: ladder, RULES: RULES,
              breakCopyFirst: breakCopyFirst, breakLatest: breakLatest, globRe: globRe };

  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  root.DKR = API;

  /* ---------- the widget ---------- */
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function mount(el) {
    var S = root.DKR_SAMPLE;
    if (!S) { el.textContent = "The lab's data file did not load."; return; }
    var startId = el.getAttribute("data-preset");
    var preset = S.presets[0];
    S.presets.forEach(function (p) { if (p.id === startId) preset = p; });
    var state = { df: preset.dockerfile, ig: preset.ignore, change: el.getAttribute("data-change") || "code", preset: preset.id, broken: "" };
    el.innerHTML =
      '<div class="dkr-head"><h4>The layer cache lab</h4>' +
      '<p class="dkr-rail">The cache walk and the lint are computed for real from the Dockerfile below, using Docker\'s documented cache rules. Base image sizes are real (Docker Hub, linux/amd64, compressed, read ' + esc(S.snapshot_date) + ') and package sizes are real PyPI wheel sizes; every time in seconds, every apt or apk size and the Stackyard project files are <b>modelled</b>. Constructed Stackyard example. Your own builds will differ.</p></div>' +
      '<div class="dkr-presets" role="group" aria-label="Dockerfile presets"></div>' +
      '<div class="dkr-cols"><div><label class="dkr-clabel" for="' + el.id + '-df">Dockerfile (edit freely)</label><textarea class="dkr-text" id="' + el.id + '-df" spellcheck="false"></textarea></div>' +
      '<div><label class="dkr-clabel" for="' + el.id + '-ig">.dockerignore</label><textarea class="dkr-text dkr-ig" id="' + el.id + '-ig" spellcheck="false"></textarea>' +
      '<label class="dkr-clabel" for="' + el.id + '-ch">Then this file changes</label><select class="dkr-select" id="' + el.id + '-ch"></select>' +
      '<div class="dkr-breaks"><button type="button" class="dkr-break" data-b="copy">Break it: COPY . . first</button><button type="button" class="dkr-break" data-b="latest">Break it: float to :latest</button></div>' +
      '<button type="button" class="dkr-run">Rebuild</button></div></div>' +
      '<div class="dkr-out" aria-live="polite"></div>';
    var pre = el.querySelector(".dkr-presets");
    S.presets.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "dkr-preset" + (p.side ? " dkr-side" : ""); b.textContent = p.label; b.setAttribute("data-id", p.id);
      b.addEventListener("click", function () { state.preset = p.id; state.df = p.dockerfile; state.ig = p.ignore; state.broken = ""; sync(); render(); });
      pre.appendChild(b);
    });
    var df = el.querySelector("#" + el.id + "-df"), ig = el.querySelector("#" + el.id + "-ig"), ch = el.querySelector("#" + el.id + "-ch");
    S.changes.forEach(function (c) { var o = document.createElement("option"); o.value = c.id; o.textContent = c.label; ch.appendChild(o); });
    df.addEventListener("input", function () { state.df = df.value; state.preset = ""; state.broken = ""; markPresets(); });
    ig.addEventListener("input", function () { state.ig = ig.value; state.preset = ""; markPresets(); });
    ch.addEventListener("change", function () { state.change = ch.value; render(); });
    el.querySelector(".dkr-run").addEventListener("click", render);
    Array.prototype.forEach.call(el.querySelectorAll(".dkr-break"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-b");
        if (k === "copy") { state.df = API.breakCopyFirst(state.df); state.broken = "copy"; state.change = "code"; }
        else { state.df = API.breakLatest(state.df); state.broken = "latest"; state.change = "base"; }
        state.preset = ""; sync(); render();
      });
    });
    function markPresets() {
      Array.prototype.forEach.call(pre.querySelectorAll(".dkr-preset"), function (b) { b.classList.toggle("is-on", b.getAttribute("data-id") === state.preset); });
    }
    function sync() { df.value = state.df; ig.value = state.ig; ch.value = state.change; markPresets(); }
    function render() {
      var r = API.run(state.df, state.ig, state.change, S), o = el.querySelector(".dkr-out");
      el._last = r;
      if (!r.ok) { o.innerHTML = '<p class="dkr-err">' + esc(r.errors.join(" · ")) + "</p>"; return; }
      var cname = ""; S.changes.forEach(function (c) { if (c.id === r.change) cname = c.label; });
      var h = '<div class="dkr-headline"><div class="dkr-big"><b data-dkr="rebuild">' + r.rebuild_s + ' s</b><span>to rebuild after ' + esc(cname) + "</span></div>" +
        '<div class="dkr-two"><span><b data-dkr="hits">' + r.hits + " of " + r.steps + "</b> build steps from cache</span>" +
        '<span><b data-dkr="image">' + r.image_mb + " MB</b> final image (" + r.base_mb + " MB base)</span>" +
        '<span><b data-dkr="cold">' + r.cold_s + " s</b> first build</span>" +
        '<span><b data-dkr="context">' + r.context_mb + " MB</b> build context, " + r.context_files + " files</span>" +
        '<span><b data-dkr="lint">' + r.lint.length + "</b> lint findings</span></div>";
      if (state.broken) h += '<p class="dkr-warn">' + (state.broken === "copy" ? "Anti-lever on: the whole project is copied before the dependency install, so a one-line code change now reinstalls every package." : "Anti-lever on: every python base now floats on :latest (Python " + esc(S.python_latest_is) + " today), and a re-pointed tag rebuilds everything below FROM.") + "</p>";
      if (r.secret_file_in_image) h += '<p class="dkr-warn">.env is copied into the final image: anyone who can pull the image can read it.</p>';
      r.fails.forEach(function (f) { h += '<p class="dkr-warn">Real pip would stop here: ' + esc(f) + "</p>"; });
      h += "</div>";
      h += '<div class="dkr-tablewrap"><table class="clean dkr-table"><thead><tr><th>Line</th><th>Instruction</th><th>Cache</th><th>Time</th><th>Layer</th><th>Why</th></tr></thead><tbody>';
      var lastStage = -1;
      r.rows.forEach(function (row) {
        if (row.stage !== lastStage && r.stages.length > 1) {
          h += '<tr class="dkr-stage"><td colspan="6">Stage ' + row.stage + " · " + esc(r.stages[row.stage].name) + (r.stages[row.stage].needed ? "" : " (skipped)") + "</td></tr>";
          lastStage = row.stage;
        }
        h += '<tr class="dkr-' + row.status + '"><td>' + row.line + '</td><td class="dkr-ins">' + esc(row.text.length > 64 ? row.text.slice(0, 61) + "..." : row.text) +
          '</td><td><span class="dkr-st dkr-st-' + row.status + '">' + row.status + "</span></td><td>" + (row.status === "rebuilt" ? row.s + " s" : "-") +
          "</td><td>" + (row.mb ? row.mb + " MB" : "-") + '</td><td class="dkr-why">' + esc(row.note) + "</td></tr>";
      });
      h += "</tbody></table></div>";
      h += '<h5 class="dkr-lh">Lint</h5>';
      if (!r.lint.length) h += '<p class="dkr-clean">No findings from the thirteen rules the lab implements.</p>';
      else {
        h += '<ul class="dkr-lint">';
        r.lint.forEach(function (x) { h += '<li><span class="dkr-rule' + (x.own ? " dkr-own" : "") + '">' + x.rule + "</span> line " + x.line + " · " + esc(x.msg) + (x.own ? ' <em>(a lab rule, not hadolint)</em>' : "") + "</li>"; });
        h += "</ul>";
      }
      h += '<p class="dkr-foot">Modelled: pull ' + S.model.pull_s_per_mb + " s/MB, pip " + S.model.pip_pkg_s + " s per package + " + S.model.pip_s_per_mb + " s/MB install + " + S.model.pip_dl_s_per_mb + " s/MB download, a package with no wheel for the platform " + S.model.sdist_build_s + " s to compile, COPY " + S.model.copy_s + " s + " + S.model.copy_s_per_mb + " s/MB, context " + S.model.context_s_per_mb + " s/MB. A rebuild sends only the changed file. Image size = compressed base + layer sizes, approximate.</p>";
      o.innerHTML = h;
    }
    sync(); render();
    el.DKR_BENCH = { setPreset: function (id) { S.presets.forEach(function (p) { if (p.id === id) { state.preset = id; state.df = p.dockerfile; state.ig = p.ignore; state.broken = ""; } }); sync(); render(); return el._last; },
                     setChange: function (c) { state.change = c; sync(); render(); return el._last; },
                     breakIt: function (k) { el.querySelector('.dkr-break[data-b="' + k + '"]').click(); return el._last; },
                     last: function () { return el._last; } };
  }
  function boot() { Array.prototype.forEach.call(document.querySelectorAll(".dkr-bench"), function (el, i) { if (!el.id) el.id = "dkr-bench-" + i; mount(el); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(this);
