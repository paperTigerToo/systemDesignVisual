# 04: Several Connections, round-robin, Kill and revive

Status: open
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
