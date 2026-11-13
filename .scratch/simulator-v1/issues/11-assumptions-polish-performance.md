# 11: Assumptions panel, visual polish, canvas performance

Status: resolved
Type: task
Blocked by: 08, 09

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Make it honest, good-looking and smooth.

## In scope

- Permanent "Simulated model, not a capacity prediction" marker.
- Assumptions panel listing every simplification in the spec in plain language (instant Connections, instant skipping of Killed Components, no retries, random Work times around a mean, one downstream call per Request, Rate independent of how the architecture copes, Queue does not redeliver).
- Visual design pass over the whole interface to the dark operations-dashboard direction in the spec: consistent spacing, type, colour meaning (the green / amber / red scale must also be distinguishable without colour), empty and error states, keyboard focus.
- Canvas performance: cap on drawn dots, no React re-render of every node on every frame, smooth at 4x speed with about 20 Components and a Rate in the high hundreds. Measure before and after and note the numbers in the ticket comments.
- First-visit hint that points at the one-click ways to break the default Scenario.

## Out of scope

Mobile layout, light theme, tutorial mode, new simulation behaviour.

## Acceptance checks

- Every assumption in the spec appears in the panel.
- Frame rate stays near 60 in the stress case above on an ordinary laptop.
- All tests still pass.

## See it working

A first-time visitor understands what they are looking at within a few seconds and can find the assumptions without hunting.

## Comments

### Resolved (2026-11-12)

**Honesty**
- A permanent "Simulated model, not a capacity prediction · Assumptions" marker is pinned to the top-right corner of the canvas (`src/app/Assumptions.tsx`). Clicking it opens a modal dialog listing 11 assumptions in plain language. It covers every simplification in the ticket (instant Connections, instant skipping of Killed Components, no retries, random Work times around a mean, one downstream call per Request, Rate independent of how the architecture copes, Queue does not redeliver). It also covers call-and-wait slot holding, timed-out work carrying on, changes applying to future work only, and what is not modelled at all.
- A first-visit hint over the default Scenario offers one-click ways to break it: double the traffic, kill the Database, or open "One server down" (`src/app/FirstVisitHint.tsx`). Dismissing it is remembered in localStorage.

**Look**
- At the repo owner's request, every corner has zero radius, including buttons, panels, Components, inputs, React Flow's controls and the Request dots (now squares).
- Also at the owner's request, there are six themes, chosen under "Look" at the bottom of the palette and remembered in localStorage. "Control room" is the sober default. The other five are deliberately loud: Vaporwave sunset, Toxic spill, Bubblegum brutalist, Molten core and Y2K chrome. Every colour, surface and typeface is a CSS variable in `styles.css`.
- Two of the loud themes (Bubblegum, Chrome) have light surfaces. That goes beyond the spec's "light theme" exclusion, but the owner explicitly asked for these looks. The chart series and Outcome colours are unchanged in every theme, because they are the validated palette.
- The status scale no longer depends on colour alone. Each status has a glyph (✓ Healthy, ▲ Busy, ✖ Overloaded, ⊘ Killed) as well as its word. Border weight also grows with status: Busy is thicker and Overloaded is a double border.
- There is now an empty-canvas state, and every theme has a visible `:focus-visible` outline.

**Performance**
- Components read a throttled readout (snapshot plus smoothed Utilisation), refreshed every 100 ms of wall time while playing, so they no longer re-render every frame. An Intervention or edit refreshes it immediately.
- Edges are memoised and re-render only when they move. They register their line geometry instead of subscribing to time and dots.
- All Request dots are drawn by one `DotLayer` under the Components, from a store subscription. It moves a pool of at most 150 SVG squares (the existing dot cap) without going through React.

**Measurements**
- Stress case: 20 Components (2 Sources at 450 req/s each, 12 Servers, 4 Databases, a Queue and its worker), at 4x speed with the dot cap full. The figures are per frame: store tick, React commit and forced layout, measured over 240 frames.

| | Mean | Median | p95 | Worst |
| --- | --- | --- | --- | --- |
| Before | 3.72 ms | 3.20 ms | 5.90 ms | 14.8 ms |
| After | 0.72 ms | 0.50 ms | 1.70 ms | 5.7 ms |

- The engine's share of each frame (about 0.24 ms) is unchanged.
- Real frame rate after the change, with the browser pane visible at 1440×900: 72 fps (the display's refresh rate), no frame over 20 ms, and the Run never fell behind. This was measured in Control room and in Vaporwave, which has the heaviest gradients and shadows.
- Not measured: a real-frame-rate baseline before the change, and Molten core and the other themes. The pane was hidden at those points, which throttles animation frames.

**Checks**
- 120 tests pass and `tsc -b` is clean. No engine code changed.
