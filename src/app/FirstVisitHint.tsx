import { useState } from 'react'
import type { SourceSpec } from '../engine'
import { moreServersDidNotFixIt, oneServerDown } from './builtInScenarios'
import { clampSetting, settingFields } from './design'
import { useSimulation } from './simulationStore'

const rateField = settingFields.source.find((field) => field.key === 'rate')!
const DISMISSED_KEY = 'system-design-simulator.first-visit-hint-dismissed'

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Storage blocked: the hint simply comes back next visit.
  }
}

/**
 * Shown on a first visit over the default Scenario: one-click ways to break it,
 * so a visitor sees the consequences straight away.
 */
export function FirstVisitHint() {
  const [dismissed, setDismissed] = useState(wasDismissed)
  const onDefault = useSimulation((state) => state.scenarioName === moreServersDidNotFixIt.name)
  const traffic = useSimulation((state) =>
    state.design.architecture.components.find((c): c is SourceSpec => c.kind === 'source' && c.id === 'traffic'),
  )
  const database = useSimulation((state) => state.readout.snapshot.components['database'])
  if (dismissed || !onDefault) return null

  const dismiss = () => {
    rememberDismissed()
    setDismissed(true)
  }
  const store = useSimulation.getState

  return (
    <aside className="first-visit" aria-label="Ways to try it">
      <div className="first-visit__header">
        <p className="first-visit__title">Break it in one click</p>
        <button type="button" className="first-visit__close" onClick={dismiss} aria-label="Hide these suggestions">
          ×
        </button>
      </div>
      <p className="first-visit__text">The Database is the limit, so the Web server added at 8 s changes nothing. Now try:</p>
      <div className="first-visit__actions">
        {traffic && (
          <button type="button" className="first-visit__action" onClick={() => store().updateSetting('traffic', 'rate', clampSetting(rateField, traffic.rate * 2))}>
            Double the traffic
          </button>
        )}
        {database && database.kind === 'database' && !database.killed && (
          <button
            type="button"
            className="first-visit__action"
            onClick={() => store().applyIntervention({ kind: 'kill', componentId: 'database' })}
          >
            Kill the Database
          </button>
        )}
        <button type="button" className="first-visit__action" onClick={() => store().openScenario(oneServerDown, { play: true })}>
          Open “One server down”
        </button>
      </div>
    </aside>
  )
}
