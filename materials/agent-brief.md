# Agent brief - shared by every fan-out page of learn-docker-containers-with-phoebe

Filled from `~/.claude/skills/course-builder/references/agent-brief.template.md` on 2026-11-16.
Internal build document: never link it from an audience page.

You are writing ONE static HTML session page. No servers, no npm. **If your target file already
exists on disk, do not write it; report that and stop.** Write the file, return its path and one
line of coverage, plus any source you read that the map lacks and any contradiction you found with
another page. No HTML in your reply.

## Read first, in this order

1. The template page. Copy its structure, classes, SVG grammar and quiz markup EXACTLY, including
   how many options each question has (FOUR options, "A · ...", "B · ...", "C · ...", "D · ..."):
   `/Users/phoebe.fu/Documents/claude_work/github_repo/learn-docker-containers-with-phoebe/courses/01-works-on-my-laptop.html`
   For rhythm you may also skim the bench page (do NOT copy its widget):
   `/Users/phoebe.fu/Documents/claude_work/github_repo/learn-docker-containers-with-phoebe/courses/04-the-layer-cache-lab.html`
2. The source map: every verified fact, its evidence tier, per-session coverage, the seams, the
   Stackyard facts and the bench canon. Use ONLY its facts and numbers; never invent a statistic; if
   a fact is missing, teach the uncertainty or leave it out.
   `/Users/phoebe.fu/Documents/claude_work/github_repo/learn-docker-containers-with-phoebe/materials/official-course-map.md`
3. The stylesheet `:root` block for the palette tokens (first 35 lines):
   `/Users/phoebe.fu/Documents/claude_work/github_repo/learn-docker-containers-with-phoebe/assets/style.css`
4. If your page quotes a preset Dockerfile, the .dockerignore or a Stackyard file, copy it from
   `/Users/phoebe.fu/Documents/claude_work/github_repo/learn-docker-containers-with-phoebe/materials/build_dkr_sample.py`
   (P_NAIVE, P_DEPS_FIRST, P_SLIM, P_MULTI, P_HARDENED, P_ALPINE, DOCKERIGNORE_STANDARD, FILES, REQS).

## Page skeleton (keep every component)

toolbar (crumb EXACTLY `<a href="../index.html">learn-docker-containers-with-phoebe</a> / Session N of 6`,
#toggle-all, #zoom-toggle) · masthead (eyebrow "Learn Docker &amp; Containers with Phoebe · Session N of 6",
h1 with exactly one `<span class="accent">`, .sub, .chip-row with the level chip given in your outline,
an audience chip "Data, analytics and ML people who ship notebooks, APIs and jobs", one more audience
chip of your choice, `.chip.time` "45 min", .agenda a1-a4 with flex weights 1/4/5/1) · main.wrap ·
section#intro (klabel "Part 0", h2 "Where we start", .lede, .legend pills exactly as in the template,
.callout.win "★ What you walk out with tonight.") · 3 Parts, each `section.section#part-N` with
section-kicker (klabel "Part N · covers ...", h2, `.tag.concept "N min live"`), a `.lede`, ONE figure,
`details.card` accordions (summary: `.mode.live` or `.mode.self`, title, `.mini`, `.caret ▶`), and a
`.callout.example` with `span.ex-pill` "Real world" per Part · section#demo-1 Build-along (klabel
"Build-along", h2, `.tag.demo "★ 22 min · everyone builds"`, .lede, ONE figure, `.steps > .step`, each
step a `<p>` with the code box BELOW it as `.prompt-box.good` carrying a `span.label` "★ Step N · ...";
a final step may have no box) · optional `.scorecard` exactly as the template's (data-title, data-foot,
`.sc-row > .sc-q` with an `<em>`) · `.callout.tip` · section#exercise (klabel "Homework", h2 "Before
session N+1" or for session 6 "After the capstone", `.tag.exercise "30 min"`, ol of 4 items) ·
section#quiz (klabel "Check yourself", h2 "Three questions", the passport line "Clear all three and
session N gets stamped in your passport.", 3 x `.quiz-q data-answer="0-based"` with `p.qtext`, four
`button.qopt`, `p.qwhy`; vary the correct letter across the three; one `p.quiz-score` after the last) ·
section#official (klabel "Sources covered", h2 EXACTLY "What this session teaches, and where it came
from", `.covered > .covered-row` (pill solid ✓ / light ◐ + name + note), then the `.mono` line EXACTLY
"Every fact on this page, and its verification tier, is recorded in the course's source map.") ·
section.cheat#cheatsheet (h3 "Session N cheat sheet <span>· pin this</span>", .grid-2 of six
.cheat-item with b + span) · `.callout.next` with `.nx-pill` "Next session" (session 6: `.nx-pill`
"Where next") · footer.pagefoot · `<script src="../assets/app.js?v=1"></script>`.

