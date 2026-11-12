import { EventHeap } from './eventHeap'
import { createRandom, type Random } from './random'
import type {
  ComponentId,
  ComponentSnapshot,
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

interface SourceState {
  spec: SourceSpec
  target: ComponentId | undefined
  created: number
  completed: number
}

interface ServerState {
  spec: ServerSpec
  inProgress: number
  backlog: Request[]
  backlogHead: number
  completed: number
}

type Event =
  | { kind: 'generate'; sourceId: ComponentId }
  | { kind: 'workDone'; serverId: ComponentId; request: Request }

export function createEngine(scenario: Scenario, options: EngineOptions = {}): Engine {
  const movementCap = options.movementCap ?? 1000
  const random: Random = createRandom(scenario.seed)
  const heap = new EventHeap<Event>()
  const sources = new Map<ComponentId, SourceState>()
  const servers = new Map<ComponentId, ServerState>()
  const order: ComponentId[] = []
  let movements: Movement[] = []
  let now = 0
  let nextRequestId = 1

  for (const spec of scenario.architecture.components) {
    order.push(spec.id)
    if (spec.kind === 'source') {
      const target = scenario.architecture.connections.find((c) => c.from === spec.id)?.to
      sources.set(spec.id, { spec, target, created: 0, completed: 0 })
    } else {
      servers.set(spec.id, { spec, inProgress: 0, backlog: [], backlogHead: 0, completed: 0 })
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

  function recordMovement(request: Request, from: ComponentId, to: ComponentId): void {
    if (movements.length >= movementCap) return
    movements.push({ requestId: request.id, from, to, time: now, direction: 'call' })
  }

  function backlogLength(server: ServerState): number {
    return server.backlog.length - server.backlogHead
  }

  function startWork(server: ServerState, request: Request): void {
    server.inProgress++
    heap.push(now + random.exponential(server.spec.workTime), {
      kind: 'workDone',
      serverId: server.spec.id,
      request,
    })
  }

  function arriveAtServer(server: ServerState, request: Request): void {
    if (server.inProgress < server.spec.concurrency) startWork(server, request)
    else server.backlog.push(request)
  }

  function takeFromBacklog(server: ServerState): Request | undefined {
    if (backlogLength(server) === 0) return undefined
    const request = server.backlog[server.backlogHead]!
    server.backlogHead++
    // Compact occasionally so the array does not grow forever.
    if (server.backlogHead > 1024 && server.backlogHead * 2 > server.backlog.length) {
      server.backlog = server.backlog.slice(server.backlogHead)
      server.backlogHead = 0
    }
    return request
  }

  function handle(event: Event): void {
    switch (event.kind) {
      case 'generate': {
        const source = sources.get(event.sourceId)!
        const request: Request = { id: nextRequestId++, sourceId: source.spec.id, createdAt: now }
        source.created++
        const server = source.target === undefined ? undefined : servers.get(source.target)
        if (server) {
          recordMovement(request, source.spec.id, server.spec.id)
          arriveAtServer(server, request)
        }
        scheduleNextRequest(source)
        return
      }
      case 'workDone': {
        const server = servers.get(event.serverId)!
        server.inProgress--
        server.completed++
        sources.get(event.request.sourceId)!.completed++
        const waiting = takeFromBacklog(server)
        if (waiting) startWork(server, waiting)
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
          components[id] = { kind: 'source', created: source.created, completed: source.completed }
          continue
        }
        const server = servers.get(id)!
        components[id] = {
          kind: 'server',
          inProgress: server.inProgress,
          concurrency: server.spec.concurrency,
          backlog: backlogLength(server),
          completed: server.completed,
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
