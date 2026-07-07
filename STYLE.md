# Style Guide

## Overall Impression

Quera's authenticated course experience is an RTL developer-tool interface with compact typography, restrained contrast, and a strong teal/cyan accent. It supports both light and dark themes. The newer dashboard, course list, course detail, problemset, contest, and jobs pages use Chakra UI patterns: flat surfaces, subtle borders, 14px base text, small rounded controls, and sparse shadows reserved for floating menus. Assignment problem, submission, and scoreboard pages use an older Semantic UI-like shell with denser tables, smaller text, 4px radii, and theme-dependent neutral borders. For this extension, match both the route and the current theme: Chakra-like on course list/detail pages, legacy Semantic-like on assignment pages.

Observed pages included `https://quera.org/dashboard`, `https://quera.org/course`, `https://quera.org/course?status=all`, `https://quera.org/course?status=active`, `https://quera.org/course?status=archived`, `https://quera.org/course/27180`, `https://quera.org/course/27180?activePost=114868`, assignment problems/submissions/final/scoreboard pages, plus public problemset, contest, jobs, login, home, and blog surfaces. Values below are observed from computed styles unless marked approximate.

## Design Principles

- Mirror Quera's active theme. Check `body.chakra-ui-light` or `body.chakra-ui-dark` on Chakra pages and use the legacy page colors on assignment pages.
- Keep UI compact and operational: small controls, short labels, dense but readable tables.
- Use teal/cyan for primary actions, selected states, and links; do not introduce a second bright brand color.
- Prefer borders and background shifts over heavy shadows.
- Keep injected extension UI visually subordinate to Quera's own controls.
- Preserve RTL flow. Align icons, labels, menus, and spacing for right-to-left reading.
- Match the active page shell instead of forcing one style everywhere.

## Color System

Use theme-aware tokens for new extension UI on authenticated Quera pages:

```css
--color-bg: light-dark(#f7fafc, #171923);
--color-surface: light-dark(#ffffff, #1a202c);
--color-surface-raised: light-dark(#ffffff, #1b1d26);
--color-surface-muted: light-dark(#edf2f7, #1e202a);
--color-border: light-dark(#e2e8f0, #2d3748);
--color-border-legacy: light-dark(rgba(34, 36, 38, 0.15), rgba(71, 112, 153, 0.15));
--color-text: light-dark(#1a202c, #edf2f7);
--color-text-soft: light-dark(#323232, rgba(255, 255, 255, 0.92));
--color-text-muted: light-dark(#718096, #a0aec0);
--color-text-dim: light-dark(rgba(0, 0, 0, 0.5), rgba(220, 225, 229, 0.6));
--color-primary: light-dark(#0e7eaa, #91def3);
--color-primary-strong: light-dark(#0076a6, #47c7eb);
--color-primary-deep: light-dark(#126991, #0e7eaa);
--color-danger: #e53e3e;
--color-success: #38a169;
```

Light Chakra pages use `#f7fafc` as the app background, white nav/surfaces, `#e2e8f0` borders, `#1a202c` text, and deep teal primary buttons (`#0e7eaa`) with white text. Dark Chakra pages use `#171923` as the app background, `#1a202c` surfaces, `#2d3748` borders, `#edf2f7` text, and light cyan primary buttons (`#91def3`) with dark text.

Legacy assignment pages in light mode use a white page/background mix (`#fefefe`, `#ffffff`, `#f9f9f9`), `#323232` text, `rgba(34,36,38,0.15)` borders, and bright blue accents around `#00bcef`/`#0076a6`. In dark mode the same pages use `#171923` page background, `#1b1d26` panels/tables, muted blue-gray borders, and lighter text. Public marketing and blog pages may use other light surfaces, but this extension should follow the current authenticated/course theme.

## Typography

Quera uses a Persian-first sans stack. Authenticated pages observed `IRANYekanX` with Tahoma and Helvetica fallbacks. Blog pages use `iranyekan`; do not switch the extension to a different font.

```css
--font-sans: IRANYekanX, Tahoma, Helvetica, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
--text-xs: 0.75rem;
--text-sm: 0.875rem;
--text-base: 1rem;
--text-lg: 1.125rem;
--text-xl: 1.3125rem;
--text-2xl: 1.6875rem;
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
--line-base: 1.5;
```

