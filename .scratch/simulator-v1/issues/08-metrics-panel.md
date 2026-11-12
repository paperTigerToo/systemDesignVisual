# 08: Metrics panel

Status: open
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
