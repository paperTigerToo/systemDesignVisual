# 05: Queue

Status: open
Type: task
Blocked by: 04

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Add the Queue Component: it releases its caller immediately and hands work downstream only when there is a free slot.

## In scope

- Queue in the engine exactly as in the spec section "Queue" (capacity; immediate Completed to caller; Rejected when full; hands oldest held Request to a downstream Component with a free Concurrency slot; round-robin among those with a free slot; skips Killed; a Killed Queue loses what it holds; no redelivery).
- Queue measures in the snapshot: depth, average time held, processed count, lost count.
- Queue node: fill bar for depth against capacity, and those numbers.
- A second hard-coded architecture, switchable by a temporary toggle: Source to Server to Queue to Server (slow worker).

## Out of scope

Editing the canvas, charts.

## Acceptance checks

- Test: a Source's latency through Server to Queue does not include the worker's Work time.
- Test: with a slow worker, depth grows in the Queue while the worker's own Backlog stays empty.
- Test: a full Queue responds Rejected to its caller.
- Test: a Killed worker receives nothing and the Queue holds; on revive the Queue drains in arrival order.
- Determinism test still passes.

## See it working

Toggle to the Queue architecture: the Source stays fast and green while the Queue visibly fills, then drains when you lower the Rate in code or raise the worker's Concurrency.

## Comments
