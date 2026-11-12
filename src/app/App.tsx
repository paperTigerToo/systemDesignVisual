import { Background, ReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { defaultLayout, defaultScenario } from './defaultScenario'
import { edgeTypes } from './ConnectionEdge'
import { nodeTypes, type ComponentNode } from './nodes'
import { useSimulation } from './simulationStore'
import { usePlaybackLoop } from './usePlaybackLoop'
import './styles.css'

const nodes: ComponentNode[] = defaultScenario.architecture.components.map((component) => {
  const layout = defaultLayout[component.id]
  return {
    id: component.id,
    type: component.kind,
    position: { x: layout?.x ?? 0, y: layout?.y ?? 0 },
    data: { label: layout?.label ?? component.id },
    // React Flow turns off pointer events on nodes that are not draggable, selectable or
    // connectable, which would swallow clicks on the Kill button.
    style: { pointerEvents: 'all' },
  }
})

const edges: Edge[] = defaultScenario.architecture.connections.map((connection) => ({
  id: `${connection.from}->${connection.to}`,
  source: connection.from,
  target: connection.to,
  type: 'connection',
}))

export function App() {
  usePlaybackLoop()
  const playing = useSimulation((state) => state.playing)
  const togglePlaying = useSimulation((state) => state.togglePlaying)
  const time = useSimulation((state) => state.snapshot.time)

  return (
    <div className="app">
      <header className="toolbar">
        <h1 className="toolbar__title">System Design Simulator</h1>
        <button type="button" className="toolbar__button" onClick={togglePlaying}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="toolbar__clock">t = {time.toFixed(1)} s</span>
      </header>
      <main className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.4 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
        </ReactFlow>
      </main>
    </div>
  )
}
