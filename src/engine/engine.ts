import { EventHeap } from './eventHeap'
import { createRandom, type Random } from './random'
import type {
  ComponentId,
  ComponentSnapshot,
  ComponentSpec,
  DatabaseSpec,
  Intervention,
  Movement,
  Outcome,
  QueueSpec,
  ResponseOutcome,
  Scenario,
  ServerSpec,
  SettingKey,
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
  /**
   * Apply a change at the current simulated time. Throws if it names a
   * Component that does not exist, or re-adds an id used earlier in the Run.
   */
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
   * Set when the Component holding this call is Killed or removed: the call
   * has already been answered with Failed, so any later work on it is wasted
   * and ignored.
   */
  cancelled: boolean
}

/** A Component's outgoing Connections, used round-robin. */
interface Route {
  targets: ComponentId[]
  next: number
}

/**
 * State kept for every Component ever added in this Run. A removed Component
 * keeps its state (so late responses to it have somewhere harmless to land)
 * but is marked removed and leaves the snapshot.
 */
interface SourceState {
  spec: SourceSpec
  route: Route
  removed: boolean
  /** Bumped whenever the Rate changes or the Source is removed; older generate events are ignored. */
  generation: number
  created: number
  outcomes: Record<Outcome, number>
  /** Sum of latencies of Completed Requests. */
  latencySum: number
}

/** A Server or Database. */
interface WorkerState {
  spec: ServerSpec | DatabaseSpec
  /** Where this Component may call after its own work; ignored for a Database. */
  route: Route
  removed: boolean
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
  removed: boolean
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
  | { kind: 'generate'; sourceId: ComponentId; generation: number }
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
  /** For each Server or Database, the Queues that hand it Requests, in the order they were connected. */
  const feeders = new Map<ComponentId, QueueState[]>()
  /** Live Components in the order they were added; the snapshot follows it. */
  let order: ComponentId[] = []
  /** Every id used in this Run, including removed Components. */
  const knownIds = new Set<ComponentId>()
  let movements: Movement[] = []
  let now = 0
  let nextRequestId = 1

  const emptyRoute = (): Route => ({ targets: [], next: 0 })

