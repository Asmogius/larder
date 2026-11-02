# Larder tests

- `scripts/test-node.sh` — unit tests (`tests.js`) under 7 time zones (DST edge cases), catalog validator (`scripts/validate-data.mjs`), corrupt/quota storage handling.
- `node tests/e2e/e2e.cjs` — end-to-end suite at phone (390×844 touch) and desktop sizes. Needs `playwright-core` (`npm i playwright-core`, or `NODE_PATH=…/node_modules`) and Chrome (`CHROME=/path`, default `/usr/bin/google-chrome`). Fixtures for recipe import live in `tests/fixtures/`.
- `python3 scripts/make-icons.py` regenerates web + Android launcher icons.
