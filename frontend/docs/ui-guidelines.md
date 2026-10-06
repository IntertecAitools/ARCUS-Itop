# UI guidelines

The rules a screen has to follow to look like it belongs in this app. They exist
so twelve modules built by different people still read as one product.

---

## 1. Never write a raw colour

`src/styles/globals.css` is the only file containing hex values. Everything else
uses the Tailwind utilities those tokens generate, or — when a value must be
handed to a library — the `var()` references in `src/theme`.

| Need                        | Use                                                |
| --------------------------- | -------------------------------------------------- |
| Page background             | `bg-canvas`                                        |
| Card / panel                | `bg-surface border-line rounded-card shadow-card`  |
| Popover, modal, dropdown    | `bg-surface-raised shadow-overlay`                 |
| Table header / inset well   | `bg-surface-sunken`                                |
| Hover wash                  | `bg-surface-hover`                                 |
| Headings                    | `text-ink`                                         |
| Body copy                   | `text-ink-secondary`                               |
| Labels, meta, axis ticks    | `text-ink-muted`                                   |
| Primary action              | `bg-brand text-white`                              |
| Active nav, selected chip   | `bg-brand-soft text-brand-ink`                     |

If you find yourself reaching for `text-slate-500` or `#2563eb`, the token is
missing — add it to `globals.css` rather than inlining the value.

## 2. Light and dark are both *designed*

Dark mode is not an inversion. Each token has an independently chosen dark step,
declared under `:root[data-theme='dark']`. Adding a token means adding **both**
values. Check your screen in both modes before calling it done.

Theme switching is a single attribute flip on `<html>`, so no component ever
reads the current theme or branches on it.

## 3. Charts

Covered in depth by the header comments in `src/theme/charts.ts`. The short
version:

- **Pick the form from the data's job** — magnitude, identity, polarity, change
  over time, or a single headline. Sometimes the answer is a stat tile, not a chart.
- **One y-axis. Never two.** Two measures of different magnitude become two
  charts, small multiples, or both indexed to a common base. A dual axis lets the
  author place any two lines anywhere relative to each other, which makes the
  comparison meaningless.
- **Series colours are assigned in fixed slot order and never cycled.** Colour
  follows the *entity*, not its rank — filtering out a series must not repaint
  the survivors. Use `createSeriesScale(keys)` for this.
- **Cap at eight series.** A ninth is never a generated hue: fold the tail into
  an "Other" slice, or facet.
- **Sequential = one hue light→dark. Diverging = two hues with a neutral grey
  midpoint.** Never a rainbow, never a hue at the diverging midpoint.
- **A legend is always present for two or more series**, and with four or fewer
  the chart also direct-labels — identity never rests on colour alone.
- **Text wears text tokens, never the series colour.** The swatch beside a label
  carries identity; the label itself stays legible ink.
- **Chrome stays recessive**: hairline horizontal gridlines only, no vertical
  rules, no axis line where the grid already implies one.
- **Ship the hover layer.** Line and area charts get a crosshair and tooltip;
  bar, dot and cell charts get a per-mark tooltip. The only exception is a bare
  stat tile with no plot.
- **Animation off.** Growth animation delays the actual reading and fights
  `prefers-reduced-motion`.

Re-run the palette validator if you touch the hues. The current set passes all
six checks — lightness band, chroma floor, CVD separation, normal-vision
separation and contrast — in both modes.

## 4. Status is never colour alone

`good`, `warning`, `serious` and `critical` are reserved roles. They are never
reused as a chart series colour, so a red mark in a chart can never be mistaken
for "critical priority".

Every status is rendered through `StatusPill` or `PriorityBadge`, which pair the
colour with a dot **and** a text label. Don't hand-roll a coloured chip.

Adding a status means adding it to `src/types/ticket.ts` *and* to the map in the
component — the unit test fails otherwise.

## 5. Page composition

Every routed screen opens with `<PageHeader>`: breadcrumbs, title, optional
description, and an actions slot on the right.

Filters and time-range controls live in **one row above the content**, never
repeated per card — otherwise nobody can tell what a given chart is scoped to.

Modules render a page body and nothing else. The sidebar, topbar, command
palette and error boundary belong to `AgentLayout`; a module never draws chrome.

## 6. States are part of the feature

Every data-backed surface needs four states, not one:

| State   | Component                                                      |
| ------- | -------------------------------------------------------------- |
| Loading | `Skeleton` / `SkeletonCard`, shaped like the loaded content     |
| Empty   | `EmptyState` with a title and a sentence of context             |
| Error   | `ErrorBoundary`, or an inline `role="alert"` for a failed query |
| Loaded  | the real thing                                                  |

Skeletons must match the loaded silhouette so nothing shifts when data lands.

## 7. Accessibility floor

- Icon-only controls use `IconButton`, which requires a `label`.
- Interactive elements are real `<button>`/`<a>`; never a clickable `<div>`.
- A `<Link>` is never nested inside a `<button>` — use `buttonClasses()` to give
  a link the button's look.
- Landmark labels go on the landmark itself (`<nav aria-label>`, not the
  wrapping `<aside>`).
- One focus treatment, defined once in `globals.css`. Don't remove outlines.
- Columns of numbers get `tabular-nums`; standalone hero figures stay
  proportional.

## 8. Naming and placement

| Thing              | Goes in                                    |
| ------------------ | ------------------------------------------ |
| Used by one module | `features/<module>/components/`            |
| Used by two+       | `components/` (promote it, don't copy it)  |
| Ticket vocabulary  | `src/types/ticket.ts`                      |
| Network call       | `features/<module>/api/`, via `lib/api-client` |
| Query key          | `lib/query/keys.ts` — never inline         |

`components/` and `lib/` must never import from `features/`. Features import
from each other only through `features/<x>/index.ts`.
