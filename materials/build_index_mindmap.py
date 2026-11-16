"""Write window.MINDMAP_DATA into index.html with json.dumps (never string interpolation).
Run from the repo root: python3 materials/build_index_mindmap.py"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
S = [
    ("Works on my laptop,\nnowhere else", "01-works-on-my-laptop.html", "#34D399",
     ["Hidden dependencies", "Venv, container, VM", "The container kit"]),
    ("Images, containers,\nlayers", "02-images-containers-layers.html", "#34D399",
     ["Layers are file diffs", "The writable layer", "Tags against digests"]),
    ("A Dockerfile for\nPython data", "03-a-dockerfile-for-python.html", "#FBBF24",
     ["Instruction by instruction", "CMD against ENTRYPOINT", ".dockerignore and USER"]),
    ("The layer\ncache lab", "04-the-layer-cache-lab.html", "#FB923C",
     ["Docker's cache rules", "The six-rung ladder", "Break it on purpose"]),
    ("Compose:\none command", "05-compose-one-command.html", "#FB923C",
     ["Services and networks", "Healthchecks, depends_on", "Volumes and env files"]),
    ("Smaller, safer,\nshippable", "06-smaller-safer-shippable.html", "#F87171",
     ["Multi-stage builds", "Slim, alpine, distroless", "No secret in a layer"]),
]
data = {"title": "Docker &\nContainers", "centerColor": "#01005E", "sessions": [
    {"label": l, "href": "courses/" + h, "color": c,
     "concepts": [{"label": x, "href": "courses/" + h} for x in cs]} for l, h, c, cs in S]}
p = ROOT / "index.html"
s = p.read_text()
block = "<script>\nwindow.MINDMAP_DATA = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n</script>"
s2 = re.sub(r"<script>\nwindow\.MINDMAP_DATA = .*?;\n</script>", lambda m: block, s, flags=re.S)
assert s2 != s or block in s
p.write_text(s2)
print("mindmap nodes:", 1 + len(S) + sum(len(x[3]) for x in S))
