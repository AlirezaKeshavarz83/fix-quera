# Store Listing Copy

Canonical text for the Chrome Web Store and Firefox Add-ons (AMO) listings. Keep this file, `README.md`, `PRIVACY.md`, and the `manifest.json` description in sync when behavior changes.

## Chrome Web Store

### Name

```text
Fix Quera
```

### Short description (max 132 characters)

```text
See real delay, remaining extra time, and per-course delay budgets on Quera. Everything stays local in your browser.
```

### Detailed description

```text
Quera tells you when an assignment is due. It does not tell you how late you actually are, how much extra time is left, or how much of your delay budget you have already burned.

Fix Quera adds that missing layer. It reads what is already on the Quera page and turns it into the numbers students actually track.

SEE THE REAL DEADLINE PICTURE
• Normal deadline and hard deadline together on assignment pages, with the current state: normal time, extra time, or finished.
• The extra-time window (مهلت اضافه) rounded down, and shown in minutes when it is under three hours.
• Live elapsed delay (در تاخیر) once the normal deadline has passed but the hard deadline has not.
• Persian-digit durations such as ۳ روز و ۲۳ ساعت, and a timestamp for deadlines less than 24 hours away.

KNOW YOUR DELAY PER SUBMISSION
• Quera's ضریب نمره / ضریب تاخیر submission column is replaced with a plain میزان تاخیر column.
• When Quera shows no such column at all, one is added, with delay computed from the deadline and each submission time.
• Course pages get a delay badge per assignment, based on your final submission, and a مجموع تاخیر total for the course.
• بدون تاخیر (submitted on time) is never confused with بدون ارسال (nothing submitted).

PLAN YOUR DELAY BUDGET
• Create delay budget buckets per course, so you can model rules like "10 days total across all homework".
• Buckets match assignments by keyword, and you can include or exclude individual assignments by hand.
• Set capacity in days plus hours, and round each bucket by none, hour, or day.
• Progress bars show used and remaining capacity, and warn you when an assignment lands in two buckets.

KEEP THE PAGE FOCUSED
• Follow or unfollow courses, and filter Quera's upcoming-deadline widget down to the ones you follow.
• Mark an assignment as done to drop it from that widget.
• Override an assignment's delay by hand when the computed value does not match reality; overrides flow into course totals and buckets.

GET DEADLINES INTO YOUR CALENDAR
• Google Calendar buttons for both the deadline and the hard deadline, on assignment pages and course cards.
• A course-card button reappears when a deadline changes, so you can update the event.

PRIVACY
Fix Quera runs only on quera.org. It needs storage permission to keep its cache and your settings, and everything it computes stays in your browser. There is no account, no server, no analytics, and no remote code. Calendar buttons only open a prefilled Google Calendar page; saving the event is still your choice.

Open source: https://github.com/AlirezaKeshavarz83/fix-quera
```

### Category

Productivity / Workflow & Planning

### Single-purpose description

```text
Fix Quera has one purpose: to improve how deadline, extra-time, and submission-delay information is presented on quera.org course and assignment pages.
```

### Permission justifications

```text
Host access to https://quera.org/*: The extension reads deadline, assignment, course, and submission values already present on Quera pages, and injects the delay and deadline UI into those pages. It runs nowhere else.

storage: Used to keep a local 10-minute cache of course delay results, plus the user's local settings: delay buckets, follow choices, assignment done state, manual delay overrides, and Calendar prompt state. This data never leaves the device.

Remote code: None. The extension ships only manifest.json, content.js, and page-data-filter.js.
```

## Firefox Add-ons (AMO)

### Name

```text
Fix Quera
```

### Summary (max 250 characters)

```text
Fix Quera shows the real delay picture on Quera: normal and hard deadlines, remaining extra time, live delay, per-submission delay, and per-course delay budgets. Everything is computed and stored locally in your browser.
```

### Description

```text
Quera tells you when an assignment is due. It does not tell you how late you actually are, how much extra time is left, or how much of your delay budget you have already burned. Fix Quera adds that missing layer, using data that is already on the page.

See the real deadline picture
- Normal deadline and hard deadline together on assignment pages, with the current state: normal time, extra time, or finished.
- The extra-time window (مهلت اضافه) rounded down, and shown in minutes when it is under three hours.
- Live elapsed delay (در تاخیر) between the normal and hard deadline.
- Persian-digit durations such as ۳ روز و ۲۳ ساعت, and a timestamp for deadlines less than 24 hours away.

Know your delay per submission
- Quera's ضریب نمره / ضریب تاخیر submission column becomes a plain میزان تاخیر column, and is added when Quera provides no such column.
- Course pages get a per-assignment delay badge and a مجموع تاخیر course total.
- بدون تاخیر (submitted on time) is distinguished from بدون ارسال (nothing submitted).

Plan your delay budget
- Per-course delay budget buckets with keyword matching and manual include/exclude.
- Capacity in days plus hours, with rounding by none, hour, or day.
- Progress bars for used and remaining capacity, plus double-counting warnings.

Keep the page focused
- Follow or unfollow courses and filter Quera's upcoming-deadline widget accordingly.
- Mark assignments as done to hide them from that widget.
- Override a computed delay by hand; overrides flow into course totals and buckets.

Get deadlines into your calendar
- Google Calendar buttons for deadlines and hard deadlines on assignment pages and course cards, reappearing when a deadline changes.

Privacy
Fix Quera runs only on quera.org, collects no data, and sends nothing anywhere. Its cache and your settings live in local extension storage. No analytics, no remote code, no account.

Source code: https://github.com/AlirezaKeshavarz83/fix-quera
```

### Tags

`quera`, `deadline`, `productivity`, `education`, `persian`

### Notes for reviewers

```text
The add-on is a content script pair for https://quera.org/* only. page-data-filter.js runs in the page world (world: "MAIN") so it can filter Quera's Next.js __NEXT_DATA__ and page-world fetch/XHR JSON before Quera's upcoming-deadline widget renders; this is what hides unfollowed courses and assignments the user marked as done. content.js runs in the isolated world and owns all injected UI and extension storage. No remote code is loaded, no data is transmitted, and no build step or minification is used: the reviewed sources are the shipped sources.
```

## GitHub repository "About"

### Description

```text
Browser extension that shows real delay, remaining extra time, and per-course delay budgets on Quera course and assignment pages.
```

### Topics

`quera`, `browser-extension`, `chrome-extension`, `firefox-addon`, `manifest-v3`, `webextension`, `productivity`, `deadlines`