On authenticated pages, the computed body text is 14px with a 21px line-height. Chakra headings in course pages are usually 16.8px to 17.5px at 600 weight; larger public/product headings can reach 21px or 27px. Assignment problem pages use 22.1px h1 headings and 12.6px to 13px table text. Buttons are usually 14px medium weight in Chakra pages and 13px bold in legacy assignment tables.

## Spacing and Layout

Quera's newer app shell follows Chakra's 4px spacing scale:

```css
--space-1: 0.25rem;
--space-2: 0.5rem;
--space-3: 0.75rem;
--space-4: 1rem;
--space-6: 1.5rem;
--space-8: 2rem;
--space-12: 3rem;
--container-sm: 40rem;
--container-md: 56rem;
--container-lg: 70rem;
```

The top navigation is 56px tall in both new and legacy shells. Legacy assignment pages add a 40px secondary menu below it. Chakra course list filters use 42px-tall inputs, with a wide search input around 640px and a select around 168px on desktop. Legacy assignment content commonly pairs a 249px right-side vertical menu with a main content column; problem statement panels observed around 700px wide, while submission and scoreboard tables observed around 974px wide.

Use 8px to 16px gaps for compact controls, 16px to 24px inside panels, and 24px to 32px between major page regions. On mobile, controls stack full-width; observed login buttons and inputs become roughly 340px wide in a 390px viewport.

## Shape, Borders, and Elevation

```css
--radius-sm: 0.125rem;
--radius-md: 0.375rem;
--radius-lg: 0.5rem;
--radius-xl: 0.75rem;
--radius-pill: 9999px;
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
--shadow-menu-light: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-menu-dark: 0 0 0 1px rgba(0, 0, 0, 0.1), 0 5px 10px 0 rgba(0, 0, 0, 0.2), 0 15px 40px 0 rgba(0, 0, 0, 0.4);
--border-subtle: 1px solid light-dark(#e2e8f0, #2d3748);
--border-legacy: 1px solid light-dark(rgba(34, 36, 38, 0.15), rgba(71, 112, 153, 0.15));
```

Chakra controls often compute to 5.25px radius because of Quera's 14px base font. Job/course-like cards use about 10.5px radius. Legacy assignment controls and tables use 4px radius. Keep page-level surfaces mostly flat. Use the larger menu shadow only for dark floating menus; light Chakra menus use the much smaller `0 1px 2px` shadow.

## Components

### Buttons

Primary Chakra buttons use 35px or 48px height, 14px medium text, and 0 21px horizontal padding. In light mode they use deep teal (`#0e7eaa`) with white text. In dark mode they use light cyan (`#91def3`) with dark text. Secondary buttons are transparent with a theme border and either normal text or teal/cyan text. Icon buttons are square, commonly 28px, 32px, 35px, or 48px depending on context, with 5.25px radius or pill radius for close buttons.

Legacy assignment buttons are denser: 13px bold text and 4px radius. Light mode uses white/gray controls with semantic fills such as `#25c257` green, `#00bcef` blue, and `#767676` gray. Dark mode uses dark gray backgrounds such as `#282a39`, plus `#219246` green, `#068eb3` blue, and muted gray.

### Inputs

Chakra inputs are 42px high, 5.25px radius, 14px text, and 14px horizontal padding. In light mode they use white backgrounds with `1px solid #e2e8f0`; in dark mode they use `#171923` backgrounds with `1px solid #2d3748`. Jobs search inputs use muted filled fields: `#edf2f7` in light mode and translucent white (`rgba(255,255,255,0.04)`) in dark mode.

Legacy assignment search fields are 35px high with 13px text and 4px radius. Use white fields with `rgba(34,36,38,0.15)` borders in light mode, and transparent or `#1b1d26` fields with muted blue-gray text in dark mode.

### Cards

Newer card-like surfaces use white with `#e2e8f0` borders in light mode, and `#1a202c` with `#2d3748` borders in dark mode. Cards use about 10.5px radius and no obvious shadow. Keep card padding compact and let borders define the edge. Use hover background shifts rather than scaling or strong elevation.

