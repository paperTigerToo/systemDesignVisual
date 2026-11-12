import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useSimulation } from './simulationStore'

type ComponentNodeData = { label: string }
export type ComponentNode = Node<ComponentNodeData>

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
          <dt>Created</dt>
          <dd>{snapshot.created}</dd>
          <dt>Completed</dt>
          <dd>{snapshot.completed}</dd>
          <dt>Avg latency</dt>
          <dd>{formatLatency(snapshot.averageLatency)}</dd>
        </dl>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function WorkerNode({ id, data, kindLabel, callsDownstream }: NodeProps<ComponentNode> & { kindLabel: string; callsDownstream: boolean }) {
  const snapshot = useComponentSnapshot(id)
  return (
    <div className="component">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="component__kind">{kindLabel}</div>
      <div className="component__name">{data.label}</div>
      {(snapshot?.kind === 'server' || snapshot?.kind === 'database') && (
        <dl className="component__readout">
          <dt>Slots in use</dt>
          <dd>
            {snapshot.occupied} / {snapshot.concurrency}
          </dd>
          {callsDownstream && (
            <>
              <dt>Waiting on call</dt>
              <dd>{snapshot.waitingOnCall}</dd>
            </>
          )}
          <dt>Backlog</dt>
          <dd>{snapshot.backlog}</dd>
          <dt>Completed</dt>
          <dd>{snapshot.completed}</dd>
        </dl>
      )}
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
