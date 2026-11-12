# 03: Backlog capacity, Outcomes and Component status visuals

Status: resolved
Type: task
Blocked by: 02

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Make overload visible and finite: bounded Backlogs, Rejected and Timed out Outcomes, and Components that change colour.

## In scope

- Backlog capacity setting on Server and Database; a Request arriving with no free slot and a full Backlog responds Rejected, which propagates back to the Source.
- Source time limit (default 2 seconds): Outcome Timed out; the late response is ignored; Components keep doing the wasted work.
- Source counts Outcomes by kind.
- Utilisation in the snapshot (occupied slots / Concurrency).
- Custom React Flow node for Components: colour by Utilisation (green, amber, red; red also while it has rejected recently), a Backlog fill bar, name and key numbers.
- Source node shows running Outcome counts.

## Out of scope

Failed Outcome and Kill (ticket 04), charts (ticket 08), final visual design (ticket 11).

## Acceptance checks

- Test: Backlog never exceeds its capacity; overflow Requests are Rejected and counted at the Source.
- Test: a Rejected response from the Database reaches the Source as Rejected and frees the Server's slot.
- Test: a Request slower than the time limit is Timed out exactly once, and its Server and Database still complete the work.
- Test: every Request created ends with exactly one Outcome (created = sum of Outcomes + still in progress).
- Determinism test still passes.

## See it working

Overloaded numbers: the Database turns red, its bar fills, then the Server turns red, and the Source's Rejected and Timed out counts rise.

## Comments

**2026-11-12, resolved.** Notes for later tickets:

- Specs: `SourceSpec.timeLimit` (seconds; `Infinity` means none) and `backlogCapacity` on Server and Database are now required fields.
- `SourceSnapshot` is now `{ created, inProgress, outcomes: { completed, rejected, timedOut }, averageLatency }`. `averageLatency` counts Completed Requests only. Ticket 04 adds `failed` to `Outcome` and to `outcomes`.
- `WorkerSnapshot` gained `utilisation` (right now), `occupiedTime` (total slot-seconds since the Run began), `backlogCapacity`, `rejected` and `lastRejectedAt`.
- Response movements carry `outcome: 'completed' | 'rejected'`; Rejected responses are drawn as red dots.
- A Server passes a downstream Outcome back up unchanged. Its `completed` counts only Completed responses, including late ones whose Request had already Timed out at the Source (wasted work).
- **Status colours use smoothed Utilisation, not the instantaneous value.** The instantaneous value made a Component at 80% load flicker between Healthy and Overloaded every few frames. The store (`recentUtilisation` in `src/app/simulationStore.ts`) derives a roughly 1-second exponential average from `occupiedTime`. Thresholds: Busy at 70% or more; Overloaded at 95% or more, or after any Rejection in the last simulated second. Ticket 08 can reuse `occupiedTime` for its Utilisation chart.
- **Correction to this ticket's "See it working" text.** It said the Database's bar fills first. Under call-and-wait that cannot happen when the Server's Concurrency is small: the Server can have at most its Concurrency in calls outstanding, so the Database's Backlog stays tiny and the pile-up, and the Rejections, happen in the **Server's** Backlog. Checked in the browser at Rate 20: both Components show Overloaded; Server 4/4 slots, Backlog 40/40, 67 Rejected; Database 2/2, Backlog 2/20. The Source showed 13 Completed, 67 Rejected and 83 Timed out at t = 8 s. This is the headline lesson, so it is worth keeping.
