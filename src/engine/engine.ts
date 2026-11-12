import { EventHeap } from './eventHeap'
import { createRandom, type Random } from './random'
import type {
  ComponentId,
  ComponentSnapshot,
  DatabaseSpec,
  Intervention,
  Movement,
  Outcome,
  QueueSpec,
  ResponseOutcome,
  Scenario,
  ServerSpec,
  Snapshot,
  SourceSpec,
} from './types'

/**
 * The only way the UI talks to the simulator. Kept narrow so the engine could
 * later run in a background worker.
 */
export interface Engine {
  /** Current simulated time in seconds. */
  readonly time: number
  /** Process every event up to and including simulated time `t`. */
  advanceTo(t: number): void
  /** Apply a change at the current simulated time. */
  applyIntervention(intervention: Intervention): void
  /** Per-Component state at the current simulated time. */
  snapshot(): Snapshot
  /**
   * Request movements since the previous call, oldest first. Capped: when the
   * caller falls behind, extra movements are not recorded (the engine still
   * simulates every Request).
   */
  takeMovements(): Movement[]
}

export interface EngineOptions {
  /** Most movements held between calls to `takeMovements`. */
  movementCap?: number
}

interface Request {
  id: number
  sourceId: ComponentId
  createdAt: number
  /** True once the Source has recorded an Outcome; later responses are ignored. */
  finished: boolean
}

/**
 * One hop of a Request: `caller` sent it to some Component and is waiting for
 * the response. `parent` is the call that the caller itself is working on,
 * so responses can unwind back to the Source; a Queue starts a fresh chain
 * with no parent.
 */
interface Call {
  request: Request
  caller: ComponentId
  parent: Call | undefined
  /**
   * Set when the Component holding this call is Killed: the call has already
   * been answered with Failed, so any later work on it is wasted and ignored.
   */
  cancelled: boolean
}

/** A Component's outgoing Connections, used round-robin. */
interface Route {
  targets: ComponentId[]
  next: number
}

interface SourceState {
  spec: SourceSpec
  route: Route
  created: number
  outcomes: Record<Outcome, number>
  /** Sum of latencies of Completed Requests. */
  latencySum: number
}

/** A Server or Database. */
interface WorkerState {
  spec: ServerSpec | DatabaseSpec
  /** Where this Component may call after its own work; always empty for a Database. */
  route: Route
  killed: boolean
  /** Calls being worked on or held waiting on a downstream call, in arrival order. */
  active: Set<Call>
  occupied: number
  /** Slot-seconds occupied up to `occupiedSince`. */
  occupiedTime: number
  occupiedSince: number
  waitingOnCall: number
  backlog: Call[]
  backlogHead: number
  received: number
  completed: number
  rejected: number
  lastRejectedAt: number | null
  failed: number
}

interface Held {
  request: Request
  heldSince: number
}

interface QueueState {
  spec: QueueSpec
  /** Downstream Servers and Databases it hands Requests to. */
  route: Route
  killed: boolean
  held: Held[]
  heldHead: number
  received: number
  rejected: number
  lastRejectedAt: number | null
  dispatched: number
  timeHeldSum: number
  processed: number
  lost: number
  failed: number
}

type Event =
  | { kind: 'generate'; sourceId: ComponentId }
  | { kind: 'workDone'; workerId: ComponentId; call: Call }
  | { kind: 'timeLimit'; request: Request }

/** A first-in, first-out list stored as an array plus a head index, compacted occasionally. */
function queueLength<T>(items: T[], head: number): number {
  return items.length - head
}

