/** The public data shapes of the engine. Plain data only, no behaviour. */

export type ComponentId = string

export interface SourceSpec {
  kind: 'source'
  id: ComponentId
  /** Requests per second, randomly spaced. */
  rate: number
}

export interface ServerSpec {
  kind: 'server'
  id: ComponentId
  /** Requests it can work on (or hold while waiting on a downstream call) at the same time. */
  concurrency: number
  /** Mean Work time in seconds; each Request's Work time is exponentially distributed around it. */
  workTime: number
}

export interface DatabaseSpec {
  kind: 'database'
  id: ComponentId
  /** Requests it can work on at the same time. */
  concurrency: number
  /** Mean Work time in seconds; each Request's Work time is exponentially distributed around it. */
  workTime: number
}

export type ComponentSpec = SourceSpec | ServerSpec | DatabaseSpec

export interface ConnectionSpec {
  from: ComponentId
  to: ComponentId
}

export interface Architecture {
  components: ComponentSpec[]
  connections: ConnectionSpec[]
}

/**
 * Everything needed to reproduce a Run. Later tickets add a list of
 * Interventions here.
 */
export interface Scenario {
  seed: number
  architecture: Architecture
}

export interface SourceSnapshot {
  kind: 'source'
  created: number
  completed: number
  /** Mean latency in seconds (creation to response) of completed Requests, or null before the first. */
  averageLatency: number | null
}

/** State of a Server or Database. */
export interface WorkerSnapshot {
  kind: 'server' | 'database'
  /**
   * Concurrency slots in use: Requests being worked on plus Requests held
   * while waiting on a downstream call.
   */
  occupied: number
  /** Of the occupied slots, how many are held waiting on a downstream call. */
  waitingOnCall: number
  concurrency: number
  /** Requests waiting in the Backlog. */
  backlog: number
  /** Requests this Component has responded to. */
  completed: number
}

export type ComponentSnapshot = SourceSnapshot | WorkerSnapshot

export interface Snapshot {
  /** Simulated time in seconds. */
  time: number
  components: Record<ComponentId, ComponentSnapshot>
}

/**
 * One Request travelling along a Connection at a simulated time: a call goes
 * from caller to callee, a response comes back from callee to caller. Travel
 * takes zero simulated time; the UI animates it purely for show.
 */
export interface Movement {
  requestId: number
  from: ComponentId
  to: ComponentId
  time: number
  direction: 'call' | 'response'
}
