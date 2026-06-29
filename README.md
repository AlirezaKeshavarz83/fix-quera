# Fix Quera

Fix Quera is a browser extension that improves Quera course and assignment pages by making deadline and delay information easier to see.

## Features

- Shows the normal deadline and hard deadline on assignment pages.
- Shows whether an assignment is in normal time, extra time, or finished.
- Shows the configured extra-time window as `مهلت اضافه`.
- Shows elapsed delay as `در تاخیر` when the normal deadline has passed but the hard deadline has not.
- Formats durations in Persian, with Persian digits, such as `۳ روز و ۲۳ ساعت`.
- Replaces Quera's `ضریب نمره` / `ضریب تاخیر` submission-table column with `میزان تاخیر`.
- Adds a `میزان تاخیر` column when Quera does not provide one, computing delay from the assignment deadline and each submission timestamp.
- Shows per-assignment final-submission delay badges on course pages.
- Shows `مجموع تاخیر` on course pages as the sum of displayed per-assignment delays.
- Adds local follow/unfollow controls for courses.
- Filters Quera's upcoming-deadline widget to show only followed courses.
- Defaults active courses to followed and archived courses to unfollowed until the user chooses otherwise.
- Caches course-page delay results for 10 minutes.
- Refreshes stale course delay data through a throttled queue of 1 request per second.
- Handles Quera client-side navigation without requiring a manual page reload after the extension is already loaded.
- Supports Chrome and Firefox WebExtension packaging.

## Install Locally

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

- `manifest.json`
- `content.js`
- `page-data-filter.js`
The cached data stays in your browser. It is not sent to the developer or stored anywhere else by Fix Quera.

## Development

```sh
scripts/package-release.sh 0.4.0
```

To develop locally, clone this repo and load it as an unpacked extension in Chrome (`chrome://extensions/` → Load unpacked) or a temporary add-on in Firefox (`about:debugging` → Load Temporary Add-on).

Useful local checks:

```sh
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --check content.js
scripts/package-release.sh <version>
```

The project uses [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`). Local experiments, captures, and generated zips belong in `.local/` and should not be committed.

Release notes are kept in [CHANGELOG.md](CHANGELOG.md). Maintainer and agent guidance lives in [AGENTS.md](AGENTS.md).
