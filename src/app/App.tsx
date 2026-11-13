import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Canvas } from './Canvas'
import { MetricsPanel } from './MetricsPanel'
import { Palette } from './Palette'
import { ScenarioMenu, SeedControl, useSharedScenarioLinks } from './ScenarioMenu'
import { SettingsPanel } from './SettingsPanel'
import { hasStarted, playBlocked, SPEEDS, useSimulation } from './simulationStore'
import { usePlaybackLoop } from './usePlaybackLoop'
import './styles.css'

/** Whether recorded Interventions are still being replayed, or the Run is the user's own. */
function RunStatus() {
  const toCome = useSimulation((state) => state.pending.length)
  const changes = useSimulation((state) => state.interventions.length)
  if (toCome > 0) {
    return (
      <span className="run-status run-status--replay" role="status" title="Any change you make stops the replay and continues live.">
        <span className="run-status__mark" aria-hidden="true">▶▶</span>
        Replaying · {toCome} recorded {toCome === 1 ? 'change' : 'changes'} to come
      </span>
    )
  }
  return (
    <span className="run-status" role="status">
      <span className="run-status__mark run-status__mark--live" aria-hidden="true" />
      Live{changes > 0 ? ` · ${changes} ${changes === 1 ? 'change' : 'changes'} recorded` : ''}
    </span>
  )
}

/** Why the last edit was refused, or confirmation that something worked. */
function Notice() {
  const notice = useSimulation((state) => state.notice)
  const dismiss = useSimulation((state) => state.dismissNotice)
  if (!notice) return null
  return (
    <div className={`notice notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
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
  // The throttled readout, not the per-frame snapshot: the clock shows tenths of a second,
  // so redrawing the toolbar every frame would buy nothing.
  const time = useSimulation((state) => state.readout.snapshot.time)
  const started = useSimulation(hasStarted)
  const blocked = useSimulation(playBlocked)

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
      <RunStatus />
      <div className="toolbar__end">
        <ScenarioMenu />
        <SeedControl />
      </div>
    </header>
  )
}

export function App() {
  usePlaybackLoop()
  useSharedScenarioLinks()
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