Legacy problem panels use white with `rgba(34,36,38,0.15)` borders in light mode, and `#1b1d26` with `rgba(71,112,153,0.15)` borders in dark mode. They use 4px radius, 20px padding, and a subtle 0 1px 2px shadow.

### Navigation

The main app nav is a flat 56px bar: white in light mode and `#171923` in dark mode. Links are compact, 14px, and rely on muted text with teal/cyan highlights for active or important states. Assignment pages add a 40px secondary menu (`#f9f9f9` light, `#1e202a` dark) and a vertical sidebar around 249px wide. Do not add tall promotional headers or hero layouts inside extension UI.

### Tables and Lists

Chakra tables use 14px text, transparent table backgrounds, and subtle theme borders. Legacy assignment tables are dense: 12.6px to 13px text, 4px radius, and compact rows. Use white table backgrounds with `rgba(34,36,38,0.15)` borders in light mode, and `#1b1d26` table backgrounds with blue-gray borders in dark mode. Keep row actions compact and icon-forward. Avoid adding large badges or wide buttons inside table rows.

### Menus and Popovers

Observed Chakra course menu portal:

- Menu list: white with `#e2e8f0` border in light mode, `#2d3748` with matching border in dark mode, 5.25px radius, 7px vertical padding, about 196px wide.
- Menu items: 32px height, 14px normal text, 5.25px 10.5px padding.
- Hover/active item: `#edf2f7` in light mode, `rgba(255,255,255,0.06)` or `#2d3748` in dark mode.
- Shadow: use `--shadow-menu-light` in light mode and `--shadow-menu-dark` in dark mode.

When adding extension menu items, insert them into the same expanded menu portal and match the menu item height, text size, and padding exactly.

### Badges and Status Indicators

Prefer small, text-like status markers with muted borders or colored text. Use teal/cyan for active/selected, red for destructive/error, green for accepted/success, and gray for inactive. Pill buttons and filter chips were observed around 45px tall on contest/problem surfaces with pill radius and teal/cyan text.

## Interaction States

Hover states should be subtle: shift the surface one step, add a low-contrast border, or switch text to teal/cyan. Focus states must be visible in both themes; use a teal/cyan outline or border that is at least 2px when the component does not already have a clear focus ring. Disabled controls should lower contrast with muted gray text and keep the same layout dimensions. Loading states should preserve button width and table row height.

Do not rely only on color for destructive or delayed states; combine color with clear text, icons, or labels.

## Motion

