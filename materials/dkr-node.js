// Node twin of materials/dkr_reference.py: runs the browser engine (assets/dkr-live.js) headless.
//   node materials/dkr-node.js ladder > node.json    every preset x every change, plus both anti-levers
//   node materials/dkr-node.js test                  the shared lint + glob unit tests (dkr_rule_tests.json)
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const DKR = require(path.join(ROOT, "assets/dkr-live.js"));
const txt = fs.readFileSync(path.join(ROOT, "assets/dkr-sample.js"), "utf8");
const S = JSON.parse(txt.slice(txt.indexOf("window.DKR_SAMPLE = ") + 20, txt.lastIndexOf(";")));
const cmd = process.argv[2] || "ladder";
if (cmd === "ladder") {
  process.stdout.write(JSON.stringify(DKR.ladder(S), null, 1));
} else if (cmd === "rows") {
  const p = S.presets.find(x => x.id === process.argv[3]);
  const r = DKR.run(p.dockerfile, p.ignore, process.argv[4] || "code", S);
  for (const row of r.rows) console.log(row.line, row.status.padEnd(8), String(row.s).padStart(6), String(row.mb).padStart(8), row.text.slice(0, 50), "|", row.note);
  console.log(JSON.stringify({ rebuild: r.rebuild_s, cold: r.cold_s, hits: r.hits, steps: r.steps, image: r.image_mb, ctx: r.context_mb, lint: r.lint.map(x => x.rule), fails: r.fails }));
} else {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "dkr_rule_tests.json"), "utf8"));
  let fails = 0;
  for (const c of cases) {
    let got;
    if (c.kind === "lint") got = DKR.lint(c.dockerfile, c.ignore || "", S).some(x => x.rule === c.rule);
    else got = DKR.excluded(DKR.parseIgnore(c.ignore), c.path);
    if (got !== c.expect) { fails++; console.log("FAIL", c.kind, c.rule || c.path, c.desc); }
  }
  console.log(`${cases.length - fails}/${cases.length} cases pass in node`);
  process.exit(fails ? 1 : 0);
}
