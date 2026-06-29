# Agent Guidance

This repository contains a small WebExtension for improving Quera course and assignment pages.

## Project Shape

- Treat `content.js` as the isolated extension entrypoint for UI, extension storage, course metadata collection, assignment mapping, and delay tags.
- Treat `page-data-filter.js` as the page-world data-filter entrypoint. It must not touch extension storage APIs, buttons, menus, delay tags, or DOM outside `#__NEXT_DATA__`.
- Keep route-specific behavior gated by the current Quera URL. The manifest intentionally injects on `https://quera.org/*` so client-side navigation can be detected, but expensive work should stay limited to course and assignment pages.
- Keep `manifest.json` permissions aligned with the real behavior of the extension. If storage, host access, or data handling changes, update `PRIVACY.md`, `README.md`, and store-review text together.

## Quera Page Data Findings

- Use Chrome/browser inspection against real Quera pages before changing route-specific behavior. Quera is a Next/React app and page shape can change; do not infer data contracts from memory alone.
- The course list page (`/course`) exposes its initial page data in `#__NEXT_DATA__`.
  - Upcoming deadlines are at `props.pageProps.course.course_deadline_widget_data`.
  - Deadline entries observed there include assignment `id`, assignment `name`, `finish_time`, `course_name`, and `problems`, but not a course ID.
  - Course cards are backed by `props.pageProps.course.courses.edges[].node`.
  - Course nodes observed there include `id`, `name`, `is_archived`, `archived_by`, `user_count`, `assignment_count`, `lecture_count`, `term`, `school`, and `instructor_name`.
- Course detail pages (`/course/{id}`) expose their initial page data in `#__NEXT_DATA__` at `props.pageProps.course`.
  - The course object includes `id`, `name`, `assignments`, `lectures`, `current_pao`, and other course detail fields.
  - Assignment entries observed there include `pk`, `name`, `start_time`, `finish_time`, `problem_count`, and `state`.
  - Use `assignments[].pk` to lazily populate assignment ID to course ID mappings.
- The course list UI has a status filter with values `all`, `active`, and `archived`. Active course nodes have `is_archived: false`; archived course nodes should be treated as unfollowed by default unless a local manual override exists.
- Active course-card menus were observed with a Chakra menu button and an `آرشیو برای من` menu item. Add extension menu items next to that menu item without calling Quera archive APIs.
- Chakra leaves hidden menu portals in the DOM. When adding course-card menu items, anchor the insertion to the expanded card button's `aria-controls` menu instead of using the first `[role="menu"]` on the page.
- Course follow state is canonical in extension storage. The isolated `content.js` keeps a same-device Quera-page storage mirror in sync so `page-data-filter.js` can synchronously filter `course_deadline_widget_data` in Quera's page world.
- Deadline data filtering ownership is split deliberately: `page-data-filter.js` filters `#__NEXT_DATA__` and page-world `fetch`/`XMLHttpRequest` JSON responses; `content.js` must not inject inline page scripts or patch page-world networking.

## Compatibility Findings

- `dist/fix-quera-0.4.0.zip` was verified with `unzip -t` and contains exactly `manifest.json`, `content.js`, and `page-data-filter.js`.
- Firefox 152.0.3 accepted the repo manifest as a temporary add-on with `world: "MAIN"` on the `page-data-filter.js` content script. Do not remove `world: "MAIN"` for compatibility unless Firefox rejects it in a real temporary-add-on test; if that happens, split Chrome/Firefox manifest generation instead.

## Local Files

- Do not commit local Quera captures, browser screenshots, generated zips, or review experiments.
- Put local-only artifacts in `.local/`.
- Generate release zips into `dist/`; `dist/` is ignored and release zips should be uploaded to GitHub Releases instead of committed.

## Development Checks

- Before committing, run:

```sh
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --check content.js
node --check page-data-filter.js
scripts/package-release.sh 0.4.2
```

- Inspect generated zips before uploading a release. They should contain only `manifest.json`, `content.js`, and `page-data-filter.js`.

## Release Workflow

- Use Conventional Commits such as `feat:`, `fix:`, `docs:`, and `chore:`.
- Every change should be made on a feature branch and reviewed through a pull request.
- For a release PR, update `manifest.json` and `CHANGELOG.md`.
- After the release PR is merged, tag from `main`, create a GitHub Release, and attach fresh zip files from `dist/`.
