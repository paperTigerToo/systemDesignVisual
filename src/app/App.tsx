import { Background, ReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { edgeTypes } from './ConnectionEdge'
import { demoArchitectures, type DemoArchitecture } from './demoArchitectures'
import { nodeTypes, type ComponentNode } from './nodes'
import { useSimulation } from './simulationStore'
import { usePlaybackLoop } from './usePlaybackLoop'
import './styles.css'

function toFlow(demo: DemoArchitecture): { nodes: ComponentNode[]; edges: Edge[] } {
  const { components, connections } = demo.scenario.architecture
  const nodes: ComponentNode[] = components.map((component) => {
    const layout = demo.layout[component.id]
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
  const edges: Edge[] = connections.map((connection) => ({
    id: `${connection.from}->${connection.to}`,
    source: connection.from,
    target: connection.to,
    type: 'connection',
  }))
  return { nodes, edges }
}

export function App() {
  usePlaybackLoop()
  const playing = useSimulation((state) => state.playing)
  const togglePlaying = useSimulation((state) => state.togglePlaying)
  const time = useSimulation((state) => state.snapshot.time)
  const architectureIndex = useSimulation((state) => state.architectureIndex)
  const loadArchitecture = useSimulation((state) => state.loadArchitecture)
  const { nodes, edges } = useMemo(() => toFlow(demoArchitectures[architectureIndex]!), [architectureIndex])

  return (
    <div className="app">
      <header className="toolbar">
        <h1 className="toolbar__title">System Design Simulator</h1>
        <button type="button" className="toolbar__button" onClick={togglePlaying}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="toolbar__clock">t = {time.toFixed(1)} s</span>
        {/* Temporary: replaced by the editor (ticket 06) and the Scenario menu (ticket 09). */}
        <label className="toolbar__picker">
          <span>Architecture</span>
          <select value={architectureIndex} onChange={(event) => loadArchitecture(Number(event.target.value))}>
            {demoArchitectures.map((demo, index) => (
              <option key={demo.name} value={index}>
                {demo.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main className="canvas">
        <ReactFlow
          key={architectureIndex}
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
