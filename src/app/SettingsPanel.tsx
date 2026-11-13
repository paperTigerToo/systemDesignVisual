import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ComponentSpec } from '../engine'
import { clampSetting, kindLabel, settingFields, settingValue, type SettingField } from './design'
import { hasStarted, useSimulation } from './simulationStore'

function NumberSetting({ component, field }: { component: ComponentSpec; field: SettingField }) {
  const stored = settingValue(component, field.key) ?? 0
  const displayed = Number((stored * field.scale).toFixed(6))
  // Keep what the user is typing until it is a usable number; snap to limits on blur.
  const [draft, setDraft] = useState<string | null>(null)
  const updateSetting = useSimulation((state) => state.updateSetting)

  const commit = (text: string, final: boolean) => {
    const value = Number(text)
    if (text.trim() === '' || !Number.isFinite(value)) {
      if (final) setDraft(null)
      return
    }
    const next = clampSetting(field, value)
    if (next !== stored) updateSetting(component.id, field.key, next)
    if (final) setDraft(null)
  }

  return (
    <label className="setting">
      <span className="setting__label">{field.label}</span>
      <span className="setting__input">
        <input
          type="number"
          inputMode="decimal"
          min={field.min}
          max={field.max}
          step={field.step}
          value={draft ?? String(displayed)}
          onChange={(event) => {
            setDraft(event.target.value)
            // Before the Run starts, apply as you type. During a Run each change is a recorded
            // Intervention, so wait for Enter or leaving the field rather than recording every keystroke.
            if (hasStarted(useSimulation.getState())) return
            const value = Number(event.target.value)
            if (event.target.value.trim() !== '' && value >= field.min && value <= field.max) commit(event.target.value, false)
          }}
          onBlur={(event) => commit(event.target.value, true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit((event.target as HTMLInputElement).value, true)
          }}
        />
        <span className="setting__unit">{field.unit}</span>
      </span>
    </label>
  )
}

function ComponentSettings({ component }: { component: ComponentSpec }) {
  const label = useSimulation((state) => state.design.layout[component.id]?.label ?? component.id)
  const renameComponent = useSimulation((state) => state.renameComponent)
  const removeComponent = useSimulation((state) => state.removeComponent)
  const problems = useSimulation(useShallow((state) => state.problems.filter((p) => p.componentId === component.id)))

  return (
    <section className="settings">
      <div className="settings__kind">{kindLabel[component.kind]}</div>
      <label className="setting">
        <span className="setting__label">Name</span>
        <input
          className="setting__text"
          type="text"
          value={label}
          maxLength={40}
          onChange={(event) => renameComponent(component.id, event.target.value)}
        />
      </label>
      {settingFields[component.kind].map((field) => (
        <NumberSetting key={`${component.id}:${field.key}`} component={component} field={field} />
      ))}
      {problems.length > 0 && (
        <ul className="problems problems--inline">
          {problems.map((problem, index) => (
            <li key={index}>{problem.message}</li>
          ))}
        </ul>
      )}
      <button type="button" className="danger-button" onClick={() => removeComponent(component.id)}>
        Delete {kindLabel[component.kind]}
      </button>
    </section>
  )
}

function ConnectionSettings({ from, to }: { from: string; to: string }) {
  const fromLabel = useSimulation((state) => state.design.layout[from]?.label ?? from)
  const toLabel = useSimulation((state) => state.design.layout[to]?.label ?? to)
  const removeConnection = useSimulation((state) => state.removeConnection)
  return (
    <section className="settings">
      <div className="settings__kind">Connection</div>
      <p className="settings__text">
        {fromLabel} → {toLabel}
      </p>
      <button type="button" className="danger-button" onClick={() => removeConnection(from, to)}>
        Delete Connection
      </button>
    </section>
  )
}

function ProblemList() {
  const problems = useSimulation((state) => state.problems)
  const layout = useSimulation((state) => state.design.layout)
  const select = useSimulation((state) => state.select)

  if (problems.length === 0) {
    return <p className="problems__ok">Architecture is valid. Press Play.</p>
  }
  const nameOf = (id: string) => layout[id]?.label ?? id
  return (
    <ul className="problems">
      {problems.map((problem, index) => {
        const where = problem.componentId
          ? nameOf(problem.componentId)
          : problem.connection
            ? `${nameOf(problem.connection.from)} → ${nameOf(problem.connection.to)}`
            : null
        const target = problem.componentId
          ? ({ kind: 'component', id: problem.componentId } as const)
          : problem.connection
            ? ({ kind: 'connection', ...problem.connection } as const)
            : null
        return (
          <li key={index}>
            {where && target ? (
              <button type="button" className="problems__where" onClick={() => select(target)}>
                {where}
              </button>
            ) : null}
            <span>{problem.message}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Settings for whatever is selected, and the list of problems blocking Play. */
export function SettingsPanel() {
  const started = useSimulation(hasStarted)
  const selection = useSimulation((state) => state.selection)
  const component = useSimulation((state) => {
    const selected = state.selection
    return selected?.kind === 'component'
      ? state.design.architecture.components.find((c) => c.id === selected.id)
      : undefined
  })
  const problemCount = useSimulation((state) => state.problems.length)

  return (
    <aside className="side-panel" aria-label="Settings">
      <h2 className="panel__title">Settings</h2>
      {component ? (
        <ComponentSettings key={component.id} component={component} />
      ) : selection?.kind === 'connection' ? (
        <ConnectionSettings from={selection.from} to={selection.to} />
      ) : (
        <p className="panel__hint">Select a Component or Connection to change it. Drag from a dot on a Component's right edge to connect it.</p>
      )}
      <h2 className="panel__title panel__title--spaced">
        Problems {problemCount > 0 && <span className="badge">{problemCount}</span>}
      </h2>
      <ProblemList />
      <p className="panel__hint panel__hint--footer">
        {started
          ? 'The Run is under way: changes apply live and are recorded. Press Enter to apply a number.'
          : 'Changes before the Run starts set up the starting architecture.'}
      </p>
    </aside>
  )
}