Head: copy the template's social meta block with this page's own title/description/url
(`https://phoebefu6.github.io/learn-docker-containers-with-phoebe/courses/<file>`, og-image
`.../assets/og-cover.png`); `<title>Session N · <short title> - learn docker containers with phoebe</title>`;
`<link rel="stylesheet" href="../assets/style.css?v=1">`. Nothing else external.

First `details.card` in Part 1 is `open`; no other. Sentence case headings. Warm practitioner voice,
concrete, never dry. Inside prompt-boxes escape `&` `<` `>` (`&amp;` `&lt;` `&gt;`). 500 to 700 lines
is guidance about depth, never a target: never collapse whitespace, dissolve a list into a paragraph,
or drop a component to fit.

## Hard rules (a violation is rework)

- NEVER an em dash or en dash, anywhere (prose, code, aria-labels, comments). Hyphen only.
- No meta text: never "this course", "in this course", "the course teaches", "banned here". State the
  professional norm directly with its reason. The two exact estate phrases above are the only
  self-references; "session 5" cross-references are fine.
- Attribution "by Phoebe Fu". Never "built with" a tool.
- Every number comes from the map or is labelled constructed. Never print invented command output as
  if it ran; for anything a learner would run themselves, say "your output will differ".
- Bench numbers: quote ONLY numbers in the map's "Bench canon" and "Per-layer rows" sections, always
  as what "the session 4 lab" prints, and say the seconds are modelled. Never derive new numbers by
  subtracting or rounding canon values (write "from 248.67 MB to 127.92 MB", not "121 MB smaller").
- Contested evidence: teach the disagreement; never resolve it. The alpine-for-Python argument (session
  6) is contested: give both sides with their dates (the 2020 test and the 2026 update, PEP 656, the
  PyPI wheel check) and let the reader decide by checking their own packages.
- Fast-moving facts: image sizes, tags, Python versions, Docker Desktop terms: say "at the time of
  writing" (read 2026-11-16).
- NEVER "lottery" or "lotteries". No Chinese terms are needed.
- NEVER a cross mark of any kind (✗ ✘ ✕ ❌ ×) anywhere, including figures and before/after panels:
  label states in words ("rebuilt", "cached", "leaks", "kept out"). A ✓ is fine in the coverage pills.
- Titles, widget ids and class names must not collide with siblings. Do not reuse these titles:
  "Foundations: repo, Git flow, CI, Docker", "Container registry and templates", "Where am I?",
  "Keep the key out of the context window", "Docker Compose stands the stack up". Do not use class
  prefixes `dkr-` (the bench engine owns it), `adc-`, `rfm-`; your figures use the `sNx` prefix below.
- Course-specific: every mention of Stackyard is labelled "Constructed Stackyard example" (or
  "constructed" in the same sentence) at least once per Part and in the build-along lede. The analyst
  is "Ana". Never Phoebe's employers, clients or projects. Do not invent other company cases;
  real-world stories come from the map (Docker docs, Docker Hub tags and sizes, hadolint, PyPI wheels,
  PEP 656, pythonspeed (reported), distroless, the postgres image docs, OCI spec, pg_isready).
- No Docker install is needed: every build-along runs in the page (reading, predicting, writing a
  Dockerfile or compose.yaml in prompt boxes, scoring). Commands a reader may run later on their own
  machine are welcome in Self-study cards, marked "if you have Docker".
- Seams: link, never reteach. Pushing images from CI = GitLab b7; Docker inside a CI/CD platform and
  deploys = DataOps b1/b8; clouds and IaC = AWS/GCP/Terraform; secrets for agents = Agent Secrets s4.

## Figure grammar (hand-drawn, every figure)

