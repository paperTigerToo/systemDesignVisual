import { EventHeap } from './eventHeap'
import { createRandom, type Random } from './random'
import type {
  ComponentId,
  ComponentSnapshot,
  DatabaseSpec,
  Movement,
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

interface Request {
  id: number
  sourceId: ComponentId
  createdAt: number
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
  completed: number
  latencySum: number
}

/** A Server or Database. */
interface WorkerState {
  spec: ServerSpec | DatabaseSpec
  /** Where this Component calls after its own work; always undefined for a Database. */
  downstream: ComponentId | undefined
  occupied: number
  waitingOnCall: number
  backlog: Call[]
  backlogHead: number
  completed: number
}

type Event =
  | { kind: 'generate'; sourceId: ComponentId }
  | { kind: 'workDone'; workerId: ComponentId; call: Call }

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
      sources.set(spec.id, { spec, target: firstTarget(spec.id), created: 0, completed: 0, latencySum: 0 })
    } else {
      workers.set(spec.id, {
        spec,
        downstream: spec.kind === 'server' ? firstTarget(spec.id) : undefined,
        occupied: 0,
        waitingOnCall: 0,
        backlog: [],
        backlogHead: 0,
        completed: 0,
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

  function recordMovement(request: Request, from: ComponentId, to: ComponentId, direction: Movement['direction']): void {
    if (movements.length >= movementCap) return
    movements.push({ requestId: request.id, from, to, time: now, direction })
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

  function startWork(worker: WorkerState, call: Call): void {
    worker.occupied++
    heap.push(now + random.exponential(worker.spec.workTime), { kind: 'workDone', workerId: worker.spec.id, call })
  }

  /** Send `request` from `caller` to `target`. */
  function sendCall(caller: ComponentId, target: ComponentId, request: Request, parent: Call | undefined): void {
    const worker = workers.get(target)
    if (!worker) return
    recordMovement(request, caller, target, 'call')
    const call: Call = { request, caller, parent }
    if (worker.occupied < worker.spec.concurrency) startWork(worker, call)
    else worker.backlog.push(call)
  }

  /** Free one of the worker's slots and start the next Request in its Backlog. */
  function releaseSlot(worker: WorkerState): void {
    worker.occupied--
    const next = takeFromBacklog(worker)
    if (next) startWork(worker, next)
  }

  /** `responder` has finished `call`; deliver the response to the caller. */
  function respond(responder: ComponentId, call: Call): void {
    recordMovement(call.request, responder, call.caller, 'response')
    const source = sources.get(call.caller)
    if (source) {
      source.completed++
      source.latencySum += now - call.request.createdAt
      return
    }
    const caller = workers.get(call.caller)!
    caller.waitingOnCall--
    caller.completed++
    releaseSlot(caller)
    respond(caller.spec.id, call.parent!)
  }

  function handle(event: Event): void {
    switch (event.kind) {
      case 'generate': {
        const source = sources.get(event.sourceId)!
        const request: Request = { id: nextRequestId++, sourceId: source.spec.id, createdAt: now }
        source.created++
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
        respond(worker.spec.id, event.call)
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
          components[id] = {
            kind: 'source',
            created: source.created,
            completed: source.completed,
            averageLatency: source.completed === 0 ? null : source.latencySum / source.completed,
          }
          continue
        }
        const worker = workers.get(id)!
        components[id] = {
          kind: worker.spec.kind,
          occupied: worker.occupied,
          waitingOnCall: worker.waitingOnCall,
          concurrency: worker.spec.concurrency,
          backlog: backlogLength(worker),
          completed: worker.completed,
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
