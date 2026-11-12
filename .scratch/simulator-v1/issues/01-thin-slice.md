# 01: Thin end-to-end slice: Source to Server, dots moving

Status: resolved
Type: task
Blocked by: none

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Prove the whole pipeline with the smallest possible architecture: one Source sending Requests to one Server, hard-coded, running in the browser with dots moving along the Connection.

## In scope

- Run `git init`; scaffold Vite + React + TypeScript (strict), `@xyflow/react`, Zustand, Vitest. Add a sensible `.gitignore`.
- `src/engine/`: event heap, seeded random generator, simulated clock, Source (Rate, exponential gaps), Server (Concurrency, exponential Work time, **unlimited Backlog for now**, no downstream call yet).
- The UI-to-engine interface described under "Code shape" in the spec. Design it now; later tickets extend it.
- A React Flow canvas showing the hard-coded Source and Server (not editable yet), with play and pause.
- A playback loop that advances the engine from animation frames at 1x speed.
- Dots moving along the Connection, drawn from the engine's sampled Request movements.
- A plain text readout on the Server: Requests in progress and Backlog depth.

## Out of scope

Database, Outcomes other than Completed, Backlog limits, Kill, editing the canvas, metrics charts, styling beyond legible.

## Acceptance checks

- Determinism test: two engines built from the same Scenario and advanced to the same time produce identical snapshots; a different seed produces a different one.
- Test: with Rate well below the Server's capacity (Concurrency / Work time), Backlog stays near zero; with Rate above it, Backlog grows steadily.
- A lint or test check that fails if anything under `src/engine/` imports React, React Flow, Zustand, or uses `Math.random` / `Date.now`.
- `npm run build` and `npm test` pass.

## See it working

`npm run dev`, press play: dots travel from Source to Server and the readout changes. Temporarily raise the hard-coded Rate above capacity and watch Backlog depth climb.

## Comments

**2026-11-12, resolved.** Notes for later tickets:

- Engine interface (`src/engine/engine.ts`): `createEngine(scenario, { movementCap })` returns `{ time, advanceTo(t), snapshot(), takeMovements() }`. Ticket 07 adds `applyIntervention`; ticket 09 adds Interventions to `Scenario`.
- `Scenario` is `{ seed, architecture: { components, connections } }`. Canvas positions live in the app (`src/app/defaultScenario.ts`), not in the engine's Scenario; ticket 09 decides how the saved format carries them.
- Movements have `direction: 'call'` only; ticket 02 adds `'response'`.
- The Server's Backlog is unlimited; ticket 03 adds capacity.
- The engine-purity check is `tests/engine-purity.test.ts`.
- The playback loop caps each frame at 0.1 s of simulated time and has no time budget yet (ticket 07).
- Checked in the browser: dots move Source to Server at Rate 8; at Rate 20 the Backlog grew about 10 per second (45 to 90 over about 4.5 s).
