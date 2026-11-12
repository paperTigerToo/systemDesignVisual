import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Canvas } from './Canvas'
import { examples } from './demoArchitectures'
import { starterDesign } from './design'
import { Palette } from './Palette'
import { SettingsPanel } from './SettingsPanel'
import { useSimulation } from './simulationStore'
import { usePlaybackLoop } from './usePlaybackLoop'
import './styles.css'

const starter = { name: 'Starter: Source, Server, Database', design: starterDesign }
const empty = { name: 'Empty canvas', design: { seed: 1, architecture: { components: [], connections: [] }, layout: {} } }
const designs = [starter, ...examples, empty]

function Toolbar() {
  const playing = useSimulation((state) => state.playing)
  const togglePlaying = useSimulation((state) => state.togglePlaying)
  const time = useSimulation((state) => state.snapshot.time)
  const blocked = useSimulation((state) => state.problems.length > 0)
  const loadDesign = useSimulation((state) => state.loadDesign)

  return (
    <header className="toolbar">
      <h1 className="toolbar__title">System Design Simulator</h1>
      <button
        type="button"
        className="toolbar__button"
        onClick={togglePlaying}
        disabled={!playing && blocked}
        title={!playing && blocked ? 'Fix the problems listed on the right first' : undefined}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <span className="toolbar__clock">t = {time.toFixed(1)} s</span>
      {/* Ticket 09 replaces this with the Scenario menu. */}
      <label className="toolbar__picker">
        <span>Load</span>
        <select
          value=""
          onChange={(event) => {
            const chosen = designs[Number(event.target.value)]
            if (chosen) loadDesign(chosen.design)
          }}
        >
          <option value="" disabled>
            Choose an architecture…
          </option>
          {designs.map((entry, index) => (
            <option key={entry.name} value={index}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
    </header>
  )
}

export function App() {
  usePlaybackLoop()
  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <div className="workspace">
          <Palette />
          <Canvas />
          <SettingsPanel />
        </div>
      </div>
    </ReactFlowProvider>
  )
}
