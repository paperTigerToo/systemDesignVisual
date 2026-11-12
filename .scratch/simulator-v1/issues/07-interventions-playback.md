# 07: Interventions mid-Run and full playback controls

Status: open
Type: task
Blocked by: 05, 06

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Everything is changeable while the Run is playing, and every change is a recorded Intervention. Add reset and speed.

## In scope

- An Intervention type covering: change a setting, Kill, revive, add Component, remove Component, add Connection, remove Connection. Each stamped with simulated time.
- The engine applies Interventions at the current simulated time, following the spec section "Killing, removing, changing".
- All editor actions from ticket 06 now work during a Run and go through Interventions. They no longer reset the Run.
- Validation still applies: an edit that would make the architecture invalid mid-Run is refused with a visible reason.
- The Run keeps an ordered list of the Interventions applied so far.
- Playback controls along the top: play, pause, reset (back to time zero and the starting architecture), speed 0.5x / 1x / 2x / 4x, simulated clock.
- Time-budgeted advancing per animation frame, with a visible "running behind" indicator when the engine cannot keep up.

## Out of scope

Saving or replaying the Intervention list (ticket 09).

## Acceptance checks

- Test: a Run driven by a list of Interventions at fixed times is identical on every execution, and identical to applying the same Interventions one by one at those times.
- Test: adding a Server mid-Run brings it into the round-robin; removing a Component Fails the Requests inside it and the Outcome accounting still balances.
- Test: lowering Concurrency mid-Run does not interrupt work in progress.
- In the browser: at 4x with a high Rate the page stays responsive.

## See it working

Run Source to two Servers to a slow Database. While it is red, drag in a third Server and connect it: nothing improves. Then raise the Database's Concurrency: it recovers.

## Comments
