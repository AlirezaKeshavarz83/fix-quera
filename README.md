# Fix Quera

Quera tells you when an assignment is due. It does not tell you how late you actually are, how much extra time you have left, or how much of your delay budget you have already burned.

Fix Quera is a browser extension that adds that missing layer. It reads what is already on the Quera page and turns it into the numbers students actually track: real delay, remaining extra time, and a per-course delay budget you can plan against.

Everything is computed and stored locally in your browser. No account, no server, no tracking.

## What it does

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
- Override an assignment's delay by hand when the computed value does not match reality (click a course-page badge, or edit it on the assignment page). Overrides flow into course totals and buckets.
- Active courses start as followed and archived courses as unfollowed, until you choose otherwise. Clearing extension data resets to those defaults.

### Get deadlines into your calendar

- Google Calendar buttons on assignment pages for both the deadline and the hard deadline.
- One-time Calendar buttons on course cards that come back when a deadline changes.

## Privacy

Fix Quera only runs on `https://quera.org/*`. It reads deadline, assignment, course, and submission values that are already in the page, and keeps its cache and your settings in local extension storage. Nothing is sent to the developer or to any third party. Calendar buttons just open a prefilled Google Calendar page; saving the event is still your choice.

Full details are in [PRIVACY.md](PRIVACY.md).

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/ipdgalbogcfdhhjcjljkcpnalkpiehle?utm_source=github&utm_medium=readme&utm_campaign=repo_readme&utm_content=chrome)
- [Firefox Add-on](https://addons.mozilla.org/en-GB/firefox/addon/fix-quera/?utm_source=github&utm_medium=readme&utm_campaign=repo_readme&utm_content=firefox)

### Load a local build

Chrome:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this project directory.
5. Reload any Quera tabs that were already open.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click Load Temporary Add-on.
3. Select `manifest.json` from this project directory.
4. Reload any Quera tabs that were already open.

## How it works

The release package is three files: `manifest.json`, `content.js`, and `page-data-filter.js`.

- `content.js` runs in the isolated world and owns everything visible: injected controls, delay tags, storage, and course/assignment mapping.
- `page-data-filter.js` runs in the page world (`world: "MAIN"`) so it can filter Quera's Next.js data before the deadline widget renders.
- Course delay results are cached for 10 minutes, and stale entries refresh through a queue throttled to one request per second.
- Quera is a single-page app, so route changes are detected and handled without a manual reload.

The current manifest has been accepted as a temporary add-on in Firefox 152.0.3. If a future Firefox version rejects `world: "MAIN"`, keep Chrome behavior intact and split Chrome/Firefox package generation instead of weakening the Chrome manifest.

## Development

Build a release package:

```sh
scripts/package-release.sh 0.5.5
```

Useful local checks:

```sh
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --check content.js
node --check page-data-filter.js
scripts/package-release.sh <version>
```

The project uses [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`). Local experiments, captures, and generated zips belong in `.local/` and should not be committed.

Release notes live in [CHANGELOG.md](CHANGELOG.md), store listing copy in [docs/store-listing.md](docs/store-listing.md), and maintainer/agent guidance in [AGENTS.md](AGENTS.md).
