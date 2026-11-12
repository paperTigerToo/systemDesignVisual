# 03: Backlog capacity, Outcomes and Component status visuals

Status: open
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
