import { Background, ReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { defaultPositions, defaultScenario } from './defaultScenario'
import { edgeTypes } from './ConnectionEdge'
import { nodeTypes, type ComponentNode } from './nodes'
import { useSimulation } from './simulationStore'
import { usePlaybackLoop } from './usePlaybackLoop'
import './styles.css'

const nodes: ComponentNode[] = defaultScenario.architecture.components.map((component) => ({
  id: component.id,
  type: component.kind,
  position: defaultPositions[component.id] ?? { x: 0, y: 0 },
  data: { label: component.kind === 'source' ? 'Traffic' : 'Web server' },
}))

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
