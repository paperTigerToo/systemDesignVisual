# 10: Engine verification against queueing formulas

Status: open
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
