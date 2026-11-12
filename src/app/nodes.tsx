import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'
import type { QueueSnapshot, WorkerSnapshot } from '../engine'
import { useSimulation } from './simulationStore'

type ComponentNodeData = {
  label: string
  /** Validation messages for this Component; empty when it is fine. */
  problems: string[]
}
export type ComponentNode = Node<ComponentNodeData>

/** How long, in simulated seconds, a Component stays red after it last Rejected a Request. */
const REJECTION_MEMORY = 1

type Status = 'idle' | 'healthy' | 'busy' | 'overloaded' | 'killed'

const statusLabel: Record<Status, string> = {
  idle: '',
  healthy: 'Healthy',
  busy: 'Busy',
  overloaded: 'Overloaded',
  killed: 'Killed',
}

/** Status from Utilisation averaged over the last second or so, plus any recent Rejections. */
function statusOf(worker: WorkerSnapshot, recentUtilisation: number, time: number): Status {
  if (worker.killed) return 'killed'
  if (time === 0) return 'idle'
  const rejectingNow = worker.lastRejectedAt !== null && time - worker.lastRejectedAt < REJECTION_MEMORY
  if (rejectingNow || recentUtilisation >= 0.95) return 'overloaded'
  if (recentUtilisation >= 0.7) return 'busy'
  return 'healthy'
}

function useComponentSnapshot(id: string) {
  return useSimulation((state) => state.snapshot.components[id])
}

