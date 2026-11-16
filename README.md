# Learn Docker & Containers with Phoebe

Why it works on your laptop and nowhere else, and the one container that fixes it. Six 45-minute
sessions for data, analytics and ML people: write a Dockerfile for a data project, keep rebuilds fast,
and run the whole stack with one command. By Phoebe Fu.

| # | Session |
|---|---|
| 1 | Why it works on your laptop and nowhere else |
| 2 | Images, containers, layers: the mental model |
| 3 | Writing a Dockerfile for a Python data project |
| 4 | The layer cache lab (the bench) |
| 5 | Compose: notebook, API, database, one command |
| 6 | Smaller, safer, shippable |

The running case, Stackyard, is a constructed four-person analytics team; no real company.

**The layer cache lab** (`assets/dkr-live.js`) parses a Dockerfile and a .dockerignore in the browser,
applies Docker's documented build cache rules for the file you change, and reports which layers
rebuild, the rebuild time, the image size and 13 lint rules (10 modelled on hadolint rule ids, 3 of
its own). Base image sizes come from Docker Hub and package sizes from PyPI, both read 2026-11-16;
every time in seconds and every apt/apk size is a modelled parameter, labelled on the widget.
`materials/dkr_reference.py` is an independent Python twin; `materials/compare-ladder.py` checks the
two agree on every value.

No Docker install is needed for any session. Static site: open `index.html`.