Palette, ONLY these hexes (no invented greys): #03008C (primary, ultramarine) · #01005E (deep) ·
#1D63ED (mid, Docker blue) · #BAC6F7 (soft) · #EEF1FD (tint) · #0E1030 (ink) · #4A4E6E (muted) ·
#C5CAE6 (faint) · #DEE1F2 (hairline) · #FF9F5A (container orange, a FILL only, never text) · #A33A00
(orange ink, text on white or #FFF0E4 only) · #FFF0E4 (orange tint) · #FCFCFF (paper) · `#FFFFFF` ·
universal reds `#991B1B` `#FEF2F2` `#FCA5A5` only for a wrong-way panel or a leak.

- `<figure class="zoomable">` > `<svg viewBox="0 0 880 H" xmlns="http://www.w3.org/2000/svg" role="img"
  aria-label="the data, not the shape">` > `<defs>` + `<style>` + content, then
  `<figcaption>🔍 Click to zoom - takeaway</figcaption>`. Grow H, never W.
- Prefix unique per figure, used for every class and id: `s{session}{letter}`, e.g. s2a, s2b, s2c, s2d
  for session 2's four figures (filter `s2aSk`, hatch `s2aHc`, arrow `s2aAr`, classes `.s2aH` ...).
- `<defs>` holds, with the figure prefix P: a wobble filter `id="PSk"` (`feTurbulence
  type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="<int>"` + `feDisplacementMap scale="2.4"
  xChannelSelector="R" yChannelSelector="G"`, `x="-3%" y="-3%" width="106%" height="106%"`), a hachure
  pattern `id="PHc"` (7x7 userSpaceOnUse, rotate(-38), one #03008C line, opacity .5), an open arrowhead
  `id="PAr"` (path `M1 1 L9 5 L1 9`, fill none, #0E1030 stroke 1.6). ALL shapes sit inside ONE `<g
  filter="url(#PSk)" fill="none" stroke="#0E1030" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round">`; rects carry a tiny rotation (-4 to 4 degrees for hand-placed items, under 1
  for panels). Fills: white, #EEF1FD, the hachure for "the pile" or "the layers that travel", #01005E
  with white text for "the image" or "the one command", and #FF9F5A ONLY for the one thing the figure is
  about. Text on #FF9F5A is #0E1030 (never white, never #A33A00). Text on #01005E or #03008C is
  #FFFFFF. Text on #1D63ED is #FFFFFF bold. Text classes: `.PH` 800 12px #0E1030 heading · `.PL` 600
  12px #0E1030 label · `.PS` 400 11px #4A4E6E · `.PC` 600 11px ui-monospace #0E1030 code · `.PV` 800
  16-20px #01005E value · `.PW` 800 12px #FFFFFF on a dark fill · `.PA` 700 11px #03008C axis caption ·
  `.PR` 800 11-12px #991B1B for a leak or a failure · `.PN` 400 12px #4A4E6E note. Hand-stacked items
  must not overlap as painted rects (the gate flags a pile).
- ALL `<text>` outside the filtered group, sans stack, never below 10.5px.
- Fit: max chars ≈ (box width - 20) / 7 at 12px, 6.4px/char at 11px, ~6.8px/char for 11px monospace;
  full-width note under 110 chars; 40px between neighbouring point labels; bottom note 22px below the
  last row, H clears it by 8px. No line, arrow or curve may cross a label (the scanner flags
  line-through-text and text-out-of-box). When in doubt, shorten.
- Floor: one figure per Part plus one in the build-along. Draw the MECHANISM (which layer holds which
  bytes, which name resolves to which container, which stage's files reach the image, where the secret
  sits), never a metaphor literally (no whales, no shipping containers as pictures), never decoration.

## Voice and honesty

Every Part gets a real-world story from the map. Constructed cases say "constructed" on the page:
Stackyard, Ana's laptop, its files and its compose stack. Nothing on the page claims a measured
outcome that was not measured.

## Cross-links (absolute URLs)

- Command line (prerequisite): https://phoebefu6.github.io/learn-command-line-with-phoebe/
- DataOps b1 (CI and Docker in a platform): https://phoebefu6.github.io/learn-dataops-with-phoebe/courses/b1-foundations-repo.html
- DataOps b8 (deploy capstone): https://phoebefu6.github.io/learn-dataops-with-phoebe/courses/b8-full-cd-capstone.html
- GitLab b7 (registry and templates): https://phoebefu6.github.io/learn-gitlab-with-phoebe/courses/b7-registry-and-templates.html
- Agent Secrets s4: https://phoebefu6.github.io/learn-agent-secrets-access-with-phoebe/courses/04-keep-the-key-out.html
- AWS: https://phoebefu6.github.io/learn-aws-with-phoebe/ · GCP: https://phoebefu6.github.io/learn-gcp-with-phoebe/ · Terraform: https://phoebefu6.github.io/learn-terraform-with-phoebe/
- Hub: https://phoebefu6.github.io/learn-with-phoebe/

## Footer chain and session titles

Footer left: "Session N of 6 · learn-docker-containers-with-phoebe · by Phoebe Fu &nbsp;·&nbsp; 📚 <a href="https://phoebefu6.github.io/learn-with-phoebe/">Learn with Phoebe ↗</a>"
Footer right: `<a href="PREV">← Prev: <short title></a> &nbsp;·&nbsp; <a href="NEXT">Next: <short title> →</a>`
(session 6: "← Prev: Compose: notebook, API, database, one command" and `<a href="../index.html">Course home →</a>`).

Files and titles (use these short titles in footers):
1. `01-works-on-my-laptop.html` · Why it works on your laptop and nowhere else
2. `02-images-containers-layers.html` · Images, containers, layers: the mental model
3. `03-a-dockerfile-for-python.html` · Writing a Dockerfile for a Python data project
4. `04-the-layer-cache-lab.html` · The layer cache lab
5. `05-compose-one-command.html` · Compose: notebook, API, database, one command
6. `06-smaller-safer-shippable.html` · Smaller, safer, shippable

Stackyard's container kit, one piece per session: s1 dependency inventory · s2 annotated read of a
Dockerfile, layers predicted · s3 the API's Dockerfile + .dockerignore + pinned requirements.txt · s4 a
cache-ordered Dockerfile measured on the bench (rung 6) · s5 compose.yaml · s6 slim multi-stage image +
release checklist, whole kit scored.
