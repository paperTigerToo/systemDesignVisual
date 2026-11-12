import { EventHeap } from './eventHeap'
import { createRandom, type Random } from './random'
import type {
  ComponentId,
  ComponentSnapshot,
  DatabaseSpec,
  Movement,
  Outcome,
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

/** The Outcomes a Component can respond with. Timed out is decided by the Source alone. */
type ResponseOutcome = 'completed' | 'rejected'

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
 * so responses can unwind back to the Source.
 */
interface Call {
  request: Request
  caller: ComponentId
  parent: Call | undefined
}

interface SourceState {
  spec: SourceSpec
  target: ComponentId | undefined
  created: number
  outcomes: Record<Outcome, number>
  /** Sum of latencies of Completed Requests. */
  latencySum: number
}

/** A Server or Database. */
interface WorkerState {
  spec: ServerSpec | DatabaseSpec
  /** Where this Component calls after its own work; always undefined for a Database. */
  downstream: ComponentId | undefined
  occupied: number
  /** Slot-seconds occupied up to `occupiedSince`. */
  occupiedTime: number
  occupiedSince: number
  waitingOnCall: number
  backlog: Call[]
  backlogHead: number
  completed: number
  rejected: number
  lastRejectedAt: number | null
}

type Event =
  | { kind: 'generate'; sourceId: ComponentId }
  | { kind: 'workDone'; workerId: ComponentId; call: Call }
  | { kind: 'timeLimit'; request: Request }

export function createEngine(scenario: Scenario, options: EngineOptions = {}): Engine {
  const movementCap = options.movementCap ?? 1000
  const random: Random = createRandom(scenario.seed)
  const heap = new EventHeap<Event>()
  const sources = new Map<ComponentId, SourceState>()
  const workers = new Map<ComponentId, WorkerState>()
  const order: ComponentId[] = []
  let movements: Movement[] = []
  let now = 0
  let nextRequestId = 1

  const firstTarget = (id: ComponentId) => scenario.architecture.connections.find((c) => c.from === id)?.to

  for (const spec of scenario.architecture.components) {
    order.push(spec.id)
    if (spec.kind === 'source') {
      sources.set(spec.id, {
        spec,
        target: firstTarget(spec.id),
        created: 0,
        outcomes: { completed: 0, rejected: 0, timedOut: 0 },
        latencySum: 0,
      })
    } else {
      workers.set(spec.id, {
        spec,
        downstream: spec.kind === 'server' ? firstTarget(spec.id) : undefined,
        occupied: 0,
        occupiedTime: 0,
        occupiedSince: 0,
        waitingOnCall: 0,
        backlog: [],
        backlogHead: 0,
        completed: 0,
        rejected: 0,
        lastRejectedAt: null,
      })
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

  function backlogLength(worker: WorkerState): number {
    return worker.backlog.length - worker.backlogHead
  }

  function takeFromBacklog(worker: WorkerState): Call | undefined {
    if (backlogLength(worker) === 0) return undefined
    const call = worker.backlog[worker.backlogHead]!
    worker.backlogHead++
    // Compact occasionally so the array does not grow forever.
    if (worker.backlogHead > 1024 && worker.backlogHead * 2 > worker.backlog.length) {
      worker.backlog = worker.backlog.slice(worker.backlogHead)
      worker.backlogHead = 0
    }
    return call
  }

  /** Bring the occupied slot-seconds up to now; call before every change to `occupied`. */
  function accrueOccupiedTime(worker: WorkerState): void {
    worker.occupiedTime += worker.occupied * (now - worker.occupiedSince)
    worker.occupiedSince = now
  }

  function startWork(worker: WorkerState, call: Call): void {
    accrueOccupiedTime(worker)
    worker.occupied++
    heap.push(now + random.exponential(worker.spec.workTime), { kind: 'workDone', workerId: worker.spec.id, call })
  }

  /** Send `request` from `caller` to `target`: start work, wait in the Backlog, or be Rejected. */
  function sendCall(caller: ComponentId, target: ComponentId, request: Request, parent: Call | undefined): void {
    const worker = workers.get(target)
    if (!worker) return
    recordMovement({ direction: 'call', requestId: request.id, from: caller, to: target, time: now })
    const call: Call = { request, caller, parent }
    if (worker.occupied < worker.spec.concurrency) {
      startWork(worker, call)
    } else if (backlogLength(worker) < worker.spec.backlogCapacity) {
      worker.backlog.push(call)
    } else {
      worker.rejected++
      worker.lastRejectedAt = now
      respond(worker.spec.id, call, 'rejected')
    }
  }

  /** Free one of the worker's slots and start the next Request in its Backlog. */
  function releaseSlot(worker: WorkerState): void {
    accrueOccupiedTime(worker)
    worker.occupied--
    const next = takeFromBacklog(worker)
    if (next) startWork(worker, next)
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
    const source = sources.get(call.caller)
    if (source) {
      const request = call.request
      // A response after the time limit is wasted work: the Outcome is already Timed out.
      if (request.finished) return
      request.finished = true
      source.outcomes[outcome]++
      if (outcome === 'completed') source.latencySum += now - request.createdAt
      return
    }
    // The caller is a Server waiting on this call: pass the Outcome back up.
    const caller = workers.get(call.caller)!
    caller.waitingOnCall--
    if (outcome === 'completed') caller.completed++
    releaseSlot(caller)
    respond(caller.spec.id, call.parent!, outcome)
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
        if (source.target !== undefined) sendCall(source.spec.id, source.target, request, undefined)
        scheduleNextRequest(source)
        return
      }
      case 'workDone': {
        const worker = workers.get(event.workerId)!
        if (worker.downstream !== undefined && workers.has(worker.downstream)) {
          // Call-and-wait: keep the slot occupied until the downstream call responds.
          worker.waitingOnCall++
          sendCall(worker.spec.id, worker.downstream, event.call.request, event.call)
          return
        }
        worker.completed++
        releaseSlot(worker)
        respond(worker.spec.id, event.call, 'completed')
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

    snapshot() {
      const components: Record<ComponentId, ComponentSnapshot> = {}
      for (const id of order) {
        const source = sources.get(id)
        if (source) {
          const { completed, rejected, timedOut } = source.outcomes
          components[id] = {
            kind: 'source',
            created: source.created,
            inProgress: source.created - completed - rejected - timedOut,
            outcomes: { ...source.outcomes },
            averageLatency: completed === 0 ? null : source.latencySum / completed,
          }
          continue
        }
        const worker = workers.get(id)!
        components[id] = {
          kind: worker.spec.kind,
          occupied: worker.occupied,
          waitingOnCall: worker.waitingOnCall,
          concurrency: worker.spec.concurrency,
          utilisation: worker.occupied / worker.spec.concurrency,
          occupiedTime: worker.occupiedTime + worker.occupied * (now - worker.occupiedSince),
          backlog: backlogLength(worker),
          backlogCapacity: worker.spec.backlogCapacity,
          completed: worker.completed,
          rejected: worker.rejected,
          lastRejectedAt: worker.lastRejectedAt,
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
