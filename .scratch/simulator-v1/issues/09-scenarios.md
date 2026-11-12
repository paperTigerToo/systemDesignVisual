# 09: Scenarios: save, share, replay, three built in

Status: open
Type: task
Blocked by: 07

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Make Runs shareable and reproducible, and ship the three built-in Scenarios.

## In scope

- A versioned Scenario format: starting architecture (Components with positions and settings, Connections), seed, list of Interventions.
- Save to and load from browser storage; export and import as a JSON file; share as a URL containing the whole Scenario (compressed). Guard every storage read and write so the app works without it.
- Imported or URL Scenarios are validated before use; a bad one shows a clear message and falls back to the default.
- Replay: opening a Scenario applies its Interventions at their recorded times. Any user change during replay stops the replay, discards the remaining recorded Interventions, and continues as a live Run. Show clearly whether the app is replaying or live.
- A Scenario menu along the top with the three built-in Scenarios from the spec. The first opens by default and starts playing on load. Tune their numbers so each story is obvious within about 15 seconds at 1x.
- A control to change the seed.

## Out of scope

Accounts, a gallery, undo/redo.

## Acceptance checks

- Test: Scenario to JSON and back is lossless; Scenario to URL and back is lossless.
- Test: replaying a saved Scenario reproduces the original Run's snapshots and metric series exactly.
- Test: an Intervention made during replay truncates the remaining recorded list.
- Test: each built-in Scenario passes validation and demonstrates its claim in numbers (for the first: completed-per-second does not rise after the recorded "add Server" Intervention).

## See it working

Open the app fresh: the first Scenario is already running and tells its story unaided. Make a change, copy the share link, open it in a private window, and watch the identical Run.

## Comments