export function createEngine(scenario: Scenario, options: EngineOptions = {}): Engine {
  const movementCap = options.movementCap ?? 1000
  const random: Random = createRandom(scenario.seed)
  const heap = new EventHeap<Event>()
  const sources = new Map<ComponentId, SourceState>()
  const workers = new Map<ComponentId, WorkerState>()
  const queues = new Map<ComponentId, QueueState>()
  /** For each Server or Database, the Queues that hand it Requests, in declaration order. */
  const feeders = new Map<ComponentId, QueueState[]>()
  const order: ComponentId[] = []
  let movements: Movement[] = []
  let now = 0
  let nextRequestId = 1

  const routeFrom = (id: ComponentId): Route => ({
    targets: scenario.architecture.connections.filter((c) => c.from === id).map((c) => c.to),
    next: 0,
  })

  for (const spec of scenario.architecture.components) {
    order.push(spec.id)
    switch (spec.kind) {
      case 'source':
        sources.set(spec.id, {
          spec,
          route: routeFrom(spec.id),
          created: 0,
          outcomes: { completed: 0, rejected: 0, failed: 0, timedOut: 0 },
          latencySum: 0,
        })
        break
      case 'queue':
        queues.set(spec.id, {
          spec,
          route: routeFrom(spec.id),
          killed: false,
          held: [],
          heldHead: 0,
          received: 0,
          rejected: 0,
          lastRejectedAt: null,
          dispatched: 0,
          timeHeldSum: 0,
          processed: 0,
          lost: 0,
          failed: 0,
        })
        break
      default:
        workers.set(spec.id, {
          spec,
          route: spec.kind === 'server' ? routeFrom(spec.id) : { targets: [], next: 0 },
          killed: false,
          active: new Set(),
          occupied: 0,
          occupiedTime: 0,
          occupiedSince: 0,
          waitingOnCall: 0,
          backlog: [],
          backlogHead: 0,
          received: 0,
          completed: 0,
          rejected: 0,
          lastRejectedAt: null,
          failed: 0,
        })
    }
  }

  for (const queue of queues.values()) {
    for (const target of queue.route.targets) {
      if (!workers.has(target)) continue
      const list = feeders.get(target) ?? []
      list.push(queue)
      feeders.set(target, list)
    }
  }

  // Schedule each Source's first Request in declaration order.
  for (const id of order) {
    const source = sources.get(id)
    if (source) scheduleNextRequest(source)
  }

  function scheduleNextRequest(source: SourceState): void {
    if (source.spec.rate <= 0) return
    heap.push(now + random.exponential(1 / source.spec.rate), { kind: 'generate', sourceId: source.spec.id })
  }

  function recordMovement(movement: Movement): void {
    if (movements.length < movementCap) movements.push(movement)
  }

  /** A Server, Database or Queue that is not Killed. */
  function isLive(id: ComponentId): boolean {
    const component = workers.get(id) ?? queues.get(id)
    return component !== undefined && !component.killed
  }

  /** A live Server or Database with a free Concurrency slot. */
  function hasFreeSlot(id: ComponentId): boolean {
    const worker = workers.get(id)
    return worker !== undefined && !worker.killed && worker.occupied < worker.spec.concurrency
  }

  /** The next target round-robin that passes `accepts`; undefined when none does. */
  function chooseTarget(route: Route, accepts: (id: ComponentId) => boolean): ComponentId | undefined {
    const count = route.targets.length
    for (let i = 0; i < count; i++) {
      const index = (route.next + i) % count
      const target = route.targets[index]!
      if (accepts(target)) {
        route.next = (index + 1) % count
        return target
      }
    }
    return undefined
  }

  function takeFromBacklog(worker: WorkerState): Call | undefined {
    if (queueLength(worker.backlog, worker.backlogHead) === 0) return undefined
    const call = worker.backlog[worker.backlogHead]!
    worker.backlogHead++
    if (worker.backlogHead > 1024 && worker.backlogHead * 2 > worker.backlog.length) {
      worker.backlog = worker.backlog.slice(worker.backlogHead)
      worker.backlogHead = 0
    }
    return call
  }

  function takeHeld(queue: QueueState): Held | undefined {
    if (queueLength(queue.held, queue.heldHead) === 0) return undefined
    const held = queue.held[queue.heldHead]!
    queue.heldHead++
    if (queue.heldHead > 1024 && queue.heldHead * 2 > queue.held.length) {
      queue.held = queue.held.slice(queue.heldHead)
      queue.heldHead = 0
    }
    return held
  }

  /** Bring the occupied slot-seconds up to now; call before every change to `occupied`. */
  function accrueOccupiedTime(worker: WorkerState): void {
    worker.occupiedTime += worker.occupied * (now - worker.occupiedSince)
    worker.occupiedSince = now
  }

  function startWork(worker: WorkerState, call: Call): void {
    accrueOccupiedTime(worker)
    worker.occupied++
    worker.active.add(call)
    heap.push(now + random.exponential(worker.spec.workTime), { kind: 'workDone', workerId: worker.spec.id, call })
  }

  /** Free the slot `call` held, start the next Request in the Backlog, and let any Queue use a slot still free. */
  function releaseSlot(worker: WorkerState, call: Call): void {
    accrueOccupiedTime(worker)
    worker.occupied--
    worker.active.delete(call)
    const next = takeFromBacklog(worker)
    if (next) startWork(worker, next)
    pumpFeeders(worker)
  }

  /** Hand held Requests downstream while some target has a free slot, oldest first. */
  function pump(queue: QueueState): void {
    if (queue.killed) return
    for (;;) {
      if (queueLength(queue.held, queue.heldHead) === 0) return
      const target = chooseTarget(queue.route, hasFreeSlot)
      if (target === undefined) return
      const held = takeHeld(queue)!
      queue.dispatched++
      queue.timeHeldSum += now - held.heldSince
      sendCall(queue.spec.id, target, held.request, undefined)
    }
  }

  function pumpFeeders(worker: WorkerState): void {
    for (const queue of feeders.get(worker.spec.id) ?? []) {
      if (!hasFreeSlot(worker.spec.id)) return
      pump(queue)
    }
  }

  /** Send `request` from `caller` to `target`. */
  function sendCall(caller: ComponentId, target: ComponentId, request: Request, parent: Call | undefined): void {
    recordMovement({ direction: 'call', requestId: request.id, from: caller, to: target, time: now })
    const call: Call = { request, caller, parent, cancelled: false }

    const queue = queues.get(target)
    if (queue) {
      queue.received++
      if (queueLength(queue.held, queue.heldHead) < queue.spec.capacity) {
        // Accept and release the caller at once; the work happens later, asynchronously.
        queue.held.push({ request, heldSince: now })
        respond(queue.spec.id, call, 'completed')
        pump(queue)
      } else {
        queue.rejected++
        queue.lastRejectedAt = now
        respond(queue.spec.id, call, 'rejected')
      }
      return
    }

    const worker = workers.get(target)!
    worker.received++
    if (worker.occupied < worker.spec.concurrency) {
      startWork(worker, call)
    } else if (queueLength(worker.backlog, worker.backlogHead) < worker.spec.backlogCapacity) {
      worker.backlog.push(call)
    } else {
      worker.rejected++
      worker.lastRejectedAt = now
      respond(worker.spec.id, call, 'rejected')
    }
  }

  /** Record an Outcome at the Source, unless the Request already has one (it Timed out). */
  function finishAtSource(request: Request, outcome: Outcome): void {
    if (request.finished) return
    request.finished = true
    const source = sources.get(request.sourceId)!
    source.outcomes[outcome]++
    if (outcome === 'completed') source.latencySum += now - request.createdAt
  }

  /** `responder` has finished with `call`; deliver the Outcome to the caller. */
  function respond(responder: ComponentId, call: Call, outcome: ResponseOutcome): void {
    recordMovement({
      direction: 'response',
      requestId: call.request.id,
      from: responder,
      to: call.caller,
      time: now,
      outcome,
    })
    if (sources.has(call.caller)) {
      finishAtSource(call.request, outcome)
      return
    }
    const queue = queues.get(call.caller)
    if (queue) {
      // The asynchronous part of a Request has finished; no one upstream is waiting on it.
      if (outcome === 'completed') queue.processed++
      else queue.lost++
      return
    }
    // The caller is a Server waiting on this call: pass the Outcome back up,
    // unless the caller was Killed meanwhile and has already answered Failed.
    const parent = call.parent!
    if (parent.cancelled) return
    const caller = workers.get(call.caller)!
    caller.waitingOnCall--
    if (outcome === 'completed') caller.completed++
    releaseSlot(caller, parent)
    respond(caller.spec.id, parent, outcome)
  }

  function killWorker(worker: WorkerState): void {
    if (worker.killed) return
    accrueOccupiedTime(worker)
    const inside = [...worker.active, ...worker.backlog.slice(worker.backlogHead)]
    worker.killed = true
    worker.active = new Set()
    worker.backlog = []
    worker.backlogHead = 0
    worker.occupied = 0
    worker.waitingOnCall = 0
    for (const call of inside) {
      call.cancelled = true
      worker.failed++
      respond(worker.spec.id, call, 'failed')
    }
  }

  function reviveWorker(worker: WorkerState): void {
    if (!worker.killed) return
    worker.killed = false
    worker.occupiedSince = now
    pumpFeeders(worker)
  }

  function killQueue(queue: QueueState): void {
    if (queue.killed) return
    queue.killed = true
    // Held Requests already answered Completed to their callers; they are simply lost.
    queue.failed += queueLength(queue.held, queue.heldHead)
    queue.held = []
    queue.heldHead = 0
  }

  function reviveQueue(queue: QueueState): void {
    queue.killed = false
  }

  function handle(event: Event): void {
    switch (event.kind) {
      case 'generate': {
        const source = sources.get(event.sourceId)!
        const request: Request = { id: nextRequestId++, sourceId: source.spec.id, createdAt: now, finished: false }
        source.created++
        if (Number.isFinite(source.spec.timeLimit)) {
          heap.push(now + source.spec.timeLimit, { kind: 'timeLimit', request })
        }
        const target = chooseTarget(source.route, isLive)
        if (target === undefined) finishAtSource(request, 'failed')
        else sendCall(source.spec.id, target, request, undefined)
        scheduleNextRequest(source)
        return
      }
      case 'workDone': {
        const call = event.call
        if (call.cancelled) return
        const worker = workers.get(event.workerId)!
        if (worker.route.targets.length > 0) {
          const target = chooseTarget(worker.route, isLive)
          if (target !== undefined) {
            // Call-and-wait: keep the slot occupied until the downstream call responds.
            worker.waitingOnCall++
            sendCall(worker.spec.id, target, call.request, call)
          } else {
            // Every downstream Component is Killed.
            releaseSlot(worker, call)
            respond(worker.spec.id, call, 'failed')
          }
          return
        }
        worker.completed++
        releaseSlot(worker, call)
        respond(worker.spec.id, call, 'completed')
        return
      }
      case 'timeLimit': {
        const request = event.request
        if (request.finished) return
        request.finished = true
        sources.get(request.sourceId)!.outcomes.timedOut++
        return
      }
    }
  }

  return {
    get time() {
      return now
    },

    advanceTo(t) {
      for (;;) {
        const next = heap.peekTime()
        if (next === undefined || next > t) break
        const { time, event } = heap.pop()!
        now = time
        handle(event)
      }
      if (t > now) now = t
    },

    applyIntervention(intervention) {
      const id = intervention.componentId
      const worker = workers.get(id)
      const queue = queues.get(id)
      if (worker) {
        if (intervention.kind === 'kill') killWorker(worker)
        else reviveWorker(worker)
      } else if (queue) {
        if (intervention.kind === 'kill') killQueue(queue)
        else reviveQueue(queue)
      } else {
        throw new Error(`Only a Server, Database or Queue can be Killed or revived: ${id}`)
      }
    },

    snapshot() {
      const components: Record<ComponentId, ComponentSnapshot> = {}
      for (const id of order) {
        const source = sources.get(id)
        if (source) {
          const { completed, rejected, failed, timedOut } = source.outcomes
          components[id] = {
            kind: 'source',
            created: source.created,
            inProgress: source.created - completed - rejected - failed - timedOut,
            outcomes: { ...source.outcomes },
            averageLatency: completed === 0 ? null : source.latencySum / completed,
          }
          continue
        }
        const queue = queues.get(id)
        if (queue) {
          components[id] = {
            kind: 'queue',
            killed: queue.killed,
            received: queue.received,
            depth: queueLength(queue.held, queue.heldHead),
            capacity: queue.spec.capacity,
            rejected: queue.rejected,
            lastRejectedAt: queue.lastRejectedAt,
            dispatched: queue.dispatched,
            averageTimeHeld: queue.dispatched === 0 ? null : queue.timeHeldSum / queue.dispatched,
            processed: queue.processed,
            lost: queue.lost,
            failed: queue.failed,
          }
          continue
        }
        const worker = workers.get(id)!
        components[id] = {
          kind: worker.spec.kind,
          killed: worker.killed,
          received: worker.received,
          occupied: worker.occupied,
          waitingOnCall: worker.waitingOnCall,
          concurrency: worker.spec.concurrency,
          utilisation: worker.occupied / worker.spec.concurrency,
          occupiedTime: worker.occupiedTime + worker.occupied * (now - worker.occupiedSince),
          backlog: queueLength(worker.backlog, worker.backlogHead),
          backlogCapacity: worker.spec.backlogCapacity,
          completed: worker.completed,
          rejected: worker.rejected,
          lastRejectedAt: worker.lastRejectedAt,
          failed: worker.failed,
        }
      }
      return { time: now, components }
    },

    takeMovements() {
      const taken = movements
      movements = []
      return taken
    },
  }
}
