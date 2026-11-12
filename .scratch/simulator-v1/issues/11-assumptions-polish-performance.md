# 11: Assumptions panel, visual polish, canvas performance

Status: open
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
