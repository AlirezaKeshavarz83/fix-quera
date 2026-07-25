# Store Listing Copy

Canonical text for the Chrome Web Store and Firefox Add-ons (AMO) listings. Keep this file, `README.md`, `PRIVACY.md`, and the `manifest.json` description in sync when behavior changes.

## Chrome Web Store

### Name

```text
Fix Quera
```

### Short description (max 132 characters)

```text
Fix Quera adds the UX pieces Quera is missing — the ones you have been quietly working around all semester.
```

### Detailed description

```text
Quera has the information you need; it just does not always show it clearly.

Fix Quera improves Quera course and assignment pages so you can quickly understand when an assignment is due, how much delay you have used, and what work is still left.

With Fix Quera, you can:
• See how late each submission actually was (میزان تاخیر) and how much delay a course has cost you in total (مجموع تاخیر), instead of Quera's ضریب نمره / ضریب تاخیر column.
• Organise your extra-time allowances into separate delay budgets, and always know how much of each budget is used and how much is left.
• Keep Quera's upcoming-deadlines section down to the courses you follow and the work you have not finished yet.
• Add normal deadlines and hard deadlines to Google Calendar.
• See the normal deadline and hard deadline together, whether an assignment is in normal time, extra time (مهلت اضافه), or closed, and how much delay is accumulating right now (در تاخیر).
• Set an assignment's delay yourself when it was not submitted on Quera, and have it count in totals and budgets.

Privacy: Fix Quera runs only on quera.org. It uses extension storage for local settings and a local cache, and everything stays in your browser. No account, no server, no analytics, no remote code. Calendar buttons only open a prefilled Google Calendar page; saving the event is still your choice.

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

storage: Used to keep a short-lived local cache of course delay results, refreshed as deadlines approach and expiring on its own, plus the user's local settings: delay buckets, follow choices, assignment done state, manual delay overrides, and Calendar prompt state. This data never leaves the device.

Remote code: None. The extension ships only manifest.json, content.js, and page-data-filter.js.
```

## Firefox Add-ons (AMO)

### Name

```text
Fix Quera
```

### Summary (max 250 characters)

```text
Fix Quera adds the UX pieces Quera is missing — the ones you have been quietly working around all semester. Deadlines, submission delays, extra-time budgets, and upcoming work, all made clear, and all kept inside your browser.
```

### Description

```text
Quera has the information you need; it just does not always show it clearly.

Fix Quera improves Quera course and assignment pages so you can quickly understand when an assignment is due, how much delay you have used, and what work is still left.

With Fix Quera, you can:
- See how late each submission actually was (میزان تاخیر) and how much delay a course has cost you in total (مجموع تاخیر), instead of Quera's ضریب نمره / ضریب تاخیر column.
- Organise your extra-time allowances into separate delay budgets, and always know how much of each budget is used and how much is left.
- Keep Quera's upcoming-deadlines section down to the courses you follow and the work you have not finished yet.
- Add normal deadlines and hard deadlines to Google Calendar.
- See the normal deadline and hard deadline together, whether an assignment is in normal time, extra time (مهلت اضافه), or closed, and how much delay is accumulating right now (در تاخیر).
- Set an assignment's delay yourself when it was not submitted on Quera, and have it count in totals and budgets.

Privacy: Fix Quera runs only on quera.org, collects no data, and sends nothing anywhere. Its cache and your settings live in local extension storage. No analytics, no remote code, no account.

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
Chrome and Firefox extension for clearer Quera deadlines, submission delays, delay budgets, course tracking, and calendar planning.
```

### Topics

`quera`, `browser-extension`, `chrome-extension`, `firefox-addon`, `manifest-v3`, `webextension`, `productivity`, `deadlines`
