# Changelog

All notable changes to fix-quera are documented in this file.

## v0.5.2 - 2026-07-07

- Refined extension UI to better match Quera's Chakra course pages and legacy assignment pages in light and dark themes.
- Changed the assignment-page deadline bar to a compact two-row layout, collapsed identical deadline/hard-deadline values into one label, and prefixed earlier deadlines with Persian daypart labels.
- Moved course assignment delay badges into the existing assignment metadata row with a vertical separator.
- Reduced delay text visual weight in submission tables and course assignment cards.
- Fixed course follow controls on client-side course navigation by preferring route and visible heading metadata over stale Next.js page data.
- Added documented Quera UI style guidance for future extension changes.

## v0.5.1 - 2026-07-04

- Reduced route poll interval from 2s to 500ms for snappier SPA navigation detection.

## v0.5.0 - 2026-07-04

- Added local per-course delay budget buckets in the `درسنامه‌ها` section.
- Added bucket creation and editing with optional title, keyword, days+hours capacity, and none/hour/day rounding.
- Matched assignments into buckets by keyword, with manual assignment include/exclude overrides.
- Showed bucket usage, remaining capacity, progress bars, stale/loading/error states, and overlap warnings.
- Moved bucket creation, editing, and assignment management into a modal with a simpler capacity field and member-only assignment controls.
- Simplified bucket cards and refined the modal capacity, rounding, and assignment-add controls.
- Kept delay bucket settings local in browser extension storage.

## v0.4.3 - 2026-07-04

- Added adaptive rate limiter for course delay fetches: starts at 1 req/sec, escalates to 1 req/2sec after 10s, 1 req/3sec after 30s, etc. De-escalates after 30s idle. Immediately escalates on 429/5xx responses.
- Added smart cache TTLs: 3 days for assignments past hard deadline, 1 hour for active assignments on course pages, 5 minutes on assignment pages, instant on submissions pages.
- Added hard-deadline detection from fetched submission page HTML to determine cache tier.
- Skipped fetch entirely for assignments whose deadline has not been reached yet.
- Added lazy delay cache enrichment on assignment and submissions page visits.
- Fixed input focus loss during background delay fetching by deferring DOM updates while the user is typing and updating badges in-place instead of tearing down and rebuilding.
- Broke MutationObserver feedback loop in course follow controls via render-key deduplication.
- Increased route poll timer from 1s to 2s and suppressed it while typing.
- Changed fetch cache policy from `no-store` to `no-cache` to allow browser 304 responses.

## v0.4.2 - 2026-06-29

- Fixed archived course deadlines leaking into the upcoming-deadline widget when the course list was viewed with the active filter.
- Stopped inferring a course's archived state from the selected course-list status filter, so a course referenced outside the current filter (e.g. in the deadline widget) can no longer be mislabeled as active.
- Made the stored archived flag sticky so a value inferred without page data can no longer overwrite a known archived state.
- Verified the Chrome release zip contents and compressed data.
- Verified Firefox 152.0.3 accepts the current temporary add-on manifest with `world: "MAIN"`.
- Documented compatibility checks and local follow-state default/reset behavior.

## v0.4.1 - 2026-06-29

- Added a compact calendar-check indicator on followed Quera course-list cards.
- Kept course follow/unfollow actions in each course card's three-dot menu.

## v0.4.0 - 2026-06-29

- Added local follow/unfollow controls for Quera courses.
- Filtered Quera's upcoming-deadline widget to show deadlines only for followed courses.
- Added local course follow preferences, course metadata, and assignment-to-course mapping storage.
- Defaulted active courses to followed and archived courses to unfollowed until manually overridden.
- Added a page-world `document_start` data filter so hard loads and Quera client-side route JSON can be filtered before rendering.
- Documented observed Quera course-list and course-detail data shapes for future development.

## v0.3.0 - 2026-06-24

- Added course-page per-assignment final-submission delay badges.
- Added course-page total delay display as `مجموع تاخیر`.
- Added local browser-extension cache for course delay results.
- Added throttled course-delay refreshes to avoid sending all Quera requests at once.
- Updated delay formatting to Persian digits and Persian duration text.
- Replaced Quera submission-table delay coefficient columns with `میزان تاخیر`.
- Added fallback submission delay calculation when Quera does not provide a delay column.
- Improved behavior on Quera client-side navigation so extension UI loads without manual reloads.
- Added Chrome and Firefox WebExtension packaging support.
