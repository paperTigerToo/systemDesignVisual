# 02: Database and call-and-wait

Status: open
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