function formatLatency(seconds: number | null): string {
  if (seconds === null) return '–'
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return '–'
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`
}

/**
 * The frame every Component shares: handles on both sides (so any Connection can
 * be drawn, and validation explains the ones that are not allowed), a header
 * with kind and status, the name, and any validation problems.
 */
function ComponentFrame({
  kind,
  status,
  data,
  children,
}: {
  kind: string
  status: Status
  data: ComponentNodeData
  children: ReactNode
}) {
  const hasProblems = data.problems.length > 0
  return (
    <div className={`component component--${status}${hasProblems ? ' component--problem' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="component__header">
        <div className="component__kind">{kind}</div>
        {statusLabel[status] && <div className={`status status--${status}`}>{statusLabel[status]}</div>}
      </div>
      <div className="component__name">{data.label}</div>
      {hasProblems && (
        <ul className="component__problems" role="alert">
          {data.problems.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
      {children}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function SourceNode({ id, data }: NodeProps<ComponentNode>) {
  const snapshot = useComponentSnapshot(id)
  return (
    <ComponentFrame kind="Source" status="idle" data={data}>
      {snapshot?.kind === 'source' && (
        <dl className="component__readout">
          <dt>Completed</dt>
          <dd>{snapshot.outcomes.completed}</dd>
          <dt className="outcome--rejected">Rejected</dt>
          <dd>{snapshot.outcomes.rejected}</dd>
          <dt className="outcome--failed">Failed</dt>
          <dd>{snapshot.outcomes.failed}</dd>
          <dt className="outcome--timed-out">Timed out</dt>
          <dd>{snapshot.outcomes.timedOut}</dd>
          <dt>In progress</dt>
          <dd>{snapshot.inProgress}</dd>
          <dt>Avg latency</dt>
          <dd>{formatLatency(snapshot.averageLatency)}</dd>
        </dl>
      )}
    </ComponentFrame>
  )
}

function fillFraction(count: number, capacity: number): number {
  if (capacity > 0 && Number.isFinite(capacity)) return Math.min(count / capacity, 1)
  return count > 0 ? 1 : 0
}

function BacklogBar({ backlog, capacity, label = 'Backlog' }: { backlog: number; capacity: number; label?: string }) {
  const fill = fillFraction(backlog, capacity)
  return (
    <div className="backlog">
      <div className="backlog__label">
        <span>{label}</span>
        <span>
          {backlog} / {Number.isFinite(capacity) ? capacity : '∞'}
        </span>
      </div>
      <div className="backlog__track">
        <div className="backlog__fill" style={{ width: `${fill * 100}%` }} />
      </div>
    </div>
  )
}

function KillButton({ id, killed }: { id: string; killed: boolean }) {
  const applyIntervention = useSimulation((state) => state.applyIntervention)
  return (
    <button
      type="button"
      className={`kill-button nodrag ${killed ? 'kill-button--revive' : ''}`}
      onClick={(event) => {
        // Killing is not selecting: keep the click away from React Flow's selection.
        event.stopPropagation()
        applyIntervention({ kind: killed ? 'revive' : 'kill', componentId: id })
      }}
    >
      {killed ? 'Revive' : 'Kill'}
    </button>
  )
}

function WorkerNode({ id, data, kindLabel }: NodeProps<ComponentNode> & { kindLabel: string }) {
  const snapshot = useComponentSnapshot(id)
  const time = useSimulation((state) => state.snapshot.time)
  const recentUtilisation = useSimulation((state) => state.recentUtilisation[id] ?? 0)
  const callsDownstream = useSimulation((state) =>
    state.design.architecture.connections.some((connection) => connection.from === id),
  )
  if (snapshot?.kind !== 'server' && snapshot?.kind !== 'database') return null
  const status = statusOf(snapshot, recentUtilisation, time)

  return (
    <ComponentFrame kind={kindLabel} status={status} data={data}>
      <dl className="component__readout">
        <dt>Slots in use</dt>
        <dd>
          {snapshot.occupied} / {snapshot.concurrency}
        </dd>
        <dt>Utilisation</dt>
        <dd>{Math.round(recentUtilisation * 100)}%</dd>
        {callsDownstream && (
          <>
            <dt>Waiting on call</dt>
            <dd>{snapshot.waitingOnCall}</dd>
          </>
        )}
        <dt>Completed</dt>
        <dd>{snapshot.completed}</dd>
        <dt className="outcome--rejected">Rejected</dt>
        <dd>{snapshot.rejected}</dd>
        <dt className="outcome--failed">Failed when Killed</dt>
        <dd>{snapshot.failed}</dd>
      </dl>
      <BacklogBar backlog={snapshot.backlog} capacity={snapshot.backlogCapacity} />
      <KillButton id={id} killed={snapshot.killed} />
    </ComponentFrame>
  )
}

/** Status of a Queue from how full it is, plus any recent Rejections. */
function queueStatusOf(queue: QueueSnapshot, time: number): Status {
  if (queue.killed) return 'killed'
  if (time === 0) return 'idle'
  const rejectingNow = queue.lastRejectedAt !== null && time - queue.lastRejectedAt < REJECTION_MEMORY
  const fill = fillFraction(queue.depth, queue.capacity)
  if (rejectingNow || fill >= 0.9) return 'overloaded'
  if (fill >= 0.5) return 'busy'
  return 'healthy'
}

export function QueueNode({ id, data }: NodeProps<ComponentNode>) {
  const snapshot = useComponentSnapshot(id)
  const time = useSimulation((state) => state.snapshot.time)
  if (snapshot?.kind !== 'queue') return null
  const status = queueStatusOf(snapshot, time)

  return (
    <ComponentFrame kind="Queue" status={status} data={data}>
      <BacklogBar label="Held" backlog={snapshot.depth} capacity={snapshot.capacity} />
      <dl className="component__readout component__readout--spaced">
        <dt>Avg time held</dt>
        <dd>{formatSeconds(snapshot.averageTimeHeld)}</dd>
        <dt>Processed</dt>
        <dd>{snapshot.processed}</dd>
        <dt className="outcome--rejected">Rejected</dt>
        <dd>{snapshot.rejected}</dd>
        <dt className="outcome--failed">Lost downstream</dt>
        <dd>{snapshot.lost}</dd>
        <dt className="outcome--failed">Lost when Killed</dt>
        <dd>{snapshot.failed}</dd>
      </dl>
      <KillButton id={id} killed={snapshot.killed} />
    </ComponentFrame>
  )
}

export function ServerNode(props: NodeProps<ComponentNode>) {
  return <WorkerNode {...props} kindLabel="Server" />
}

export function DatabaseNode(props: NodeProps<ComponentNode>) {
  return <WorkerNode {...props} kindLabel="Database" />
}

export const nodeTypes = { source: SourceNode, server: ServerNode, database: DatabaseNode, queue: QueueNode }
