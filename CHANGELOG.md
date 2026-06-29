# Changelog

All notable changes to fix-quera are documented in this file.

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
