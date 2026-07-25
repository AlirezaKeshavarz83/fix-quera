# Fix Quera

Quera has the information you need; it just does not always show it clearly.

Fix Quera is a browser extension for Chrome and Firefox that makes Quera course and assignment pages easier to understand and manage. It surfaces deadlines and submission delays, helps you track delay allowances, filters upcoming work, and lets you add deadlines directly to Google Calendar.

Everything runs inside your browser. Fix Quera stores its settings and cached data locally and does not send your Quera data to the developer.

## Features

### See the real deadline picture

- Both the normal deadline and the hard deadline on assignment pages, with the current state: normal time, extra time, or finished.
- The extra-time window (`مهلت اضافه`) rounded down, shown in minutes when it is under three hours.
- Live elapsed delay (`در تاخیر`) once the normal deadline has passed but the hard deadline has not.
- Durations and near deadlines in Persian digits, such as `۳ روز و ۲۳ ساعت`. Deadlines within 24 hours show as a timestamp with the date on hover.

### Know your delay per submission

- Replaces Quera's `ضریب نمره` / `ضریب تاخیر` submission column with a plain `میزان تاخیر` column, and adds that column when Quera does not provide one at all (delay is derived from the deadline and each submission timestamp).
- Per-assignment delay badges on course pages, based on your final submission.
- Clear distinction between `بدون تاخیر` (submitted on time) and `بدون ارسال` (nothing submitted).
- `مجموع تاخیر` on each course page: the sum of the delays shown for that course.

### Plan your delay budget

- Local delay budget buckets in the `درسنامه‌ها` section of a course, so you can model rules like "10 days total across homework".
- Buckets match assignments by keyword, and you can include or exclude individual assignments by hand.
- Capacity in days plus hours, with per-bucket rounding by none, hour, or day.
- Progress bars with used and remaining capacity, plus a warning when one assignment is counted in two buckets.

### Keep the page focused on what matters to you

- Follow or unfollow courses locally, and filter Quera's upcoming-deadline widget down to followed courses only.
- Mark an assignment as done to drop it from that widget.
- Set an assignment's delay by hand when it was not submitted on Quera. Overrides flow into course totals and buckets.
- Active courses start as followed and archived courses as unfollowed, until you choose otherwise. Clearing extension data resets to those defaults.

### Get deadlines into your calendar

- Google Calendar buttons on assignment pages for both the deadline and the hard deadline.
- One-time Calendar buttons on course cards that come back when a deadline changes.

### Built to stay out of the way

- Works automatically on Quera pages after installation.
- Supports Quera's client-side navigation without requiring page reloads.
- Fits both the light and dark Quera interfaces.
- Available for Chrome and Firefox.

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/ipdgalbogcfdhhjcjljkcpnalkpiehle?utm_source=github&utm_medium=readme&utm_campaign=repo_readme&utm_content=chrome)
- [Firefox Add-ons](https://addons.mozilla.org/en-GB/firefox/addon/fix-quera/?utm_source=github&utm_medium=readme&utm_campaign=repo_readme&utm_content=firefox)

## Privacy and permissions

Fix Quera runs only on quera.org.

It uses browser extension storage for local settings such as followed courses, completed assignments, manual delay corrections, delay-budget groups, Calendar prompts, and cached delay information.

This data stays in your browser. Fix Quera does not send it to the developer or store it on an external server.

When you use a Calendar button, the extension opens a prefilled Google Calendar page. Nothing is added until you choose to save the event yourself.

Full details are in [PRIVACY.md](PRIVACY.md).

## Install locally

### Chrome

1. Clone or download this repository.
2. Open `chrome://extensions/`.
3. Enable Developer mode.
4. Select Load unpacked.
5. Choose the project directory.
6. Reload any Quera tabs that were already open.

### Firefox

1. Clone or download this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select Load Temporary Add-on.
4. Choose `manifest.json`.
5. Reload any Quera tabs that were already open.

## Development

Create a release package with:

```sh
scripts/package-release.sh <version>
```

Useful checks:

```sh
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"
node --check content.js
node --check page-data-filter.js
scripts/package-release.sh <version>
```

The release package contains:

- `manifest.json`
- `content.js`
- `page-data-filter.js`

The project uses [Conventional Commits](https://www.conventionalcommits.org/) for commit messages. Local experiments, captures, and generated zips belong in `.local/` and should not be committed.

Release notes are available in [CHANGELOG.md](CHANGELOG.md), store listing copy in [docs/store-listing.md](docs/store-listing.md), and maintainer guidance in [AGENTS.md](AGENTS.md).
