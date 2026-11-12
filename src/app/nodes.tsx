import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useSimulation } from './simulationStore'

type ComponentNodeData = { label: string }
export type ComponentNode = Node<ComponentNodeData>

function useComponentSnapshot(id: string) {
  return useSimulation((state) => state.snapshot.components[id])
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
        </dl>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

export function ServerNode({ id, data }: NodeProps<ComponentNode>) {
  const snapshot = useComponentSnapshot(id)
  return (
    <div className="component component--server">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="component__kind">Server</div>
      <div className="component__name">{data.label}</div>
      {snapshot?.kind === 'server' && (
        <dl className="component__readout">
          <dt>In progress</dt>
          <dd>
            {snapshot.inProgress} / {snapshot.concurrency}
          </dd>
          <dt>Backlog</dt>
          <dd>{snapshot.backlog}</dd>
          <dt>Completed</dt>
          <dd>{snapshot.completed}</dd>
        </dl>
      )}
    </div>
  )
}

export const nodeTypes = { source: SourceNode, server: ServerNode }
