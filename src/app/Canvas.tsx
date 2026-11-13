import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, type DragEvent } from 'react'
import { edgeTypes, type ConnectionEdgeType } from './ConnectionEdge'
import { connectionId, type ComponentKind } from './design'
import { ModelMarker } from './Assumptions'
import { DotLayer } from './DotLayer'
import { FirstVisitHint } from './FirstVisitHint'
import { nodeTypes, type ComponentNode } from './nodes'
import { PALETTE_DRAG_TYPE } from './Palette'
import { useSimulation } from './simulationStore'

/** Never zoom in past 100% when fitting: a single Component would otherwise fill the screen. */
const FIT_OPTIONS = { padding: 0.25, maxZoom: 1 }

/** The editable architecture: drag Components around, draw and delete Connections, drop new Components in. */
export function Canvas() {
  const design = useSimulation((state) => state.design)
  const problems = useSimulation((state) => state.problems)
  const selection = useSimulation((state) => state.selection)
  const loadCount = useSimulation((state) => state.loadCount)
  const empty = useSimulation((state) => state.design.architecture.components.length === 0)
  const { screenToFlowPosition, fitView, setViewport } = useReactFlow()

  // Refit whenever a whole design is loaded. An empty canvas gets a plain 100% view
  // rather than a fit to nothing, which would zoom right in.
  useEffect(() => {
    if (loadCount === 0) return
    const frame = requestAnimationFrame(() => {
      if (useSimulation.getState().design.architecture.components.length === 0) void setViewport({ x: 0, y: 0, zoom: 1 })
      else void fitView(FIT_OPTIONS)
    })
    return () => cancelAnimationFrame(frame)
  }, [loadCount, fitView, setViewport])

  const nodes = useMemo<ComponentNode[]>(() => {
    const messages = new Map<string, string[]>()
    for (const problem of problems) {
      if (problem.componentId) messages.set(problem.componentId, [...(messages.get(problem.componentId) ?? []), problem.message])
    }
    return design.architecture.components.map((component) => {
      const placement = design.layout[component.id]
      return {
        id: component.id,
        type: component.kind,
        position: { x: placement?.x ?? 0, y: placement?.y ?? 0 },
        data: { label: placement?.label ?? component.id, problems: messages.get(component.id) ?? [] },
        selected: selection?.kind === 'component' && selection.id === component.id,
      }
    })
  }, [design, problems, selection])

  const edges = useMemo<ConnectionEdgeType[]>(() => {
    const broken = new Set(
      problems.filter((p) => p.connection).map((p) => connectionId(p.connection!.from, p.connection!.to)),
    )
    return design.architecture.connections.map(({ from, to }) => {
      const id = connectionId(from, to)
      return {
        id,
        source: from,
        target: to,
        type: 'connection' as const,
        data: { problem: broken.has(id) },
        // The arrowhead's colour comes from the theme, in CSS.
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        selected: selection?.kind === 'connection' && selection.from === from && selection.to === to,
      }
    })
  }, [design, problems, selection])

  const onNodesChange = useCallback((changes: NodeChange<ComponentNode>[]) => {
    const store = useSimulation.getState()
    for (const change of changes) {
      if (change.type === 'position' && change.position) store.moveComponent(change.id, change.position)
      else if (change.type === 'remove') store.removeComponent(change.id)
      else if (change.type === 'select') {
        const current = useSimulation.getState().selection
        if (change.selected) store.select({ kind: 'component', id: change.id })
        else if (current?.kind === 'component' && current.id === change.id) store.select(null)
      }
    }
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<ConnectionEdgeType>[]) => {
    const store = useSimulation.getState()
    const connections = store.design.architecture.connections
    const find = (id: string) => connections.find((c) => connectionId(c.from, c.to) === id)
    for (const change of changes) {
      const connection = change.type === 'add' ? undefined : find(change.id)
      if (!connection) continue
      if (change.type === 'remove') store.removeConnection(connection.from, connection.to)
      else if (change.type === 'select') {
        const current = useSimulation.getState().selection
        const isCurrent = current?.kind === 'connection' && current.from === connection.from && current.to === connection.to
        if (change.selected) store.select({ kind: 'connection', ...connection })
        else if (isCurrent) store.select(null)
      }
    }
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    useSimulation.getState().addConnection(connection.source, connection.target)
  }, [])

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      const kind = event.dataTransfer.getData(PALETTE_DRAG_TYPE) as ComponentKind
      if (!kind) return
      event.preventDefault()
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      // Centre the new Component under the pointer (nodes are about 190 by 160).
      useSimulation.getState().addComponent(kind, { x: position.x - 95, y: position.y - 40 })
    },
    [screenToFlowPosition],
  )

  return (
    <div className="canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => useSimulation.getState().select(null)}
        deleteKeyCode={['Backspace', 'Delete']}
        colorMode="dark"
        fitView
        fitViewOptions={FIT_OPTIONS}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <DotLayer />
        <Controls showInteractive={false} fitViewOptions={FIT_OPTIONS} />
      </ReactFlow>
      {empty && (
        <div className="canvas__empty">
          <p className="canvas__empty-title">Nothing here yet</p>
          <p>Drag a Source from the left, then a Server, and connect them by dragging from one dot to the other.</p>
        </div>
      )}
      <ModelMarker />
      <FirstVisitHint />
    </div>
  )
}
