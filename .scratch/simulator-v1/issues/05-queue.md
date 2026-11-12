# 05: Queue

Status: resolved
Type: task
Blocked by: 04

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Add the Queue Component: it releases its caller immediately and hands work downstream only when there is a free slot.

## In scope

- Queue in the engine exactly as in the spec section "Queue" (capacity; immediate Completed to caller; Rejected when full; hands oldest held Request to a downstream Component with a free Concurrency slot; round-robin among those with a free slot; skips Killed; a Killed Queue loses what it holds; no redelivery).
- Queue measures in the snapshot: depth, average time held, processed count, lost count.
- Queue node: fill bar for depth against capacity, and those numbers.
- A second hard-coded architecture, switchable by a temporary toggle: Source to Server to Queue to Server (slow worker).

## Out of scope

Editing the canvas, charts.

## Acceptance checks

- Test: a Source's latency through Server to Queue does not include the worker's Work time.
- Test: with a slow worker, depth grows in the Queue while the worker's own Backlog stays empty.
- Test: a full Queue responds Rejected to its caller.
- Test: a Killed worker receives nothing and the Queue holds; on revive the Queue drains in arrival order.
- Determinism test still passes.

## See it working

Toggle to the Queue architecture: the Source stays fast and green while the Queue visibly fills, then drains when you lower the Rate in code or raise the worker's Concurrency.

## Comments

**2026-11-12, resolved.** Notes for later tickets:

- New `QueueSpec { kind: 'queue', id, capacity }` and `QueueSnapshot`: `killed`, `received`, `depth`, `capacity`, `rejected`, `lastRejectedAt`, `dispatched`, `averageTimeHeld`, `processed`, `lost` (downstream answered Rejected or Failed; no redelivery) and `failed` (held when the Queue was Killed).
- Calls a Queue dispatches start a fresh chain with `caller = queueId` and no `parent`; their response increments `processed` or `lost`. The Request is already finished at the Source (Completed when the Queue accepted it), so later work cannot change its Outcome or latency.
- Dispatch is pull-based: the engine keeps, for each Server and Database, the Queues that feed it. After any slot is released, and on revive, each feeding Queue is pumped while the worker still has a free slot. A worker takes from its own Backlog before a Queue gets the free slot.
- **Queue targets must be Servers or Databases.** A Queue to Queue Connection would never be dispatched to, because `hasFreeSlot` is false for Queues. Ticket 06 validation should forbid a Queue whose outgoing Connections lead to anything other than a Server or Database. (The spec only says a Queue needs at least one outgoing Connection.)
- `Intervention` kill and revive now accept a Queue.
- `src/app/defaultScenario.ts` was renamed to `src/app/demoArchitectures.ts`. It now exports a list of hard-coded architectures, picked with a temporary "Architecture" select in the toolbar (`architectureIndex` and `loadArchitecture` in the store). Tickets 06 and 09 replace it.
- The UI smoothing of Utilisation now applies only to Servers and Databases. A Queue's status comes from how full it is: Busy at 50% or more; Overloaded at 90% or more, or after a Rejection in the last second.
- Checked in the browser, "Queue in front of slow work" (Rate 10, Worker about 6.7 per second): Source latency stayed at about 20 ms while the Queue filled (35/200 at t = 13 s) and the Worker ran at 100% with an empty Backlog. Killing the Worker: the Queue held (130/200) and lost only the 2 Requests in flight. With the Rate temporarily at 5: after a pile built up while the Worker was Killed, reviving it drained the Queue 39 to 14 to 0.
