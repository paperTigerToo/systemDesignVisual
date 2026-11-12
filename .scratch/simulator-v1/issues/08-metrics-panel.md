# 08: Metrics panel

Status: resolved
Type: task
Blocked by: 07

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Show the numbers behind the story as small rolling charts.

## In scope

- Engine-side collection, per the spec section "Interface": per Source, completed Requests per second, median and 95th-percentile latency, Outcome breakdown; per Server and Database, Utilisation and Backlog depth; per Queue, depth and time held. Sampled at a fixed simulated interval over a rolling window of about 30 simulated seconds.
- Bottom panel with compact charts: architecture-wide view by default, the selected Component's charts when one is selected.
- Interventions marked on the time axis so cause and effect line up.
- Charts must be cheap to redraw every frame; prefer a small hand-rolled SVG or canvas chart over a heavy charting library.

## Out of scope

Exporting data, comparing Runs.

## Acceptance checks

- Test: metric series are part of the deterministic output (same Scenario, same series).
- Test: percentile calculation against a known list of latencies.
- Test: completed-per-second matches the Rate for an under-loaded architecture, within tolerance.
- Charts stay smooth at 4x speed.

## See it working

Replay the ticket 07 demo: adding a Server leaves completed-per-second flat with a marker on the chart; raising the Database's Concurrency makes it jump.

## Comments

### Resolution notes (ticket 08)

- **Engine:** `Engine.metrics()` returns `MetricSample[]` (types in `src/engine/types.ts`, `percentile` in `src/engine/metrics.ts`).
  - Samples are taken inside `advanceTo` at exact multiples of `metricsInterval` (default 0.5 s), computed from a count so they never drift. They keep `metricsWindow` (default 30 s, so 60 samples).
  - Sampling never touches the random generator, so the series are deterministic (tested: one big step gives the same series as many small steps).
- **What each sample holds:**
  - Each Source: completed per second, median and 95th-percentile latency of Requests Completed in the interval (null if none), and Outcomes per second.
  - An `overall` entry with the same figures for every Source together.
  - Each Server and Database: average Utilisation over the interval (from `occupiedTime`) and Backlog at the sample.
  - Each Queue: depth, and the mean time held of Requests dispatched in the interval.
  - Removed Components drop out of the samples; added ones start at the next sample.
- **Percentiles** interpolate linearly between the nearest ranks.
- **Store:** `metrics` is replaced only when a new sample exists, so charts redraw about twice per simulated second rather than every frame.
- **UI:**
  - `MetricsPanel` runs along the bottom, full width.
  - With nothing (or a Connection) selected it shows the whole architecture: completed per second, latency (median and p95), Outcomes per second as stacked bars, and the highest Utilisation of any Server or Database (the tooltip names which one).
  - A selected Source shows its own three charts, a Server or Database shows Utilisation and Backlog depth, and a Queue shows depth and time held.
- **Chart:** `Chart.tsx` is hand-rolled SVG.
  - It stretches with `preserveAspectRatio="none"` and non-scaling strokes.
  - It has a hover crosshair and tooltip, and a legend for two or more series.
  - Interventions are dashed vertical markers, one per distinct time.
  - The chart colours are CSS tokens checked with the dataviz palette validator against the panel surface (colour-vision and contrast checks pass).
- **Checked in the browser:**
  - The ticket 07 demo (Rate 45, add a Server, then Database Concurrency 8): completed per second stays near 0–20/s after the Server is added, and the highest Utilisation stays at 100%. It jumps to about 58/s after the Concurrency change, with markers at both.
  - At 4×, a frame that receives a new sample costs about 2 ms more than one that does not.
- **Observation for ticket 09/11:** at Rate 45 the starter design collapses into Timed out almost entirely. A full Backlog at about 26/s gives latency above the 2 s Time limit. That is a strong demo moment worth a built-in Scenario.
