# 02: Database and call-and-wait

Status: resolved
Type: task
Blocked by: 01

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Make Requests call-and-wait: a Server calls a Database and keeps its Concurrency slot occupied until the Database responds. This is the mechanism behind the headline demo.

## In scope

- Database Component in the engine (Concurrency, Work time, unlimited Backlog for now).
- Server: after its own work, if it has an outgoing Connection, call the downstream Component and hold the slot until the response; then respond to its caller.
- Responses travel back to the Source; the Source records latency (creation to response).
- Hard-coded architecture becomes Source to Server to Database.
- Dots for the outbound call and, in a visually distinct way, for the response.
- Readout on each Component: occupied slots out of Concurrency, and Backlog depth. Readout on the Source: average latency.

## Out of scope

Backlog limits, Rejected / Failed / Timed out, several Connections, editing.

## Acceptance checks

- Test: with a fast Server and a slow Database whose capacity is below the Rate, the **Server's** occupied slots reach its Concurrency and its Backlog grows, even though its own Work time is tiny.
- Test: latency of a Request through an idle Server and Database is the sum of the two sampled Work times.
- Test: a Server with no outgoing Connection still behaves as in ticket 01.
- Determinism test still passes.

## See it working

Run the app with the slow-Database numbers: the Server shows all slots occupied while the Database is the real limit.

## Comments

**2026-11-12, resolved.** Notes for later tickets:

- Each hop of a Request is an internal `Call { request, caller, parent }`; responses unwind through `parent` back to the Source. Rejected / Failed / Timed out (tickets 03 and 04) should travel the same path.
- Server and Database share one internal "worker" state and one snapshot shape, `WorkerSnapshot`: `occupied` (all slots in use, including those waiting on a call), `waitingOnCall`, `concurrency`, `backlog`, `completed`. The ticket 01 field `inProgress` was renamed to `occupied` to match Utilisation in the glossary.
- `SourceSnapshot` gained `averageLatency` (seconds, null before the first response).
- `Movement.direction` is now `'call' | 'response'`. On the canvas, calls ride above the line in blue and responses below it in green.
- A Server still uses only its first outgoing Connection; round-robin is ticket 04. A Database ignores outgoing Connections; validation (ticket 06) will forbid them.
- Default architecture is Source (Rate 8) to Server (4, 20 ms) to Database (2, 200 ms). Average latency is about 0.6 s, which matches the M/M/2 formula for the Database at 80% load (about 0.58 s).
- Checked in the browser at Rate 20: Server 4/4 slots, 3 waiting on the call, Backlog 87; Database 2/2, Backlog 1.
