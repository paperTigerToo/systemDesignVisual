/** The public data shapes of the engine. Plain data only, no behaviour. */

export type ComponentId = string

export interface SourceSpec {
  kind: 'source'
  id: ComponentId
  /** Requests per second, randomly spaced. */
  rate: number
  /** Seconds a Request may take before its Outcome is Timed out. */
  timeLimit: number
}

interface WorkerSettings {
  /** Requests it can work on (or hold while waiting on a downstream call) at the same time. */
  concurrency: number
  /** Mean Work time in seconds; each Request's Work time is exponentially distributed around it. */
  workTime: number
  /** Most Requests that may wait in the Backlog; any more are Rejected. */
  backlogCapacity: number
}

export interface ServerSpec extends WorkerSettings {
  kind: 'server'
  id: ComponentId
}

export interface DatabaseSpec extends WorkerSettings {
  kind: 'database'
  id: ComponentId
}

export interface QueueSpec {
  kind: 'queue'
  id: ComponentId
  /** Most Requests it may hold; any more are Rejected. */
  capacity: number
}

export type ComponentSpec = SourceSpec | ServerSpec | DatabaseSpec | QueueSpec

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

/** How a Request ended, as recorded at its Source. */
export type Outcome = 'completed' | 'rejected' | 'failed' | 'timedOut'

/** The Outcomes a Component can respond with. Timed out is decided by the Source alone. */
export type ResponseOutcome = Exclude<Outcome, 'timedOut'>

export interface SourceSnapshot {
  kind: 'source'
  created: number
  /** Requests created that have no Outcome yet. */
  inProgress: number
  outcomes: Record<Outcome, number>
  /** Mean latency in seconds (creation to response) of Completed Requests, or null before the first. */
  averageLatency: number | null
}

/** State of a Server or Database. */
export interface WorkerSnapshot {
  kind: 'server' | 'database'
  /** True while the user has switched this Component off. */
  killed: boolean
  /** Calls that have arrived here, whatever became of them. */
  received: number
  /**
   * Concurrency slots in use: Requests being worked on plus Requests held
   * while waiting on a downstream call.
   */
  occupied: number
  /** Of the occupied slots, how many are held waiting on a downstream call. */
  waitingOnCall: number
  concurrency: number
  /** occupied / concurrency, right now. */
  utilisation: number
  /**
   * Total slot-seconds occupied since the Run began. The change between two
   * snapshots, divided by elapsed time and Concurrency, is the average
   * Utilisation over that interval.
   */
  occupiedTime: number
  /** Requests waiting in the Backlog. */
  backlog: number
  backlogCapacity: number
  /** Requests this Component responded to with Completed. */
  completed: number
  /** Requests this Component turned away because its Backlog was full. */
  rejected: number
  /** Simulated time this Component last Rejected a Request, or null if it never has. */
  lastRejectedAt: number | null
  /** Requests that were inside this Component when it was Killed. */
  failed: number
}

export interface QueueSnapshot {
  kind: 'queue'
  killed: boolean
  /** Calls that have arrived here, whatever became of them. */
  received: number
  /** Requests held right now, waiting for a downstream slot. */
  depth: number
  capacity: number
  /** Requests turned away because the Queue was full. */
  rejected: number
  /** Simulated time this Queue last Rejected a Request, or null if it never has. */
  lastRejectedAt: number | null
  /** Requests handed to a downstream Component. */
  dispatched: number
  /** Mean seconds a dispatched Request spent held, or null before the first. */
  averageTimeHeld: number | null
  /** Dispatched Requests whose downstream work responded Completed. */
  processed: number
  /** Dispatched Requests whose downstream work responded Rejected or Failed; they are not redelivered. */
  lost: number
  /** Requests held when the Queue was Killed, and so lost. */
  failed: number
}

export type ComponentSnapshot = SourceSnapshot | WorkerSnapshot | QueueSnapshot

export interface Snapshot {
  /** Simulated time in seconds. */
  time: number
  components: Record<ComponentId, ComponentSnapshot>
}

/**
 * One Request travelling along a Connection at a simulated time: a call goes
 * from caller to callee, a response comes back from callee to caller carrying
 * its Outcome. Travel takes zero simulated time; the UI animates it purely for show.
 */
export type Movement =
  | { direction: 'call'; requestId: number; from: ComponentId; to: ComponentId; time: number }
  | {
      direction: 'response'
      requestId: number
      from: ComponentId
      to: ComponentId
      time: number
      outcome: ResponseOutcome
    }

/**
 * A change made at the current simulated time. Ticket 07 adds the remaining
 * kinds (settings, adding and removing Components and Connections) and
 * records them for replay.
 */
export type Intervention = { kind: 'kill'; componentId: ComponentId } | { kind: 'revive'; componentId: ComponentId }
