# 09: Scenarios: save, share, replay, three built in

Status: resolved
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

### Resolution notes (ticket 09)

- **Format** (`src/app/scenario.ts`): `ScenarioDocument` holds:
  - `format`, `version: 1` and `name`
  - `seed` and the starting `architecture`
  - `layout`, the position and name of every Component in the Run, including any a recorded Intervention adds
  - `interventions`, as `TimedIntervention[]`
- **Parsing:** `parseScenario` checks structure and limits and returns a readable error.
  - It checks that every setting is within the same limits the settings panel enforces.
  - It also checks: unique ids, Connections naming real Components, Intervention times that never go backwards, and a position for every Component.
  - Architecture problems (an unconnected Server, say) are allowed, as in the editor. An Intervention that turns out not to apply stops the replay with a notice.
- **Share links:** the JSON is compressed with `CompressionStream('deflate-raw')` (built into the browser, no dependency) and base64url-encoded into `#scenario=…`. The default Scenario plus one change comes to about 570 characters.
  - A bad link shows an error notice, clears the fragment, and leaves the default Scenario running.
- **Browser storage** (`scenarioStorage.ts`): every read and write is in try/catch; unreadable entries are skipped. Saving uses the Scenario's name, and the same name replaces the earlier save.
- **Replay** (store): `script` is the Scenario as opened and `pending` is what is still to replay.
  - `tick` applies each pending Intervention at exactly its recorded time (`engine.advanceTo(time)` then apply), and updates the Design with `applyInterventionToDesign`.
  - Any user Intervention clears `pending`. So does changing the starting architecture before the Run starts.
  - Reset replays the Scenario as opened; Reset after going live therefore discards the user's own changes.
  - `setSeed` restarts with the same recording and keeps playing if it was.
  - `currentScenario()` is the starting architecture plus replayed, user and still-pending Interventions.
- **Status in the toolbar:** "Replaying · N recorded changes to come", or "Live · N changes recorded". Once a replay finishes the Run counts as live.
- **Built-in Scenarios** (`builtInScenarios.ts`), tuned with the engine for 15 s at 1×. The tests check each claim in numbers.
  1. Database at 4 slots × 0.1 s (40/s) against a Rate of 60. Web server 2 is added at 8 s; completed per second stays at about 40–45, and the Database stays at 100%.
     - The first tuning used Backlogs of 50. The extra Server then pushed latency past the 2 s Time limit and completed per second fell to 0. That was dramatic but read like a bug, so the Backlogs became 20.
  2. Two lanes of 12/s; both Sources burst from 4 to 30/s between 3 s and 6 s. The direct lane Rejects about 30; the Queue lane Rejects none, peaks at about 60 deep, and drains by about 14 s.
  3. Three Web servers of 8 slots × 0.3 s (27/s each) against a Rate of 66 (about 83% busy). Web server 2 is Killed at 6 s; the survivors sit at 100% and start Rejecting within a second.
- The old `demoArchitectures.ts` and its Load select are replaced by the Scenario menu. It also has the Empty canvas, saved Scenarios, Save, Copy share link, Export and Import. The seed control and its random button sit next to it.
- **Checked in the browser:**
  - A fresh load opens the first Scenario, playing and replaying.
  - Saving shows in the menu.
  - A share link made after a live change, opened in a second tab, gave identical metric samples (30 of them) and Interventions.
  - A damaged link falls back with a message.
  - Clipboard writing is refused in the hidden test pane, so the fallback (link in the address bar) ran. A visible browser tab should copy normally, but that path was not exercised.
