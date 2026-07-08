# Privacy Policy for fix-quera

fix-quera does not sell, share, transmit, or remotely collect any personal data.

The extension runs only on Quera pages. It reads deadline, hard-deadline, allowed-delay, assignment, course, archive-state, and submission-delay values that are already present in the Quera page HTML, and uses them locally in the browser to display clearer deadline and delay information.

For course pages, fix-quera stores a small cache only in the user's local browser extension storage so it can avoid repeated requests to Quera. This cache may include the Quera course ID, assignment ID, assignment name, calculated delay value, observed delay samples, display value, normal deadline, hard deadline, extra-time seconds, fetch time, and fetch status.

For delay buckets, fix-quera stores local per-course bucket settings in the user's local browser extension storage. This may include Quera course IDs, bucket titles, bucket keywords, capacity values, rounding choices, assignment IDs, and manual assignment include/exclude choices.

For assignment state, fix-quera stores local done choices and manual delay overrides in the user's local browser extension storage, with a same-device Quera-page storage mirror so the page-world filter can hide done assignments from Quera's upcoming-deadline widget before it renders. This may include Quera course IDs, assignment IDs, assignment names, done flags, override-active flags, override delay seconds, and update times.

For Calendar prompts, fix-quera stores local prompt metadata in the user's local browser extension storage so course-card Calendar buttons can stay hidden for already prompted deadlines and reappear when a deadline changes. This may include Quera course IDs, course names, assignment IDs, assignment names, deadline prompt signatures, prompt times, and local cache update times.

For course follow filtering, fix-quera stores local course follow choices and supporting course metadata in the user's local browser extension storage, with a same-device Quera-page storage mirror so the page-world filter can run before Quera renders or updates its deadline widget. This may include Quera course IDs, course names, archive-state flags, assignment-to-course mappings, and whether the user manually chose to follow or unfollow a course.

This cached and preference data stays on the user's device. fix-quera does not send it to the developer, to any third-party service, or to any server controlled by fix-quera. fix-quera does not store this data anywhere outside the user's browser.

fix-quera does not use analytics, tracking, remote code, cookies, background services, or external APIs. It does not read browser cookies directly, but Quera requests made by the browser may use the user's existing Quera session in the normal way. When the user clicks a Calendar button, fix-quera opens prefilled Google Calendar pages in the user's browser; the user decides whether to save those events in Google Calendar.

Users can remove the locally stored cache by clearing the extension's site/extension data or uninstalling the extension.

Removing extension/site data also removes local course follow choices, assignment state, and page-storage mirrors. After that reset, active courses are treated as followed and archived courses are treated as unfollowed again until the user manually toggles a course.

Contact: alirezakeshavarzhedayati@gmail.com
