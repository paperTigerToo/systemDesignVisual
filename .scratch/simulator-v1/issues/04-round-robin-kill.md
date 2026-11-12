# 04: Several Connections, round-robin, Kill and revive

Status: resolved
Type: task
Blocked by: 03

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Let a Component spread Requests across several downstream Components, and let the user Kill one.

## In scope

- Round-robin across a Component's outgoing Connections; Killed Components skipped; Failed when none are live.
- Kill and revive per the spec section "Killing, removing, changing" (Requests inside respond Failed; downstream work already called carries on as wasted; revive comes back empty).
- Hard-coded architecture becomes Source to three Servers to one Database.
- A Kill / revive button on each Server and Database node, with a clear Killed look.

## Out of scope

Recording Interventions (ticket 07), adding or removing Components from the UI (ticket 06).

## Acceptance checks

- Test: three identical live Servers each receive one third of Requests (exactly, by round-robin).
- Test: after a Kill, the Killed Server receives nothing and the other two share everything.
- Test: Requests inside a Killed Component end Failed at the Source; with every alternative Killed, new Requests are Failed.
- Test: the Outcome-accounting check from ticket 03 holds across a Kill and a revive.
- Determinism test passes with a Kill applied at a fixed simulated time.

## See it working

Kill one of three Servers mid-Run and watch the other two change colour. Kill the Database and watch everything fail; revive it and watch recovery.

## Comments

**2026-11-12, resolved.** Notes for later tickets:

- **The engine now has `applyIntervention(intervention)`**, which applies the change at the current simulated time. `Intervention` currently has only `{ kind: 'kill' | 'revive', componentId }`. Ticket 07 should add the other kinds to that type and record them for replay, not add a second entry point. Killing an already Killed Component, or reviving a live one, does nothing. Only a Server or Database can be Killed; anything else throws.
- `Outcome` now includes `failed`, and there is a `ResponseOutcome` type (every Outcome except Timed out). `SourceSnapshot.outcomes.failed` counts Requests that were inside a Killed Component, or had no live Component to go to.
- `WorkerSnapshot` gained `killed`, `received` (calls that arrived, whatever became of them) and `failed` (Requests inside it when it was Killed).
- Each Source and Server keeps its outgoing Connections as a route with a round-robin pointer; Killed targets are skipped. A Server whose downstream targets are all Killed finishes its own work and then responds Failed. A Server with no outgoing Connections still responds Completed itself.
- Kill works by cancelling calls: every call inside the Component is marked cancelled and answered Failed straight away. Later work on a cancelled call is ignored when it finishes: its own `workDone`, or a downstream response arriving for a parent call that was cancelled. That is how "work already called downstream carries on as wasted" is implemented.
- **UI pitfall.** React Flow sets `pointer-events: none` on nodes that are not draggable, selectable or connectable, which silently swallowed clicks on the Kill button. Each node now sets `style: { pointerEvents: 'all' }` in `App.tsx`. Ticket 06 makes nodes draggable, so this may no longer be needed then.
- Failed responses share the red "bad" dot with Rejected ones.
- Default architecture: Source (Rate 18) to three Servers (Concurrency 2, Work time 0.2 s, Backlog 20) to a Database (Concurrency 8, Work time 0.05 s, Backlog 40). Checked in the browser: all three are Healthy or Busy. After killing Web server 2, the other two turned Overloaded within a few seconds, with Backlogs at 13/20 and 20/20 and Rejections and time-outs following. Killing the Database turned every response red; reviving it brought recovery.
