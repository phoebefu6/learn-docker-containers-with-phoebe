# Official course map - learn-docker-containers-with-phoebe ("Docker & Containers")

Internal build document (2026-11-16). Never linked from an audience page. Every fact a page quotes lives
here with its evidence tier. **Read at source** = fetched and read by the course lead on 2026-11-16
(snapshots in `materials/sources/` where the source is data). **Reported** = a secondary source's claim,
taught as that source's claim. **Constructed** = invented for the running case, labelled on the page.
Docker moves fast: re-verify the Docker docs pages and the image sizes before delivery and say "at the
time of writing" wherever a size or a version appears.

## Angle and running case

A container is a written-down environment. The question across six sessions: if your laptop died
tonight, could a teammate run your project tomorrow with one command, and how long would the rebuild take?

**Constructed Stackyard example** (label it that way every time). A 4-person analytics team: a Jupyter
notebook, a small FastAPI scoring API, a nightly Python job and a Postgres database, all working only on
one analyst's laptop. Running artifact: **Stackyard's container kit**, one piece per session:

| Session | Piece added to the kit |
|---|---|
| 1 | Dependency inventory (every hidden dependency, written down) |
| 2 | An annotated read of a Dockerfile, layers predicted |
| 3 | The API's Dockerfile + .dockerignore |
| 4 | A cache-ordered Dockerfile, measured on the bench |
| 5 | compose.yaml for notebook, API and database (+ the nightly job as a one-off service) |
| 6 | Slim multi-stage image + release checklist; the whole kit scored |

Stackyard project files (constructed, used by the bench; sizes constructed): `Dockerfile`, `.dockerignore`,
`requirements.txt`, `README.md`, `.env` (holds `DB_PASSWORD`), `app/__init__.py`, `app/main.py`,
`app/scoring.py`, `app/model.joblib` (4.2 MB), `app/__pycache__/...pyc`, `jobs/nightly_scores.py`,
`tests/test_scoring.py`, `notebooks/explore_scores.ipynb` (6.4 MB), `data/scores_2025.parquet` (118 MB),
`.git/` (63.5 MB), `.venv/` (412 MB). Total 604.32 MB, 16 files as the bench models them.

Stackyard's laptop (constructed, s1): macOS on Apple silicon, Python 3.12 from Homebrew, Postgres 16 from
Homebrew on localhost:5432, `DB_PASSWORD` exported in the analyst's `~/.zshrc`, data read from
`/Users/<analyst>/data/scores_2025.parquet`, the nightly job run by the analyst's crontab at 02:00 local
time, `libomp` installed by hand for scikit-learn months ago.

Stackyard requirements.txt (pinned, real versions on PyPI 2026-11-16): fastapi 0.163.1, starlette 1.10.0,
pydantic 2.14.3, pydantic-core 2.50.4, uvicorn 0.54.0, pandas 3.1.1, numpy 2.5.5, python-dateutil 4.0.0,
tzdata 2026.6, scikit-learn 1.9.1, scipy 1.18.1, joblib 1.6.0, threadpoolctl 3.8.0, psycopg2-binary 2.9.13.

## Sessions and coverage

| # | File | Title (h1) | Level | Owns |
|---|---|---|---|---|
| 1 | 01-works-on-my-laptop.html | Why it works on your laptop and nowhere else | green | hidden dependencies; virtualenv vs container vs VM; the kit |
| 2 | 02-images-containers-layers.html | Images, containers, layers: the mental model | green | image vs container, layers as filesystem diffs, writable layer, tags vs digests, registries, OCI |
| 3 | 03-a-dockerfile-for-python.html | Writing a Dockerfile for a Python data project | yellow | FROM, WORKDIR, COPY, RUN, ENV, EXPOSE, CMD vs ENTRYPOINT, .dockerignore, pinning, non-root USER |
| 4 | 04-the-layer-cache-lab.html | The layer cache lab (bench) | orange | cache rules, ordering, the ladder, lint, anti-levers |
| 5 | 05-compose-one-command.html | Compose: notebook, API, database, one command | orange | services, default network + service-name DNS, ports, volumes, depends_on + healthcheck, env files |
| 6 | 06-smaller-safer-shippable.html | Smaller, safer, shippable | red | multi-stage, slim vs alpine vs distroless (contested), scanning as a category, secrets never in layers, release checklist, capstone |

