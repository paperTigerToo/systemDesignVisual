import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { builtInScenarios, emptyScenario } from './builtInScenarios'
import { scenarioFromJson, scenarioFromUrlParam, scenarioToJson, scenarioToUrlParam, SHARE_PARAM, type ScenarioDocument } from './scenario'
import { deleteSavedScenario, listSavedScenarios, saveScenario, type SavedScenario } from './scenarioStorage'
import { useSimulation } from './simulationStore'

/** Forget any shared Scenario in the address bar, so reloading shows what the user chose. */
function clearShareFragment() {
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search)
}

function shareParamFromLocation(): string | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  return fragment.get(SHARE_PARAM)
}

/**
 * Open a Scenario carried in the address bar: on load, and when a share link is
 * pasted into a tab that already has the app open (only the fragment changes, so
 * the page does not reload). Without one, the default Scenario stays.
 */
export function useSharedScenarioLinks() {
  useEffect(() => {
    let latest = 0
    const openFromLocation = () => {
      const param = shareParamFromLocation()
      if (!param) return
      const attempt = ++latest
      void scenarioFromUrlParam(param).then((result) => {
        // Unmounted, or a newer link arrived while this one was decoding.
        if (attempt !== latest) return
        const { openScenario, showNotice } = useSimulation.getState()
        if (result.ok) {
          openScenario(result.scenario, { play: true })
        } else {
          clearShareFragment()
          showNotice(`This share link could not be opened. ${result.error}`, 'error')
        }
      })
    }
    openFromLocation()
    // The app's own replaceState calls do not fire this, only navigation by the user.
    window.addEventListener('hashchange', openFromLocation)
    return () => {
      latest++
      window.removeEventListener('hashchange', openFromLocation)
    }
  }, [])
}

function fileName(scenario: ScenarioDocument): string {
  const slug = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${slug || 'scenario'}.json`
}

/** Open built-in and saved Scenarios; save, share, export and import the open one. */
export function ScenarioMenu() {
  const scenarioName = useSimulation((state) => state.scenarioName)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<SavedScenario[]>([])
  const [saveName, setSaveName] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setSaved(listSavedScenarios())
    setSaveName(useSimulation.getState().scenarioName)
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openScenario = (scenario: ScenarioDocument, play: boolean) => {
    clearShareFragment()
    useSimulation.getState().openScenario(scenario, { play })
    setOpen(false)
  }

  const save = () => {
    const name = saveName.trim()
    if (!name) return
    const { setScenarioName, currentScenario, showNotice } = useSimulation.getState()
    setScenarioName(name)
    if (saveScenario(currentScenario())) {
      showNotice(`Saved "${name}" in this browser.`)
      setSaved(listSavedScenarios())
    } else {
      showNotice('This browser would not let the Scenario be saved. Export it as a file instead.', 'error')
    }
  }

  const remove = (name: string) => {
    if (!deleteSavedScenario(name)) useSimulation.getState().showNotice('This browser would not let the Scenario be deleted.', 'error')
    setSaved(listSavedScenarios())
  }

  const share = async () => {
    setOpen(false)
    const { currentScenario, showNotice } = useSimulation.getState()
    const param = await scenarioToUrlParam(currentScenario())
    const url = `${window.location.origin}${window.location.pathname}#${SHARE_PARAM}=${param}`
    history.replaceState(null, '', url)
    try {
      await navigator.clipboard.writeText(url)
      showNotice('Share link copied. It holds the whole Scenario, including every recorded change.')
    } catch {
      showNotice('Share link is in the address bar; copy it from there.')
    }
  }

  const exportJson = () => {
    setOpen(false)
    const scenario = useSimulation.getState().currentScenario()
    const url = URL.createObjectURL(new Blob([scenarioToJson(scenario)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName(scenario)
    link.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setOpen(false)
    const result = scenarioFromJson(await file.text())
    if (result.ok) openScenario(result.scenario, true)
    else useSimulation.getState().showNotice(`${file.name} could not be opened: ${result.error}`, 'error')
  }

  return (
    <div className="scenario-menu" ref={root}>
      <button
        type="button"
        className="scenario-menu__button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="scenario-menu__label">Scenario</span>
        <span className="scenario-menu__name">{scenarioName}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="scenario-menu__panel">
          <h2 className="panel__title">Built in</h2>
          <ul className="scenario-menu__list">
            {builtInScenarios.map((scenario) => (
              <li key={scenario.name}>
                <button type="button" className="scenario-menu__item" onClick={() => openScenario(scenario, true)}>
                  {scenario.name}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="scenario-menu__item" onClick={() => openScenario(emptyScenario, false)}>
                {emptyScenario.name}
              </button>
            </li>
          </ul>

          <h2 className="panel__title panel__title--spaced">Saved in this browser</h2>
          {saved.length === 0 ? (
            <p className="panel__hint">Nothing saved yet.</p>
          ) : (
            <ul className="scenario-menu__list">
              {saved.map(({ scenario }) => (
                <li key={scenario.name} className="scenario-menu__saved">
                  <button type="button" className="scenario-menu__item" onClick={() => openScenario(scenario, true)}>
                    {scenario.name}
                  </button>
                  <button
                    type="button"
                    className="scenario-menu__delete"
                    aria-label={`Delete saved Scenario ${scenario.name}`}
                    onClick={() => remove(scenario.name)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="scenario-menu__save"
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            <input
              type="text"
              aria-label="Name to save as"
              value={saveName}
              maxLength={120}
              onChange={(event) => setSaveName(event.target.value)}
            />
            <button type="submit" className="toolbar__button toolbar__button--quiet" disabled={!saveName.trim()}>
              Save
            </button>
          </form>

          <h2 className="panel__title panel__title--spaced">Share</h2>
          <div className="scenario-menu__actions">
            <button type="button" className="scenario-menu__item" onClick={() => void share()}>
              Copy share link
            </button>
            <button type="button" className="scenario-menu__item" onClick={exportJson}>
              Export as JSON file
            </button>
            <button type="button" className="scenario-menu__item" onClick={() => fileInput.current?.click()}>
              Import JSON file…
            </button>
          </div>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void importJson(event)}
      />
    </div>
  )
}

/** The seed of the open Scenario; changing it restarts the Run from time zero. */
export function SeedControl() {
  const seed = useSimulation((state) => state.startDesign.seed)
  const setSeed = useSimulation((state) => state.setSeed)
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (text: string) => {
    setDraft(null)
    const value = Number(text)
    if (text.trim() === '' || !Number.isInteger(value) || value < 0 || value > 0xffffffff || value === seed) return
    setSeed(value)
  }

  return (
    <div className="seed">
      <label className="seed__field">
        <span>Seed</span>
        <input
          type="number"
          min={0}
          step={1}
          value={draft ?? String(seed)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit((event.target as HTMLInputElement).value)
          }}
        />
      </label>
      <button
        type="button"
        className="seed__random"
        title="Restart with a new random seed"
        aria-label="Restart with a new random seed"
        onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
      >
        ↻
      </button>
    </div>
  )
}
