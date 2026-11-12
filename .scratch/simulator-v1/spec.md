# Spec: System Design Simulator v1

Status: agreed

A browser app where a user assembles an architecture from Components on a canvas, sends simulated traffic through it, and changes things mid-Run to watch the consequences. It is a portfolio piece: a reviewer opens the link, sees a Scenario already running, and can break it with one click.

Headline demo: "Here is why adding more Servers did not fix the bottleneck."

**Read `GLOSSARY.md` first.** Every capitalised term in this spec and in the tickets (Component, Connection, Source, Server, Database, Queue, Request, Backlog, Outcome, Concurrency, Work time, Rate, Killed, Utilisation, Scenario, Run, Intervention) is defined there. Use those words in code, UI text, tests and commit messages. Do not use the words listed under "Avoid".

Also read `docs/adr/0001-requests-are-call-and-wait.md`.

## Standing rules for every ticket

1. **The engine is pure.** Everything under `src/engine/` is plain TypeScript with no imports from React, React Flow, Zustand or the DOM, and no use of `Math.random`, `Date.now`, `performance.now`, `setTimeout` or `requestAnimationFrame`. All randomness comes from the engine's seeded generator. All time is simulated time passed in by the caller.
2. **Determinism is never broken.** The same Scenario always produces the same Run. The determinism test added in ticket 01 must keep passing.
3. **Engine behaviour is covered by Vitest tests** written against the engine's public interface, not its internals.
4. **Each ticket ends with something visible.** Follow the ticket's "See it working" step in a real browser before calling it done.
5. **Stay in scope.** If a ticket seems to need something listed under "Out of scope" below, stop and say so instead of building it.
6. Do one ticket at a time, in dependency order (`Blocked by:` lines). Set `Status: claimed` when starting and `Status: resolved` when done.

## Stack

- Vite + React + TypeScript (strict)
- React Flow (`@xyflow/react`) for the canvas
- Zustand for UI state
- Vitest for tests
- No backend. Static build deployed to GitHub Pages.
- Desktop browsers only.

## Code shape

- `src/engine/`: the simulator. Knows nothing about the UI.
- `src/app/` (or similar): React UI, canvas, panels, playback loop.
- The UI talks to the engine only through one small interface, which must support: create an engine from a Scenario; advance simulated time to T; apply an Intervention at the current time; read a snapshot of per-Component state and metrics; read a sampled stream of Request movements for drawing dots. The exact function names are the implementer's choice in ticket 01, and later tickets extend that interface instead of going around it. Keep it narrow enough that the engine could later run in a background worker.

## The simulation model

This section is the source of truth for engine behaviour.

### Time and randomness

- Discrete-event simulation: a priority heap of future events ordered by simulated time, with ties broken by insertion order.
- Simulated time is in seconds.
- One seeded pseudo-random generator per Run. The seed is part of the Scenario.

### Request lifecycle (call-and-wait)

- A Source creates Requests at its Rate, randomly spaced (exponential gaps), regardless of how the architecture is coping.
- A Request is sent along one Connection to a Component. That Component eventually responds with an Outcome, which travels back to the caller. A Request is finished when its Source receives the response or its time limit passes.
- Latency is measured at the Source: creation to response.
- Travelling along a Connection takes zero simulated time. The dots on screen are cosmetic.

### Choosing where to send

- When a Component has several outgoing Connections they are interchangeable alternatives. Each Request uses exactly one, chosen round-robin.
- Killed Components are skipped instantly. If every alternative is Killed, the Request is Failed.

### Server and Database

- Settings: Concurrency, mean Work time, Backlog capacity.
- On arrival: if a Concurrency slot is free, start work; otherwise if the Backlog has room, wait in it (first in, first out); otherwise respond Rejected.
- Work lasts a random time, exponentially distributed around the mean Work time.
- A Database then responds Completed.
- A Server with no outgoing Connections then responds Completed. A Server with outgoing Connections, after its own work, calls one downstream Component and **keeps its Concurrency slot occupied** until that call responds. It then passes the downstream Outcome back to its caller and frees the slot.
- Utilisation = occupied slots / Concurrency.

### Queue

