import { parseScenario, type ScenarioDocument } from './scenario'

/** Browser storage key for Scenarios the user saved. */
const STORAGE_KEY = 'system-design-simulator.saved-scenarios'

export interface SavedScenario {
  scenario: ScenarioDocument
  /** Milliseconds since 1970, from the browser clock, for ordering only. */
  savedAt: number
}

/**
 * Scenarios saved in this browser, newest first. Anything unreadable is
 * skipped, and an empty list is returned if storage is unavailable.
 */
export function listSavedScenarios(): SavedScenario[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let entries: unknown
  try {
    entries = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []
  const saved: SavedScenario[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const { scenario, savedAt } = entry as { scenario?: unknown; savedAt?: unknown }
    const parsed = parseScenario(scenario)
    if (parsed.ok && typeof savedAt === 'number') saved.push({ scenario: parsed.scenario, savedAt })
  }
  return saved.sort((a, b) => b.savedAt - a.savedAt)
}

function write(saved: SavedScenario[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    return true
  } catch {
    return false
  }
}

/** Save under the Scenario's name, replacing any saved Scenario of the same name. Returns false if storage failed. */
export function saveScenario(scenario: ScenarioDocument): boolean {
  const others = listSavedScenarios().filter((s) => s.scenario.name !== scenario.name)
  return write([{ scenario, savedAt: Date.now() }, ...others])
}

/** Returns false if storage failed. */
export function deleteSavedScenario(name: string): boolean {
  return write(listSavedScenarios().filter((s) => s.scenario.name !== name))
}
