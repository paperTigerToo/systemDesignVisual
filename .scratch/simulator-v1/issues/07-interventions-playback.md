# 07: Interventions mid-Run and full playback controls

Status: resolved
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

**2026-11-12, resolved.** Notes for later tickets:

- **`Intervention`** (in `src/engine/types.ts`) now has every kind: `kill`, `revive`, `setSetting { componentId, key: SettingKey, value }`, `addComponent { component }`, `removeComponent`, `addConnection` and `removeConnection`. `TimedIntervention` is `{ time, intervention }`.
- **`playTimeline(engine, timeline)`** (`src/engine/timeline.ts`) returns a player whose `advanceTo(t)` applies each Intervention at its recorded time while advancing, and reports `remaining`. Ticket 09 replay should use it.
- Engine behaviour for live changes:
  - Specs are copied on creation, so changes never leak back to the caller's objects.
  - A removed Component keeps its internal state (marked removed) so late responses land harmlessly; it leaves the snapshot. **Its id can never be reused in the same Run** (`addComponent` throws). The store passes `knownIds` to `design.addComponent` so the editor never hands out a retired id.
  - Changing a Source's Rate draws a fresh gap from now, through a generation counter on generate events. Inter-arrival times are memoryless, so this is statistically sound, and it makes a big Rate change take effect at once.
  - Raising Concurrency fills the new slots from the Backlog straight away; lowering it interrupts nothing.
  - Adding a Queue → worker Connection pumps the Queue at once.
  - Removing a Connection fixes up the round-robin pointer; calls already on it finish.
  - A Database ignores any outgoing route even if one exists.
- **Validation severity:** `isHazard(problem)`. "Incomplete" problems (no Source, unconnected Source, Queue with no outgoing Connection, unreachable Component) are allowed mid-Run, because an unconnected Component just sits idle. That is what lets you add a Server and then connect it while traffic flows. Every other problem is a hazard: a mid-Run edit that would cause one is refused, with the reason shown in a dismissible banner ("Not applied: …").
- **Store:**
  - `hasStarted` is true once the clock passes 0 or an Intervention is recorded. Before that, edits rebuild the engine (and set `startDesign`); after it, edits become recorded Interventions.
  - `playBlocked`: any problem blocks Play before the Run starts, but only a hazard blocks it afterwards.
  - `reset()` returns to `startDesign` while keeping current positions and names; moves and renames also update `startDesign`'s layout.
  - Kill and revive are recorded too.
  - During a Run, number settings apply on Enter or blur rather than on every keystroke, to avoid recording "1" then "12".
- **Playback:** speed 0.5×, 1×, 2× and 4×. Each frame advances in 0.02 s simulated chunks within a 10 ms budget; if the budget runs out, the Run falls behind the clock and the toolbar shows "Running behind". Frames are still capped at 0.1 s of real time, so a background tab does not jump ahead.
- Checked in the browser (1400×850), with the "Three Servers" example cut to two Web servers and a Database at Concurrency 2 and 200 ms:
  - Both Web servers went Overloaded and the Database Busy.
  - Mid-Run, I added a Server from the palette and connected Source → it → Database (3 changes recorded, no reset). Afterwards the Database completed 133 Requests in 14 s, about 9.5 per second against its limit of 10: nothing improved, and all three Servers turned Overloaded.
  - Dragging Database → Web server 1 was refused: "Not applied: A Database does its work itself; it cannot call other Components."
  - Raising the Database's Concurrency to 8 live took it to about 19 completions per second and Healthy; the Source's completions rose from 74 to 166.
  - Reset returned to t = 0 and the two-Server starting architecture with positions kept.
  - At 4× with a Rate of 500 per second, frame work stayed under 0.5 ms and there were no long tasks (72 fps measured with the pane visible).
- One unexplained moment during that check: a Pause click right after pressing Enter in a number field did not appear to register. I could not reproduce it afterwards, and play, pause and reset behaved correctly on repeated tries. Worth watching in ticket 11's polish pass.
