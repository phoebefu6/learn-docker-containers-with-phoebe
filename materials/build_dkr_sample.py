"""Build assets/dkr-sample.js for the layer cache lab, from the snapshots in materials/sources/.

Real (read at source, 2026-11-16, snapshots kept in materials/sources/):
  - base image compressed sizes: Docker Hub tag API, linux/amd64 ("full_size"), per tag
  - wheel sizes: PyPI JSON API, cp312 x86_64 manylinux and musllinux wheels (or py3-none-any)
Modelled (labelled on the widget): every time parameter, apt package sizes, the Stackyard project files.

Run:  python3 materials/build_dkr_sample.py      (no network; reads the snapshots only)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "sources")
OUT = os.path.join(HERE, "..", "assets", "dkr-sample.js")


def mb(b):
    # bytes -> MB (10^6), two decimals, quantised so JS and Python start from identical numbers
    return int(b / 10000 + 0.5) / 100


def hub(repo, tag):
    d = json.load(open(os.path.join(SRC, f"{repo}-{tag}.json")))
    amd = [i for i in d["images"] if i["architecture"] == "amd64" and i["os"] == "linux"][0]
    return {"ref": f"{repo}:{tag}", "mb": mb(amd["size"]), "updated": d["last_updated"][:10],
            "index_digest": d["digest"], "amd64_digest": amd["digest"]}


BASES = [hub("python", t) for t in ["latest", "3.12", "3.12-slim", "3.12-alpine", "3.13-slim", "3.14-slim"]]
BASES += [hub("postgres", t) for t in ["16", "16-alpine", "17"]]
PY_LATEST_IS = "3.15.2"  # docker-library/docs python README: tags "3.15.2, 3.15, 3, latest"

REQS = ["fastapi", "starlette", "pydantic", "pydantic-core", "uvicorn", "pandas", "numpy",
        "python-dateutil", "tzdata", "scikit-learn", "scipy", "joblib", "threadpoolctl", "psycopg2-binary"]


def wheel(files, tag):
    for f in files:
        n = f["filename"]
        if not n.endswith(".whl"):
            continue
        if "none-any" in n:
            return n, f["size"]
        if "cp312" in n and tag in n and "x86_64" in n:
            return n, f["size"]
    return None, None


PACKAGES = []
for p in REQS:
    d = json.load(open(os.path.join(SRC, "pypi", f"{p}.json")))
    gn, gs = wheel(d["files"], "manylinux")
    mn, ms = wheel(d["files"], "musllinux")
    PACKAGES.append({
        "name": d["name"].lower(), "version": d["version"],
        "glibc_mb": mb(gs), "glibc_wheel": gn,
        "musl_mb": mb(ms) if ms else None, "musl_wheel": mn,
    })

# Constructed Stackyard project (the files a build context would carry). Sizes are constructed.
FILES = [
    {"path": "Dockerfile", "mb": 0.01, "kind": "build"},
    {"path": ".dockerignore", "mb": 0.01, "kind": "build"},
    {"path": "requirements.txt", "mb": 0.01, "kind": "deps"},
    {"path": "README.md", "mb": 0.02, "kind": "docs"},
    {"path": ".env", "mb": 0.01, "kind": "secret"},
    {"path": "app/__init__.py", "mb": 0.01, "kind": "code"},
    {"path": "app/main.py", "mb": 0.02, "kind": "code"},
    {"path": "app/scoring.py", "mb": 0.03, "kind": "code"},
    {"path": "app/model.joblib", "mb": 4.2, "kind": "model"},
    {"path": "app/__pycache__/scoring.cpython-312.pyc", "mb": 0.05, "kind": "junk"},
    {"path": "jobs/nightly_scores.py", "mb": 0.02, "kind": "code"},
    {"path": "tests/test_scoring.py", "mb": 0.03, "kind": "test"},
    {"path": "notebooks/explore_scores.ipynb", "mb": 6.4, "kind": "notebook"},
    {"path": "data/scores_2025.parquet", "mb": 118.0, "kind": "data"},
    {"path": ".git/objects/pack/pack-3f2a.pack", "mb": 63.5, "kind": "vcs"},
    {"path": ".venv/lib/python3.12/site-packages/numpy/core.so", "mb": 412.0, "kind": "venv"},
]

CHANGES = [
    {"id": "code", "label": "app code (app/scoring.py)", "path": "app/scoring.py"},
    {"id": "deps", "label": "requirements.txt", "path": "requirements.txt"},
    {"id": "data", "label": "a data file (data/scores_2025.parquet)", "path": "data/scores_2025.parquet"},
    {"id": "docs", "label": "README.md", "path": "README.md"},
    {"id": "none", "label": "nothing (rebuild unchanged)", "path": None},
    {"id": "base", "label": "base tag moved upstream (build --pull)", "path": None},
]

# Every time and apt size below is MODELLED, not measured. Printed on the widget.
MODEL = {
    "context_s_per_mb": 0.01,      # sending the build context to the builder
    "pull_s_per_mb": 0.025,        # pulling a base image
    "meta_s": 0.05,                # WORKDIR, ENV, EXPOSE, CMD, USER, LABEL, ARG, ENTRYPOINT
    "copy_s": 0.3, "copy_s_per_mb": 0.02,
    "pip_pkg_s": 0.6, "pip_s_per_mb": 0.1, "pip_dl_s_per_mb": 0.2,
    "pip_unknown_mb": 1.0,
    "sdist_build_s": 420.0,        # compiling a package that has no wheel for the platform
    "apt_base_s": 6.0, "apt_pkg_s": 1.0, "apt_lists_mb": 19.0,
    "apt": {"curl": [4.6, 21.3], "build-essential": [214.0, 241.0], "gcc": [62.0, 71.0],
            "libpq-dev": [9.5, 12.0], "git": [38.0, 52.0]},
    "apk_base_s": 3.0, "apk": {"build-base": 196.0, "curl": 3.1, "libpq": 1.2},
    "apk_cache_mb": 2.5,
    "user_s": 0.4, "user_mb": 0.01,
    "run_other_s": 1.0,
}

DOCKERIGNORE_STANDARD = """# keep the build context to what the image needs
.git
.venv
.env
data/
notebooks/
tests/
**/__pycache__
*.pyc
Dockerfile
.dockerignore
"""

P_NAIVE = """FROM python:latest
WORKDIR /app
COPY . .
RUN apt-get update && apt-get install -y curl
RUN pip install -r requirements.txt
ENV DB_PASSWORD=stackyard-dev-123
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