## Verified facts

### Docker concepts (docs.docker.com, read at source 2026-11-16)
- "Docker overview": "An image is a read-only template with instructions for creating a Docker container."
  "A container is a runnable instance of an image." "A Docker registry stores Docker images." Docker Hub is a
  public registry and Docker looks for images on Docker Hub by default.
- "Understanding the image layers": "Each layer in an image contains a set of filesystem changes - additions,
  deletions, or modifications." Layering uses content-addressable storage and union filesystems; layers are
  stacked; when a container starts, a directory is created for the running container so it can change files
  while the image layers stay unchanged (the writable layer). Layers are reused across images that share a base.
- OCI Image Format spec (github.com/opencontainers/image-spec, spec.md): an OCI image consists of "an image
  manifest, an image index (optional), a set of filesystem layers, and a configuration"; layers are referenced
  by a content-addressable identity; the image index points to a list of manifests (one per platform).
- Tags vs digests ("Building best practices"): "Image tags are mutable, meaning a publisher can update a tag to
  point to a new image." Pinning to a digest fully fixes the version.

### Build cache (read at source)
- "Docker build cache": "If a layer changes, all other layers that come after it are also affected." "Once a
  layer changes, then all downstream layers need to be rebuilt as well." Even if they would build nothing
  differently, they re-run.
- "Build cache invalidation": "If no cached layer matches the instruction exactly, the cache is invalidated."
  For ADD and COPY (and RUN with bind mounts) the builder computes a checksum from file metadata; "The
  modification time of a file (mtime) is not taken into account". "The cache for RUN instructions isn't
  invalidated automatically between builds" (so `apt-get update` in a cached RUN does not re-run by itself).
  "Once the cache is invalidated, all subsequent Dockerfile commands generate new images and the cache isn't used."
- "Optimize cache usage in builds": order layers: copy the package management files first, install
  dependencies, then copy the project source "which is subject to frequent change"; keep the context small with
  `.dockerignore`; cache mounts example `RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt`.
- "Multi-stage builds": multiple FROM statements; name a stage with `AS <NAME>`; `COPY --from` copies artifacts
  between stages, "leaving behind everything you don't want in the final image"; "BuildKit only builds the
  stages that the target stage depends on."
