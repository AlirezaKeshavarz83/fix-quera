# Changelog

All notable changes to fix-quera are documented in this file.

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
