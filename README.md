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
- Caches course-page delay results for 10 minutes.
- Refreshes stale course delay data through a throttled queue of 1 request per second.
- Handles Quera client-side navigation without requiring a manual page reload after the extension is already loaded.
- Supports Chrome and Firefox WebExtension packaging.

## Install Locally

### Chrome

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this project directory.
5. Reload existing Quera tabs once after installing or reloading the extension.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click Load Temporary Add-on.
3. Select `manifest.json` from this project directory.

## Release Files

Release archives should contain only:

- `manifest.json`
- `content.js`

Build them with:

```sh
scripts/package-release.sh 0.3.0
```

Generated archives are written to `dist/`. Do not commit them; upload them to the matching GitHub Release instead.

## Development Notes

- The extension is intentionally a single content script.
- Quera assignment pages expose deadline data through script globals such as `finish_time` and `extra_time`.
- Course pages do not expose final delay data directly, so the extension fetches each assignment's `/submissions/final` page.
- The content script is injected on all `https://quera.org/*` pages so Quera's React/Next client-side navigation can be detected. Expensive work is still route-gated to course and assignment pages.

## Maintenance

- Local captures, screenshots, generated zips, and browser-review experiments belong in `.local/`.
- Release notes live in `CHANGELOG.md`.
- Privacy claims live in `PRIVACY.md` and should be kept aligned with extension permissions and storage behavior.
- Use Conventional Commits and make future changes through pull requests.
