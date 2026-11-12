import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { WorkerSnapshot } from '../engine'
import { useSimulation } from './simulationStore'

type ComponentNodeData = { label: string }
export type ComponentNode = Node<ComponentNodeData>

/** How long, in simulated seconds, a Component stays red after it last Rejected a Request. */
const REJECTION_MEMORY = 1

type Status = 'healthy' | 'busy' | 'overloaded' | 'killed'

const statusLabel: Record<Status, string> = {
  healthy: 'Healthy',
  busy: 'Busy',
  overloaded: 'Overloaded',
  killed: 'Killed',
}

/** Status from Utilisation averaged over the last second or so, plus any recent Rejections. */
function statusOf(worker: WorkerSnapshot, recentUtilisation: number, time: number): Status {
  if (worker.killed) return 'killed'
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

export function SourceNode({ id, data }: NodeProps<ComponentNode>) {
  const snapshot = useComponentSnapshot(id)
  return (
    <div className="component component--source">
      <div className="component__kind">Source</div>
      <div className="component__name">{data.label}</div>
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
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function BacklogBar({ backlog, capacity }: { backlog: number; capacity: number }) {
  const fill = capacity > 0 && Number.isFinite(capacity) ? Math.min(backlog / capacity, 1) : backlog > 0 ? 1 : 0
  return (
    <div className="backlog">
      <div className="backlog__label">
        <span>Backlog</span>
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

function WorkerNode({
  id,
  data,
  kindLabel,
  callsDownstream,
}: NodeProps<ComponentNode> & { kindLabel: string; callsDownstream: boolean }) {
  const snapshot = useComponentSnapshot(id)
  const time = useSimulation((state) => state.snapshot.time)
  const recentUtilisation = useSimulation((state) => state.recentUtilisation[id] ?? 0)
  const applyIntervention = useSimulation((state) => state.applyIntervention)
  if (snapshot?.kind !== 'server' && snapshot?.kind !== 'database') return null
  const status = statusOf(snapshot, recentUtilisation, time)
  const toggleKilled = () =>
    applyIntervention({ kind: snapshot.killed ? 'revive' : 'kill', componentId: id })

  return (
    <div className={`component component--${status}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="component__header">
        <div className="component__kind">{kindLabel}</div>
        <div className={`status status--${status}`}>{statusLabel[status]}</div>
      </div>
      <div className="component__name">{data.label}</div>
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
      <button
        type="button"
        className={`kill-button nodrag ${snapshot.killed ? 'kill-button--revive' : ''}`}
        onClick={toggleKilled}
      >
        {snapshot.killed ? 'Revive' : 'Kill'}
      </button>
      {callsDownstream && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>
  )
}

export function ServerNode(props: NodeProps<ComponentNode>) {
  return <WorkerNode {...props} kindLabel="Server" callsDownstream />
}

export function DatabaseNode(props: NodeProps<ComponentNode>) {
  return <WorkerNode {...props} kindLabel="Database" callsDownstream={false} />
}

export const nodeTypes = { source: SourceNode, server: ServerNode, database: DatabaseNode }