P_DEPS_FIRST = """FROM python:latest
WORKDIR /app
RUN apt-get update && apt-get install -y curl
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
ENV DB_PASSWORD=stackyard-dev-123
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

P_SLIM = """FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y curl
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
ENV DB_PASSWORD=stackyard-dev-123
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

P_MULTI = """FROM python:3.12-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /install /usr/local
COPY app/ ./app/
ENV DB_PASSWORD=stackyard-dev-123
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

P_HARDENED = """FROM python:3.12-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
RUN useradd --create-home --uid 10001 stackyard
COPY --from=builder /install /usr/local
COPY app/ ./app/
USER stackyard
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
"""

P_ALPINE = """FROM python:3.12-alpine
WORKDIR /app
RUN apk add --no-cache build-base
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
RUN adduser -D -u 10001 stackyard
USER stackyard
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
"""

PRESETS = [
    {"id": "naive", "label": "1 · Stackyard naive", "dockerfile": P_NAIVE, "ignore": ""},
    {"id": "ignore", "label": "2 · + .dockerignore", "dockerfile": P_NAIVE, "ignore": DOCKERIGNORE_STANDARD},
    {"id": "depsfirst", "label": "3 · dependency layer first", "dockerfile": P_DEPS_FIRST, "ignore": DOCKERIGNORE_STANDARD},
    {"id": "slim", "label": "4 · pinned slim base", "dockerfile": P_SLIM, "ignore": DOCKERIGNORE_STANDARD},
    {"id": "multistage", "label": "5 · multi-stage", "dockerfile": P_MULTI, "ignore": DOCKERIGNORE_STANDARD},
    {"id": "hardened", "label": "6 · non-root + lint clean", "dockerfile": P_HARDENED, "ignore": DOCKERIGNORE_STANDARD},
    {"id": "alpine", "label": "Side road · alpine", "dockerfile": P_ALPINE, "ignore": DOCKERIGNORE_STANDARD, "side": True},
]

SAMPLE = {
    "snapshot_date": "2026-11-16",
    "python_latest_is": PY_LATEST_IS,
    "bases": BASES, "packages": PACKAGES, "files": FILES, "changes": CHANGES,
    "model": MODEL, "presets": PRESETS, "ignore_standard": DOCKERIGNORE_STANDARD,
}

with open(OUT, "w") as f:
    f.write("/* Layer cache lab sample - generated by materials/build_dkr_sample.py with json.dumps.\n"
            "   Base sizes: Docker Hub tag API, linux/amd64 compressed, read 2026-11-16.\n"
            "   Wheel sizes: PyPI JSON API, cp312 x86_64, read 2026-11-16.\n"
            "   Times, apt sizes and the Stackyard project files are modelled / constructed. */\n")
    f.write("window.DKR_SAMPLE = " + json.dumps(SAMPLE, separators=(",", ":")) + ";\n")
print("wrote", OUT, os.path.getsize(OUT), "bytes;", len(BASES), "bases,", len(PACKAGES), "packages")
for b in BASES:
    print(" ", b["ref"], b["mb"], "MB", b["updated"])
print("  glibc wheels total", round(sum(p["glibc_mb"] for p in PACKAGES), 2), "MB")
