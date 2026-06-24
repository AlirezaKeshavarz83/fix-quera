# Changelog

All notable changes to fix-quera are documented in this file.

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
