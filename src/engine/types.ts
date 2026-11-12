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
  /** Requests it can work on at the same time. */
  concurrency: number
  /** Mean Work time in seconds; each Request's Work time is exponentially distributed around it. */
  workTime: number
}

export type ComponentSpec = SourceSpec | ServerSpec

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
}

export interface ServerSnapshot {
  kind: 'server'
  /** Requests currently being worked on. */
  inProgress: number
  concurrency: number
  /** Requests waiting in the Backlog. */
  backlog: number
  completed: number
}

export type ComponentSnapshot = SourceSnapshot | ServerSnapshot

export interface Snapshot {
  /** Simulated time in seconds. */
  time: number
  components: Record<ComponentId, ComponentSnapshot>
}

/**
 * One Request travelling along a Connection at a simulated time. Travel takes
 * zero simulated time; the UI animates it purely for show.
 */
export interface Movement {
  requestId: number
  from: ComponentId
  to: ComponentId
  time: number
  direction: 'call'
}
