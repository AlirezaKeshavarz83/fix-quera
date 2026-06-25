# Fix Quera

Fix Quera is a small browser extension that makes Quera course and assignment pages easier to read.

Quera already has the data students need, but deadline and delay details are often spread across the page or hidden behind less useful table columns. Fix Quera keeps that information visible in the places where you actually need it: assignment pages, submission tables, and course assignment lists.

## What It Adds

- Clear assignment deadline and hard-deadline information.
- A compact status for normal time, extra time, delay, and finished assignments.
- Persian duration formatting with Persian digits, such as `۳ روز و ۲۳ ساعت`.
- A clearer `میزان تاخیر` column in submission tables.
- Automatic delay calculation when Quera does not show a delay column.
- Per-assignment final-submission delay badges on course pages.
- A course-level `مجموع تاخیر` summary.

## How It Works

Fix Quera runs locally in your browser on Quera pages. It reads deadline and submission-delay information from the page HTML, then adds a cleaner interface on top of the existing Quera UI.

On course pages, the extension may fetch assignment final-submission pages from Quera to calculate delay badges. Results are cached locally for a short time so the extension does not repeatedly request the same pages.

Fix Quera does not use analytics, tracking, remote code, or external APIs. See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## Install

### Chrome

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/fix-quera/ipdgalbogcfdhhjcjljkcpnalkpiehle).

To load a local build instead:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this project directory.
5. Reload any Quera tabs that were already open.

### Firefox

Firefox add-on coming soon.

To load a local build:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click Load Temporary Add-on.
3. Select `manifest.json` from this project directory.
4. Reload any Quera tabs that were already open.

## Permissions

Fix Quera asks for access to Quera pages so it can read and improve the deadline/submission information shown there. It also uses browser extension storage for a local course-delay cache.

The cached data stays in your browser. It is not sent to the developer or stored anywhere else by Fix Quera.

## Development

This extension is intentionally lightweight: the implementation is a WebExtension manifest plus a single content script.

To develop locally, clone this repo and load it as an unpacked extension in Chrome (`chrome://extensions/` → Load unpacked) or a temporary add-on in Firefox (`about:debugging` → Load Temporary Add-on).

Useful local checks:

```sh
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --check content.js
scripts/package-release.sh <version>
```

The project uses [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`). Local experiments, captures, and generated zips belong in `.local/` and should not be committed.

Release notes are kept in [CHANGELOG.md](CHANGELOG.md). Maintainer and agent guidance lives in [AGENTS.md](AGENTS.md).
