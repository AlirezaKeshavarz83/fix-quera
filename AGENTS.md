# Agent Guidance

This repository contains a small WebExtension for improving Quera course and assignment pages.

## Project Shape

- Treat `content.js` as the extension entrypoint.
- Keep route-specific behavior gated by the current Quera URL. The manifest intentionally injects on `https://quera.org/*` so client-side navigation can be detected, but expensive work should stay limited to course and assignment pages.
- Keep `manifest.json` permissions aligned with the real behavior of the extension. If storage, host access, or data handling changes, update `PRIVACY.md`, `README.md`, and store-review text together.

## Local Files

- Do not commit local Quera captures, browser screenshots, generated zips, or review experiments.
- Put local-only artifacts in `.local/`.
- Generate release zips into `dist/`; `dist/` is ignored and release zips should be uploaded to GitHub Releases instead of committed.

## Development Checks

- Before committing, run:

```sh
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --check content.js
scripts/package-release.sh 0.3.0
```

- Inspect generated zips before uploading a release. They should contain only `manifest.json` and `content.js`.

## Release Workflow

- Use Conventional Commits such as `feat:`, `fix:`, `docs:`, and `chore:`.
- Every change should be made on a feature branch and reviewed through a pull request.
- For a release PR, update `manifest.json` and `CHANGELOG.md`.
- After the release PR is merged, tag from `main`, create a GitHub Release, and attach fresh zip files from `dist/`.
