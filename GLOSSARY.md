# System Design Simulator

An interactive canvas where a user assembles an architecture from components and sends simulated traffic through it to see where it bottlenecks.

## Language

### Architecture

**Component**:
A draggable building block of an architecture: a Source, Server, Database, or Queue.
_Avoid_: Node, service, box

**Connection**:
A directed link from one component to another that requests can travel along.
_Avoid_: Edge, link, wire

**Source**:
A component that generates requests and is where each request's outcome and latency are recorded.
_Avoid_: Client, user, load generator

**Server**:
A component that works on a request and may call one downstream component while doing so.
_Avoid_: Service, web server, worker

**Database**:
A component that works on a request and calls nothing downstream.
_Avoid_: DB, store

**Queue**:
A component that accepts a request immediately, releasing the caller, and holds it until a downstream component takes it.
_Avoid_: Broker, message bus, buffer

### Traffic

**Request**:
One unit of traffic, created by a Source, that completes only when every component it synchronously depends on has responded.
_Avoid_: Message, packet, token, job

**Backlog**:
The line of requests waiting inside a component that it has not yet started working on.
_Avoid_: Queue (reserved for the Queue component), buffer, waiting line

**Outcome**:
How a request ended as recorded at its Source: Completed, Rejected, Failed, or Timed out.
_Avoid_: Status, result

**Rejected**:
The outcome of a request turned away because a component's Backlog was full.
_Avoid_: Dropped, shed

**Failed**:
The outcome of a request that was inside, or sent to, a Killed component with no live alternative.
_Avoid_: Errored, crashed

**Timed out**:
The outcome of a request not answered within its Source's time limit; components may still finish the wasted work.
_Avoid_: Expired

### Capacity

**Concurrency**:
The number of requests a component can work on at the same time.
_Avoid_: Threads, workers, slots, instances

**Work time**:
How long a component spends working on one request, excluding time in the Backlog and time waiting on a downstream call.
_Avoid_: Service time, processing rate, latency

**Rate**:
The number of requests per second a Source generates, independent of how the architecture is coping.
_Avoid_: Load, traffic level, RPS

**Killed**:
The state of a component the user has switched off: it accepts nothing and callers skip it.
_Avoid_: Down, dead, offline

**Utilisation**:
The share of a component's Concurrency currently in use, counting requests it is working on and requests it is holding while waiting on a downstream call.
_Avoid_: Load, busyness, CPU

### Runs

**Scenario**:
A saved, shareable package of an architecture, its settings, a seed, and a list of Interventions, which always produces the same Run.
_Avoid_: Preset, template, save file, demo

**Run**:
One playthrough of a Scenario from simulated time zero.
_Avoid_: Session, simulation, playback

**Intervention**:
A change made to the architecture or its settings at a specific simulated time during a Run.
_Avoid_: Edit, action, event, command