- Settings: capacity only. No Concurrency or Work time.
- On arrival: if below capacity, hold the Request and immediately respond Completed to the caller (the caller is released). Otherwise respond Rejected.
- A Queue must have at least one outgoing Connection. It hands its oldest held Request to a downstream Component only when that Component has a free Concurrency slot, so waiting Requests pile up in the Queue and not in the downstream Backlog.
- Work done after the Queue is asynchronous. Its results do not change the Source's Outcome or latency. The Queue tracks its own measures: depth, time Requests spend held, and how many were processed or lost downstream. Lost Requests are not redelivered.

### Source time limit

- Each Source has a time limit (default 2 seconds). When it passes with no response, the Outcome is Timed out. Components keep doing the now-wasted work and the late response is ignored.
- No retries.

### Killing, removing, changing

- Kill: every Request inside the Component (working, in its Backlog, or waiting on a downstream call) responds Failed to its caller. Work it had already called downstream carries on as wasted work. A Killed Queue loses what it holds. Reviving brings the Component back empty.
- Removing a Component is a Kill followed by deleting it and its Connections.
- Removing a Connection lets calls already in progress on it finish.
- Setting changes apply to future work only. Lowering Concurrency does not interrupt work in progress.
- Everything is changeable mid-Run. Each change is an Intervention stamped with the simulated time it happened.

### Allowed architectures

Validation errors are shown inline and disable play:

- at least one Source
- nothing connects into a Source
- a Database has no outgoing Connections
- a Queue has at least one outgoing Connection
- every Component is reachable from a Source
- no cycles
- no duplicate Connections and no Connection from a Component to itself

## Scenarios and replay

- A Scenario = architecture + settings + seed + a list of Interventions. It always produces the same Run.
- While a user plays, their Interventions are recorded. Saving or sharing captures the starting architecture plus that list.
- Opening a Scenario replays its Interventions at their recorded times. If the user changes anything during a replay, the replay stops there, the remaining recorded Interventions are discarded, and it continues as their own live Run.
- Scenarios are saved in the browser, exported and imported as JSON, and shareable as a URL that contains the whole Scenario.
- Three built in:
  1. **More servers didn't fix it** (opens by default): the Database is the limit; a recorded Intervention adds a Server and nothing improves.
  2. **Queue absorbs a burst**: slow work behind a Queue versus called directly.
  3. **One server down**: killing one of three pushes the survivors past their limit.

## Interface

- Dark, dense operations-dashboard look.
- Layout: palette of Components on the left, canvas in the centre, settings for the selected Component on the right, metrics along the bottom, playback controls and Scenario menu along the top.
- Playback: play, pause, reset, speed 0.5x / 1x / 2x / 4x. The engine runs on the main thread in time-budgeted chunks per animation frame. If it cannot keep up, the app shows that it is running behind instead of freezing.
- Each Component shows: colour by Utilisation (green, amber, red; red also whenever it is rejecting), a Backlog fill bar, and a clear Killed state.
- Requests are drawn as moving dots from a capped sample. The engine still simulates every Request.
- Metrics, as small rolling charts over about the last 30 simulated seconds:
  - per Source: completed Requests per second, median and 95th-percentile latency, Outcome breakdown
  - per Component: Utilisation and Backlog depth; per Queue: depth and time held
- A permanent "Simulated model, not a capacity prediction" marker and an assumptions panel that lists every simplification in this spec.

## Out of scope for v1

Cache and explicit load-balancer Components; a Server calling more than one downstream per Request; retries; health-check delay; network delay on Connections; scripted traffic patterns (spikes, ramps); cycles; a background worker; accounts or any backend; mobile layout; a step-by-step tutorial.

## Tickets

See `issues/`. Order and dependencies:

| # | Ticket | Blocked by |
|---|---|---|
| 01 | Thin end-to-end slice: Source to Server, dots moving | none |
| 02 | Database and call-and-wait | 01 |
| 03 | Backlog capacity, Outcomes and Component status visuals | 02 |
| 04 | Several Connections, round-robin, Kill and revive | 03 |
| 05 | Queue | 04 |
| 06 | Editor: palette, Connections, settings panel, validation | 04 |
| 07 | Interventions mid-Run and full playback controls | 05, 06 |
| 08 | Metrics panel | 07 |
| 09 | Scenarios: save, share, replay, three built in | 07 |
| 10 | Engine verification against queueing formulas | 05 |
| 11 | Assumptions panel, visual polish, canvas performance | 08, 09 |
| 12 | Deploy to GitHub Pages and README | 11 |