  function createComponent(spec: ComponentSpec): void {
    if (knownIds.has(spec.id)) throw new Error(`Component id already used in this Run: ${spec.id}`)
    knownIds.add(spec.id)
    order.push(spec.id)
    // Copy the spec: settings change during the Run and must not leak back to the caller's objects.
    switch (spec.kind) {
      case 'source':
        sources.set(spec.id, {
          spec: { ...spec },
          route: emptyRoute(),
          removed: false,
          generation: 0,
          created: 0,
          outcomes: { completed: 0, rejected: 0, failed: 0, timedOut: 0 },
          latencySum: 0,
        })
        return
      case 'queue':
        queues.set(spec.id, {
          spec: { ...spec },
          route: emptyRoute(),
          removed: false,
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
        return
      default:
        workers.set(spec.id, {
          spec: { ...spec },
          route: emptyRoute(),
          removed: false,
          killed: false,
          active: new Set(),
          occupied: 0,
          occupiedTime: 0,
          occupiedSince: now,
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

  /** The route of a live Source, Server, Database or Queue. */
  function routeOf(id: ComponentId): Route | undefined {
    const component = sources.get(id) ?? workers.get(id) ?? queues.get(id)
    return component && !component.removed ? component.route : undefined
  }

  function connect(from: ComponentId, to: ComponentId): void {
    const route = routeOf(from)
    if (!route || !routeOf(to)) throw new Error(`Cannot connect missing Components: ${from} -> ${to}`)
    if (route.targets.includes(to)) return
    route.targets.push(to)
    const queue = queues.get(from)
    if (queue && workers.has(to)) {
      feeders.set(to, [...(feeders.get(to) ?? []), queue])
      pump(queue)
    }
  }

  function disconnect(from: ComponentId, to: ComponentId): void {
    const route = routeOf(from)
    if (!route) return
    const index = route.targets.indexOf(to)
    if (index === -1) return
    route.targets.splice(index, 1)
    // Keep the round-robin pointer on the same next target where possible.
    if (index < route.next) route.next--
    if (route.next >= route.targets.length) route.next = 0
    const queue = queues.get(from)
    if (queue) feeders.set(to, (feeders.get(to) ?? []).filter((q) => q !== queue))
  }

  for (const spec of scenario.architecture.components) createComponent(spec)
  for (const { from, to } of scenario.architecture.connections) connect(from, to)
  // Schedule each Source's first Request in declaration order.
  for (const id of order) {
    const source = sources.get(id)
    if (source) scheduleNextRequest(source)
  }

  function scheduleNextRequest(source: SourceState): void {
    if (source.removed || source.spec.rate <= 0) return
    heap.push(now + random.exponential(1 / source.spec.rate), {
      kind: 'generate',
      sourceId: source.spec.id,
      generation: source.generation,
    })
  }

  function recordMovement(movement: Movement): void {
    if (movements.length < movementCap) movements.push(movement)
  }

  /** A Server, Database or Queue that is neither Killed nor removed. */
  function isLive(id: ComponentId): boolean {
    const component = workers.get(id) ?? queues.get(id)
    return component !== undefined && !component.killed && !component.removed
  }

  /** A live Server or Database with a free Concurrency slot. */
  function hasFreeSlot(id: ComponentId): boolean {
    const worker = workers.get(id)
    return worker !== undefined && !worker.killed && !worker.removed && worker.occupied < worker.spec.concurrency
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

  /** Start Backlog work in any free slots, then let feeding Queues use what is still free. */
  function fillFreeSlots(worker: WorkerState): void {
    while (worker.occupied < worker.spec.concurrency) {
      const next = takeFromBacklog(worker)
      if (!next) break
      startWork(worker, next)
    }
    pumpFeeders(worker)
  }

  /** Free the slot `call` held and give it to waiting work. */
  function releaseSlot(worker: WorkerState, call: Call): void {
    accrueOccupiedTime(worker)
    worker.occupied--
    worker.active.delete(call)
    fillFreeSlots(worker)
  }

  /** Hand held Requests downstream while some target has a free slot, oldest first. */
  function pump(queue: QueueState): void {
    if (queue.killed || queue.removed) return
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
    // unless the caller was Killed or removed meanwhile and has already answered Failed.
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

  function removeComponent(id: ComponentId): void {
    const source = sources.get(id)
    const worker = workers.get(id)
    const queue = queues.get(id)
    if (source && !source.removed) {
      // Requests already sent carry on; their Outcomes land on the removed Source's state.
      source.removed = true
      source.generation++
    } else if (worker && !worker.removed) {
      killWorker(worker)
      worker.removed = true
    } else if (queue && !queue.removed) {
      killQueue(queue)
      queue.removed = true
    } else {
      throw new Error(`No such Component: ${id}`)
    }
    for (const other of order) {
      if (other === id) continue
      disconnect(other, id)
    }
    const own = source ?? worker ?? queue!
    for (const target of [...own.route.targets]) disconnect(id, target)
    feeders.delete(id)
    order = order.filter((other) => other !== id)
  }

  function setSetting(id: ComponentId, key: SettingKey, value: number): void {
    const source = sources.get(id)
    const worker = workers.get(id)
    const queue = queues.get(id)
    if (source && !source.removed && (key === 'rate' || key === 'timeLimit')) {
      source.spec[key] = value
      if (key === 'rate') {
        // Inter-arrival times are memoryless, so drawing a fresh gap from now is statistically sound
        // and makes a big Rate change take effect at once rather than after the old gap.
        source.generation++
        scheduleNextRequest(source)
      }
      return
    }
    if (worker && !worker.removed && (key === 'concurrency' || key === 'workTime' || key === 'backlogCapacity')) {
      accrueOccupiedTime(worker)
      worker.spec[key] = value
      // Raising Concurrency puts waiting work into the new slots now; lowering it interrupts nothing.
      if (key === 'concurrency' && !worker.killed) fillFreeSlots(worker)
      return
    }
    if (queue && !queue.removed && key === 'capacity') {
      queue.spec.capacity = value
      return
    }
    throw new Error(`Cannot set ${key} on ${id}`)
  }

  function handle(event: Event): void {
    switch (event.kind) {
      case 'generate': {
        const source = sources.get(event.sourceId)!
        if (event.generation !== source.generation || source.removed) return
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
        if (worker.spec.kind === 'server' && worker.route.targets.length > 0) {
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

  function liveWorkerOrQueue(id: ComponentId) {
    const worker = workers.get(id)
    if (worker && !worker.removed) return { worker }
    const queue = queues.get(id)
    if (queue && !queue.removed) return { queue }
    throw new Error(`Only a Server, Database or Queue can be Killed or revived: ${id}`)
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
      switch (intervention.kind) {
        case 'kill':
        case 'revive': {
          const { worker, queue } = liveWorkerOrQueue(intervention.componentId)
          if (worker) {
            if (intervention.kind === 'kill') killWorker(worker)
            else reviveWorker(worker)
          } else if (queue) {
            if (intervention.kind === 'kill') killQueue(queue)
            else reviveQueue(queue)
          }
          return
        }
        case 'setSetting':
          setSetting(intervention.componentId, intervention.key, intervention.value)
          return
        case 'addComponent': {
          createComponent(intervention.component)
          const source = sources.get(intervention.component.id)
          if (source) scheduleNextRequest(source)
          return
        }
        case 'removeComponent':
          removeComponent(intervention.componentId)
          return
        case 'addConnection':
          connect(intervention.from, intervention.to)
          return
        case 'removeConnection':
          disconnect(intervention.from, intervention.to)
          return
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