- "Build context" (.dockerignore): excludes files from the build context before it is sent to the builder;
  must sit at the root of the context; newline-separated patterns like Unix shell globs; leading and trailing
  slashes disregarded; `#` comments; `!` exceptions, and the last matching line decides; `**` matches any number
  of directories. Matching follows Go's filepath.Match, so `*.pyc` matches only at the context root and
  `**/*.pyc` is needed for subfolders (read at source; the bench's unit tests encode it).

### Dockerfile instructions (Dockerfile reference + "Building best practices", read at source)
- EXPOSE "doesn't actually publish the port"; it documents it; publishing is `-p`/`-P` at run time.
- "There can only be one CMD instruction in a Dockerfile. If you list more than one CMD, only the last one takes effect."
- ENTRYPOINT "allows you to configure a container that will run as an executable"; best practice: ENTRYPOINT for
  the image's main command, CMD in exec form `["executable", "param1"]`; exec form avoids shell string munging.
- WORKDIR: always absolute paths. COPY for local files; ADD fetches remote HTTPS and Git URLs (and extracts
  local archives). Each ENV line creates a new intermediate layer.
- apt: always combine `apt-get update` and `apt-get install` in one RUN; `--no-install-recommends`; remove
  `/var/lib/apt/lists` to reduce size.
- USER: "If a service can run without privileges, use USER to change to a non-root user."
- Build secrets ("Build secrets"): "Build arguments and environment variables are inappropriate for passing
  secrets to your build" because "they persist in the final image"; use `RUN --mount=type=secret,id=...` with
  `docker build --secret id=...,src=...`; the secret is exposed only for that RUN.

### hadolint (github.com/hadolint/hadolint README, GPL-3.0, read at source; snapshot in sources/)
Rules the bench implements, descriptions verbatim from the README table:
DL3006 "Always tag the version of an image explicitly." · DL3007 "Using latest is prone to errors if the image
will ever update. Pin the version explicitly to a release tag." · DL3000 "Use absolute WORKDIR." · DL3020 "Use
COPY instead of ADD for files and folders." · DL3015 "Avoid additional packages by specifying
--no-install-recommends." · DL3009 "Delete the apt-get lists after installing something." · DL3042 "Avoid cache
directory with pip install --no-cache-dir <package>." · DL3025 "Use arguments JSON notation for CMD and
ENTRYPOINT arguments" · DL3002 "Last user should not be root." · DL3064 "Potentially sensitive data should not
be used in the ARG or ENV commands".
Honest limits: the bench's rules are MODELLED on these ids, not hadolint itself. hadolint's DL3002 fires only
when the last USER is root; a Dockerfile with no USER at all does not trip it, so the bench adds its own
DKR-USER. DL3064's real heuristic is hadolint's; ours matches names containing PASSWORD, PASSWD, SECRET, TOKEN,
API_KEY, APIKEY, PRIVATE_KEY, ACCESS_KEY. Three lab rules are ours, labelled on the widget: DKR-ORDER (whole
project copied before the dependency install), DKR-USER (final stage never sets USER), DKR-CONTEXT (whole
context copied and .dockerignore does not exclude .env).

### Base images (Docker Hub tag API, linux/amd64 compressed size, read 2026-11-16, sources/*.json)
| Tag | Compressed MB | Tag last updated |
|---|---|---|
| python:latest | 419.02 | 2026-11-11 |
| python:3.12 | 411.93 | 2026-11-06 |
| python:3.12-slim | 43.27 | 2026-11-08 |
| python:3.12-alpine | 18.05 | 2026-11-12 |
| python:3.13-slim | 43.07 | 2026-11-08 |
| python:3.14-slim | 43.56 | 2026-11-08 |
| postgres:16 | 166.18 | 2026-11-15 |
| postgres:16-alpine | 116.24 | 2026-11-15 |
| postgres:17 | 167.33 | 2026-11-15 |
- python image docs (docker-library/docs python README, read at source): `latest` is the tag list
  "3.15.2, 3.15, 3, latest", so **python:latest is Python 3.15 at the time of writing**, not the 3.12 on
  Stackyard's laptop. `3.12-slim` is currently `3.12.16-slim-trixie` (Debian 13). The slim variant contains
  "only the minimal Debian packages needed to run python" and lacks what is needed to compile extension
  modules; the alpine variant uses musl libc and "software will often run into issues depending on the depth
  of their libc requirements/assumptions"; Alpine itself is about 5 MB.
- python:3.12-slim at the time of writing (Docker Hub tag API, 2026-11-16): image index digest `sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b`; linux/amd64 manifest `sha256:05a994d2344eb364cc186910f4fc8786a38215f39f00d0acc25bff33a08f4177` (43.27 MB compressed); linux/arm64 manifest `sha256:c61cffc3bacb94ed026ff8b45d5114b7693dd0420baca0a1ace0e3d0ce9035fd` (43.54 MB). One tag, one index, one manifest per platform: the OCI image index in practice.
- Docker Hub shows compressed sizes; an image on disk is larger. Pages say "compressed, as Docker Hub lists it".

### Python wheels and the alpine disagreement (contested: teach both sides)
- PEP 656 (peps.python.org, read at source; status Final): the `musllinux` platform tag for binary wheels on
  musl-based distributions such as Alpine, because manylinux wheels (glibc) cannot be used there.
- PyPI JSON API, 2026-11-16, cp312 x86_64 (read at source, snapshots in sources/pypi/): numpy 2.5.5, pandas
  3.1.1, scipy 1.18.1, pydantic-core 2.50.4 and psycopg2-binary 2.9.13 publish musllinux wheels;
  **scikit-learn 1.9.1 publishes no musllinux wheel** (manylinux, macOS and Windows only), so on Alpine pip
  builds it from source. Wheel sizes: numpy 15.72 MB manylinux / 17.08 musllinux; pandas 12.03 / 13.11; scipy
  35.34 / 37.48; scikit-learn 9.17 / none; psycopg2-binary 4.28 / 3.36. All 14 glibc wheels total 80.39 MB.
- Reported (one practitioner, his own test): Itamar Turner-Trauring, "Using Alpine can make Python Docker
  builds 50x slower" (pythonspeed.com, created 2020-01-29, updated 2026-01-30): his build took about 1,557 s on
  Alpine vs 30 s on Debian slim and the Alpine image came out larger (851 MB vs 363 MB); his 2026 update says
  musllinux wheels make Alpine "much less of a problem these days" while he remains "personally wary of using
  musl". Teach: the 2020 numbers are his 2020 test; the 2026 picture depends on whether every package you need
  ships a musllinux wheel, which you can check on PyPI in a minute.
- Distroless (GoogleContainerTools/distroless README, read at source): images contain "only your application
  and its runtime dependencies" and no package managers or shells; `gcr.io/distroless/static-debian13` is
  "around 2 MiB", "about 50% of the size of alpine (~5 MiB), and less than 2% of the size of debian (124 MiB)";
  `python3-debian13` is published; `:debug` tags add a busybox shell. The README also says restricting the runtime to what the app needs "improves the signal to noise of scanners (e.g. CVE)". Trade-off: no shell means no `docker exec`
  debugging and no pip in the final image.

### Compose (docs.docker.com, read at source)
- Services reference: `depends_on` short syntax creates services in dependency order but "Compose does not wait
  for dependency services to be "healthy""; long syntax conditions `service_started`, `service_healthy`,
  `service_completed_successfully`; `healthcheck` with `test`, `interval`, `timeout`, `retries`,
  `start_period`; `env_file` values are overridden by `environment`; ports `HOST:CONTAINER` as a quoted string;
  `volumes` mount host paths or named volumes.
- Networking: Compose "sets up a single default network for the app"; containers reach each other by service
  name; the docs' example: `web` reaches Postgres at `postgres://db:5432` while the host reaches the same
  database on the published host port; "The HOST_PORT and CONTAINER_PORT serve different purposes."

### Postgres image and Compose companions (read at source 2026-11-16)
- docker-library postgres README (snapshot in sources/): "The only variable required is POSTGRES_PASSWORD";
  POSTGRES_USER optional (default user `postgres`). For PostgreSQL 17 and below, mount the data volume at
  `/var/lib/postgresql/data` (not `/var/lib/postgresql`), otherwise an anonymous volume is created and data does
  not persist when the container is re-created; from 18 the PGDATA path became version specific. Appending
  `_FILE` (e.g. `POSTGRES_PASSWORD_FILE=/run/secrets/postgres-passwd`) loads the value from a file such as a
  Docker secret.
- PostgreSQL 16 docs, pg_isready: "a utility for checking the connection status of a PostgreSQL database
  server. The exit status specifies the result of the connection check." It ships with the server, so a
  Compose healthcheck can be `test: ["CMD-SHELL", "pg_isready -U postgres"]`.
- Compose has no scheduler: a nightly job is a service you run on demand (`docker compose run --rm job`),
  triggered by a scheduler outside Compose (host cron, CI, an orchestrator). (Follows from the Compose
  services reference, which has no schedule attribute; taught as such.)
- Compose profiles (docs.docker.com "Using profiles with Compose", read at source): services assigned to a profile are not started by a plain `docker compose up`; "When a service with assigned profiles is explicitly targeted on the command line its profiles are started automatically", so `docker compose run --rm job` works.
- jupyterlab 4.6.6 is the current PyPI release (read 2026-11-16), for a notebook service built from
  python:3.12-slim.

### Per-layer rows the lab prints (for session 2 and 6 figures; layer MB, modelled where apt/pip cache)
Rung 4 (pinned slim): FROM python:3.12-slim 43.27 MB base · WORKDIR 0 · RUN apt-get curl 40.3 MB (apt lists
left in the layer) · COPY requirements.txt 0.01 MB · RUN pip install 160.78 MB (80.39 packages + 80.39 pip
cache kept in the layer) · COPY . . 4.31 MB (7 files) · ENV, EXPOSE, CMD 0 MB -> 248.67 MB.
Rung 5 (multi-stage): builder pip layer 160.78 MB stays in the builder; final stage: base 43.27 · COPY
--from=builder 80.39 MB · COPY app/ 4.26 MB (4 files) -> 127.92 MB.
Rung 6 (hardened): builder pip 80.39 MB (no cache); final: base 43.27 · RUN useradd 0.01 · COPY --from 80.39
· COPY app/ 4.26 -> 127.93 MB. Naive: COPY . . 604.32 MB (16 files, includes .venv 412 MB, data 118 MB,
.git 63.5 MB and .env) on python:latest 419.02 MB.

### Docker Desktop VM (docs.docker.com "Virtual Machine Manager", read at source)
- "Docker Desktop supports multiple Virtual Machine Managers (VMMs) to power the Linux VM that runs containers."
  On Mac the options listed are Docker VMM and the Apple Virtualization framework (HyperKit deprecated, Intel only).
  So on a Mac or Windows laptop, Linux containers share the kernel of that Linux VM, not of macOS.

### Docker Desktop licensing and alternatives (docker.com pricing FAQ, read at source; re-verify)
- Docker Desktop without a paid subscription is restricted to non-commercial open source and to commercial use
  in organisations with "fewer than 250 employees and less than US $10,000,000 ... in annual revenue";
  government entities must buy a subscription. Docker Engine and other Moby open source are not covered by
  these restrictions.
- Alternatives named only (installing them is self-study): Podman, Colima, Rancher Desktop.

## Bench canon (layer cache lab, computed 2026-11-16)

Engine `assets/dkr-live.js`; twin `materials/dkr_reference.py`; `materials/compare-ladder.py py.json node.json`
-> 265 values compared, 0 differ, planted fault caught. Unit tests `dkr_rule_tests.json`: 38/38 pass in node and
in python (one fires and one passes per rule, plus 7 glob cases).

Modelled parameters (printed on the widget): pull 0.025 s/MB; context 0.01 s/MB (a rebuild sends only the
changed file); COPY 0.3 s + 0.02 s/MB; pip 0.6 s per package + 0.1 s/MB install + 0.2 s/MB download; a package
with no wheel for the platform +420 s to compile; apt 6 s + 1 s per package, curl 4.6 MB without recommends /
21.3 MB with, apt lists 19 MB if not removed; apk 3 s + 1 s per package, build-base 196 MB; metadata
instructions 0.05 s. pip without --no-cache-dir keeps a second copy (the cache) in the layer. Image size =
compressed base + layer sizes, approximate. Package sizes use the cp312 wheels on every base.

"Steps" = RUN, COPY, ADD, WORKDIR in the stages the final stage needs (FROM, ENV, CMD... are not counted).

| Rung (preset) | Rebuild after app code change | after requirements.txt | after data file | after README | First build | Final image | Context | Lint |
|---|---|---|---|---|---|---|---|---|
| 1 naive | 52.1 s (1 of 4 cached) | 52.1 s | 53.2 s | 52.1 s | 68.6 s | 1224.42 MB | 604.32 MB, 16 files | 9 |
| 2 + .dockerignore | 40.1 s (1 of 4) | 40.1 s | 0 s (4 of 4) | 40.1 s | 50.6 s | 624.41 MB | 4.31 MB, 7 files | 8 |
| 3 dependency layer first | 0.5 s (4 of 5) | 33.4 s (2 of 5) | 0 s | 0.5 s | 50.9 s | 624.42 MB | 4.31 MB | 7 |
| 4 pinned slim base | 0.5 s (4 of 5) | 33.4 s | 0 s | 0.5 s | 41.5 s | 248.67 MB | 4.31 MB | 6 |
| 5 multi-stage | 0.5 s (5 of 6) | 35.3 s (2 of 6) | 0 s | 0 s | 36.5 s | 127.92 MB | 4.31 MB | 4 |
| 6 non-root + lint clean | 0.5 s (6 of 7) | 35.3 s (3 of 7) | 0 s | 0 s | 36.9 s | 127.93 MB | 4.31 MB | 0 |
| Side road: alpine | 0.9 s (4 of 6) | 454.9 s (2 of 6) | 0 s | 0 s | 459.5 s | 302.62 MB | 4.31 MB | 0 |

Lint ids per rung: naive DL3007 DKR-CONTEXT DL3015 DL3009 DL3042 DKR-ORDER DL3064 DL3025 DKR-USER; + ignore drops
DKR-CONTEXT; deps-first drops DKR-ORDER; slim drops DL3007; multi-stage drops DL3015 DL3009 (no apt in it);
hardened drops DL3042 DL3064 DL3025 DKR-USER -> 0.
Naive copies `.env` into the final image (secret file in image: yes); every other rung: no.
Base images: naive..deps-first python:latest 419.02 MB; slim..hardened python:3.12-slim 43.27 MB; alpine 18.05 MB.
Alpine notes: the only package with no musllinux wheel is scikit-learn, compiled from source (modelled 420 s);
`apk add build-base` (modelled 196 MB) is why the alpine image ends at 302.62 MB, above the slim multi-stage.

Base tag re-pointed upstream (build --pull), rebuild: naive 62.6 s (0 of 4 cached), slim 41.5 s, multi-stage
36.4 s, hardened 36.8 s (0 of 7). A digest-pinned FROM is untouched by a moved tag: rung 6 with both FROM lines digest-pinned and "base tag moved upstream" rebuilds in 0 s (7 of 7 cached). Rung 6 with a pip cache mount (`RUN --mount=type=cache,target=/root/.cache/pip pip install ...`) after a requirements change: 19.2 s (3 of 7) against 35.3 s, lint 0. The session 3 single-stage Dockerfile (pinned slim, deps first, non-root, exec CMD): lint 0.

Anti-levers (break buttons):
- **COPY . . first** on rung 6 (hardened): app code change rebuild 0.5 s -> **35.6 s** (3 of 8 cached), image
  127.93 MB (unchanged: the copy lands in the builder stage). On rung 4 (slim): 0.5 s -> 40.7 s (1 of 6).
- **Float to :latest** on rung 6: image 127.93 MB -> **503.68 MB**, and a re-pointed tag rebuilds 46.2 s
  (0 of 7). On rung 4: 248.67 -> 624.42 MB, 50.9 s.

## Seams (pick the side out loud, link with absolute https, never reteach)

| Sibling | They own | Here | Link |
|---|---|---|---|
| learn-dataops b1, b6, b8 | Docker as one piece of a CI/CD platform; deploy | Docker itself; s6 links b1 for CI and b8 for deploy | https://phoebefu6.github.io/learn-dataops-with-phoebe/courses/b1-foundations-repo.html , .../b8-full-cd-capstone.html |
| learn-gitlab b7 | pushing images to a registry from GitLab CI | registries named only (s2), link | https://phoebefu6.github.io/learn-gitlab-with-phoebe/courses/b7-registry-and-templates.html |
| learn-command-line | the terminal | prerequisite, linked from the landing | https://phoebefu6.github.io/learn-command-line-with-phoebe/ |
| learn-aws, learn-gcp, learn-terraform | running containers in a cloud, IaC | none; one "where next" card in s6 | https://phoebefu6.github.io/learn-aws-with-phoebe/ , learn-gcp, learn-terraform |
| learn-agent-secrets-access s4 | secrets for agents | s6 one card: never bake secrets into images | https://phoebefu6.github.io/learn-agent-secrets-access-with-phoebe/courses/04-keep-the-key-out.html |

## Constraint reality

No Docker install is needed for any build-along: everything runs in the page or on the bench. Installing
Docker Desktop (licence above), Podman, Colima or Rancher Desktop is a Self-study card in session 1.

## Not covered (honest list)

Kubernetes and any orchestrator; cloud container runtimes (Cloud Run, ECS, Fargate, App Runner); pushing to a
registry from CI (gitlab b7, dataops b1); writing Compose for production or Swarm; Docker networking drivers
beyond the Compose default network; rootless Docker daemon setup; image signing and SBOM generation tools in
depth (named only as a category in s6); BuildKit remote builders and cache export to registries; Windows
containers; GPU containers; any specific scanner's output format (scanning is taught as a category).

## Citation appendix (form pages use)

- Docker Docs, "Virtual Machine Manager" - docs.docker.com/desktop/features/vmm/
- Docker Docs, "Docker overview" - docs.docker.com/get-started/docker-overview/
- Docker Docs, "Understanding the image layers" ("Layers let you extend images of others by reusing their base layers") - docs.docker.com/get-started/docker-concepts/building-images/understanding-image-layers/
- Docker Docs, "Docker build cache" - docs.docker.com/build/cache/
- Docker Docs, "Build cache invalidation" - docs.docker.com/build/cache/invalidation/
- Docker Docs, "Optimize cache usage in builds" - docs.docker.com/build/cache/optimize/
- Docker Docs, "Building best practices" - docs.docker.com/build/building/best-practices/
- Docker Docs, "Multi-stage builds" - docs.docker.com/build/building/multi-stage/
- Docker Docs, "Build context" (.dockerignore) - docs.docker.com/build/concepts/context/
- Docker Docs, "Build secrets" - docs.docker.com/build/building/secrets/
- Docker Docs, "Dockerfile reference" - docs.docker.com/reference/dockerfile/
- Docker Docs, Compose file reference, "Services" - docs.docker.com/reference/compose-file/services/
- Docker Docs, "Using profiles with Compose" - docs.docker.com/compose/how-tos/profiles/
- Docker Docs, "Networking in Compose" - docs.docker.com/compose/how-tos/networking/
- Docker Hub, official `python` and `postgres` images (tag API, 2026-11-16); docker-library/docs python README
- hadolint README rule table - github.com/hadolint/hadolint (GPL-3.0)
- OCI Image Format Specification - github.com/opencontainers/image-spec/blob/main/spec.md
- PEP 656, "Platform Tag for Linux Distributions Using Musl" - peps.python.org/pep-0656/
- PyPI JSON API, per-package release files (2026-11-16)
- docker-library/docs, postgres README (Docker Hub official postgres image)
- PostgreSQL 16 documentation, pg_isready - postgresql.org/docs/16/app-pg-isready.html
- I. Turner-Trauring, "Using Alpine can make Python Docker builds 50x slower", pythonspeed.com (reported)
- GoogleContainerTools/distroless README - github.com/GoogleContainerTools/distroless
- Docker pricing FAQ and Docker Desktop licence terms - docker.com/pricing/faq/