Quera's app UI feels snappy and restrained. Use short opacity/background/border transitions only.

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--duration-fast: 120ms;
--duration-normal: 160ms;
--duration-slow: 240ms;
```

Avoid bouncy motion, large transforms, animated gradients, or attention-grabbing effects for extension controls.

## Icons and Imagery

Use simple line icons sized 16px to 20px inside buttons. Icon-only buttons should be square and have an accessible label. Assignment pages often use compact icon actions; match that density there. Do not copy Quera logos or proprietary illustrations. Extension icons should feel functional and quiet, not decorative.

## Responsive Behavior

At 390px width, Quera stacks controls and uses full-width form buttons/inputs around 340px wide. Main navigation collapses to compact icon/menu controls on newer surfaces. Course and jobs cards become single-column and full-width. Preserve 44px minimum touch targets for new touchable controls, even when matching dense table UI. Avoid fixed widths that would overflow RTL text; use `max-width: 100%`, wrapping labels, and stable icon-button dimensions.

## Accessibility Rules

- Maintain at least WCAG AA contrast for text against the active light or dark surface.
- Provide a visible focus state for every injected button, menu item, input, and toggle.
- Keep touch targets at least 44px when outside dense desktop-only tables.
- Use semantic buttons for actions and links for navigation.
- Do not encode status only through color.
- Respect `prefers-reduced-motion` by disabling nonessential transitions.
- Preserve RTL direction and keyboard order.

## Do / Don't

### Do

- Match the current Quera shell: Chakra on course/dashboard pages, legacy Semantic style on assignment pages.
- Use Quera's teal/cyan accent sparingly for primary and selected states.
- Keep injected UI compact, border-led, and matched to the current light or dark theme.
- Use 5.25px to 10.5px radii on Chakra pages and 4px radii on assignment pages.
- Anchor extension menu items inside Quera's existing Chakra menu portal when extending course-card menus.

### Don't

- Do not hardcode dark or light colors; derive colors from Quera's current theme.
- Do not use large shadows, gradients, decorative blobs, or marketing-style hero layouts.
- Do not introduce non-Quera fonts or oversized headings.
- Do not make extension controls taller or louder than neighboring Quera controls.
- Do not use left-to-right spacing assumptions on RTL pages.

## Example CSS Tokens

```css
:root {
  /* colors */
  --color-bg: light-dark(#f7fafc, #171923);
  --color-surface: light-dark(#ffffff, #1a202c);
  --color-surface-raised: light-dark(#ffffff, #1b1d26);
  --color-surface-muted: light-dark(#edf2f7, #1e202a);
  --color-border: light-dark(#e2e8f0, #2d3748);
  --color-border-legacy: light-dark(rgba(34, 36, 38, 0.15), rgba(71, 112, 153, 0.15));
  --color-text: light-dark(#1a202c, #edf2f7);
  --color-text-soft: light-dark(#323232, rgba(255, 255, 255, 0.92));
  --color-text-muted: light-dark(#718096, #a0aec0);
  --color-text-dim: light-dark(rgba(0, 0, 0, 0.5), rgba(220, 225, 229, 0.6));
  --color-primary: light-dark(#0e7eaa, #91def3);
  --color-primary-strong: light-dark(#0076a6, #47c7eb);
  --color-primary-deep: light-dark(#126991, #0e7eaa);
  --color-danger: #e53e3e;
  --color-success: #38a169;

  /* typography */
  --font-sans: IRANYekanX, Tahoma, Helvetica, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.3125rem;
  --text-2xl: 1.6875rem;
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;

  /* radius */
  --radius-sm: 0.125rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;
  --radius-pill: 9999px;

  /* shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-menu-light: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-menu-dark: 0 0 0 1px rgba(0, 0, 0, 0.1), 0 5px 10px 0 rgba(0, 0, 0, 0.2), 0 15px 40px 0 rgba(0, 0, 0, 0.4);
  --border-subtle: 1px solid var(--color-border);
  --border-legacy: 1px solid var(--color-border-legacy);

  /* motion */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --duration-fast: 120ms;
  --duration-normal: 160ms;
  --duration-slow: 240ms;
}
```

## Example Component CSS

```css
.fq-button {
  align-items: center;
  background: var(--color-primary);
  border: 0;
  border-radius: 0.375rem;
  color: light-dark(#ffffff, #1a202c);
  display: inline-flex;
  font: 500 0.875rem/1.2 var(--font-sans);
  gap: 0.5rem;
  height: 35px;
  justify-content: center;
  padding: 0 21px;
  transition: background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.fq-button-secondary {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-primary);
}

.fq-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  color: var(--color-text);
  padding: 1rem;
}

.fq-input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  color: var(--color-text);
  font: 400 0.875rem/1.5 var(--font-sans);
  height: 42px;
  padding: 0 14px;
}

.fq-menu-item {
  align-items: center;
  background: transparent;
  color: var(--color-text);
  display: flex;
  font: 400 0.875rem/1.5 var(--font-sans);
  min-height: 32px;
  padding: 5.25px 10.5px;
  width: 100%;
}

.fq-menu-item:hover,
.fq-menu-item:focus {
  background: var(--color-surface-muted);
  outline: none;
}

.fq-legacy-panel {
  background: var(--color-surface-raised);
  border: var(--border-legacy);
  border-radius: 4px;
  color: var(--color-text-soft);
  font: 400 13px/1.5 var(--font-sans);
  padding: 20px;
}
```

## Implementation Notes

The primary style signature is theme-aware Chakra UI with teal/cyan accents, 14px Persian typography, subtle borders, and compact controls. Assignment pages are visually related but older and denser; extension UI there should use 4px radii, smaller table-friendly text, and the route's legacy Semantic surface colors. Avoid copying Quera's brand assets or page content. Recreate the layout rhythm and component treatment so extension features feel native while remaining clearly local to the extension.
