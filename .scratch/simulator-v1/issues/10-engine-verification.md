# 10: Engine verification against queueing formulas

Status: resolved
Type: task
Blocked by: 05

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Show the engine is correct, not just self-consistent, by comparing simple architectures with textbook queueing results.

## In scope

- Tests that run long simulated Runs (fixed seeds) and compare with closed-form results within a stated tolerance:
  - one Server, Concurrency 1, very large Backlog capacity: Utilisation and average time in Backlog against the single-server formulas (M/M/1);
  - one Server, Concurrency above 1: probability of waiting against the multi-server formula (Erlang C);
  - one Server with a small Backlog capacity: share of Requests Rejected against the finite-capacity formula (M/M/c/K).
- A short `docs/engine-verification.md` stating what was compared, the tolerances, and the results.
- Fix any engine defects these tests expose.

## Out of scope

New engine features. Verifying multi-Component architectures analytically.

## Acceptance checks

- The three comparisons pass across at least three different seeds each.
- The test run stays fast enough to keep in the normal `npm test` (a few seconds).

## See it working

`npm test` shows the verification tests passing; the document reads as evidence a reviewer can check.

## Comments

### Resolution notes (ticket 10)

- **Tests** in `tests/verification.test.ts`, formulas in `tests/queueing.ts`, evidence and results table in `docs/engine-verification.md`.
- **Three comparisons**, each on seeds 1, 2 and 3:
  - **M/M/1:** Utilisation, time in system, and time in Backlog.
  - **Erlang C:** probability of waiting, plus mean time in Backlog and Utilisation.
  - **M/M/c/K:** share Rejected and Utilisation when overloaded, and share Rejected when lightly loaded.
- **Measured only through `snapshot()`:**
  - Time in Backlog is latency minus the mean Work time. That is exact here, because a Server with nothing downstream holds its slot only for its own work.
  - The probability of waiting is the share of time all slots are busy, sampled every 0.05 s. Poisson arrivals see time averages, so this equals the share of arrivals that wait.
  - Every measure discards a 200 s warm-up.
- **Largest gap from a formula:** Erlang C time in Backlog on seed 2, 0.0536 s against 0.0509 s (5%), within a 10% tolerance. Everything else is within about 3%.
- **Defects found:** none. The engine passed on the first run, so no engine code changed.
- **Speed:** the full `npm test` (120 tests) takes about 2.2 s.
