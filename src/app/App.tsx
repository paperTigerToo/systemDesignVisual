import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Canvas } from './Canvas'
import { examples } from './demoArchitectures'
import { starterDesign } from './design'
import { MetricsPanel } from './MetricsPanel'
import { Palette } from './Palette'
import { SettingsPanel } from './SettingsPanel'
import { hasStarted, playBlocked, SPEEDS, useSimulation } from './simulationStore'
import { usePlaybackLoop } from './usePlaybackLoop'
import './styles.css'

const starter = { name: 'Starter: Source, Server, Database', design: starterDesign }
const empty = { name: 'Empty canvas', design: { seed: 1, architecture: { components: [], connections: [] }, layout: {} } }
const designs = [starter, ...examples, empty]

/** Why the last edit during a Run was refused. */
function Notice() {
  const notice = useSimulation((state) => state.notice)
  const dismiss = useSimulation((state) => state.dismissNotice)
  if (!notice) return null
  return (
    <div className="notice" role="alert">
      <span>{notice}</span>
      <button type="button" className="notice__dismiss" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

function Toolbar() {
  const playing = useSimulation((state) => state.playing)
  const togglePlaying = useSimulation((state) => state.togglePlaying)
  const reset = useSimulation((state) => state.reset)
  const speed = useSimulation((state) => state.speed)
  const setSpeed = useSimulation((state) => state.setSpeed)
  const behind = useSimulation((state) => state.playing && state.behind)
  const time = useSimulation((state) => state.snapshot.time)
  const started = useSimulation(hasStarted)
  const blocked = useSimulation(playBlocked)
  const changes = useSimulation((state) => state.interventions.length)
  const loadDesign = useSimulation((state) => state.loadDesign)

  return (
    <header className="toolbar">
      <h1 className="toolbar__title">System Design Simulator</h1>
      <div className="toolbar__group">
        <button
          type="button"
          className="toolbar__button"
          onClick={togglePlaying}
          disabled={!playing && blocked}
          aria-describedby={!playing && blocked ? 'play-blocked' : undefined}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="toolbar__button toolbar__button--quiet" onClick={reset} disabled={!started}>
          Reset
        </button>
        {!playing && blocked && (
          <span id="play-blocked" className="visually-hidden">
            Fix the problems listed on the right first.
          </span>
        )}
      </div>
      <div className="speed" role="group" aria-label="Speed">
        {SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            className={`speed__option${option === speed ? ' speed__option--active' : ''}`}
            aria-pressed={option === speed}
            onClick={() => setSpeed(option)}
          >
            {option}×
          </button>
        ))}
      </div>
      <span className="toolbar__clock">t = {time.toFixed(1)} s</span>
      {behind && (
        <span className="toolbar__behind" role="status">
          Running behind
        </span>
      )}
      {changes > 0 && (
        <span className="toolbar__changes">
          {changes} {changes === 1 ? 'change' : 'changes'} recorded
        </span>
      )}
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
        <Notice />
        <div className="workspace">
          <Palette />
          <Canvas />
          <SettingsPanel />
        </div>
        <MetricsPanel />
      </div>
    </ReactFlowProvider>
  )
}
