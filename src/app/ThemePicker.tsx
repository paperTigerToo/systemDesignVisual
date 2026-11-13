import { useState } from 'react'

/** One sober look and a handful of loud ones. Each is a set of CSS variables in styles.css, keyed by `data-theme`. */
export const themes = [
  { id: 'control-room', name: 'Control room' },
  { id: 'vaporwave', name: 'Vaporwave sunset' },
  { id: 'toxic', name: 'Toxic spill' },
  { id: 'bubblegum', name: 'Bubblegum brutalist' },
  { id: 'molten', name: 'Molten core' },
  { id: 'chrome', name: 'Y2K chrome' },
] as const

export type ThemeId = (typeof themes)[number]['id']

const STORAGE_KEY = 'system-design-simulator.theme'
const DEFAULT_THEME: ThemeId = 'control-room'

function isTheme(value: unknown): value is ThemeId {
  return themes.some((theme) => theme.id === value)
}

function storedTheme(): ThemeId {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(value) ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
}

/** Put the remembered theme on the page before the first render, so it never flashes the default. */
export function applyStoredTheme() {
  applyTheme(storedTheme())
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(storedTheme)

  const choose = (value: string) => {
    if (!isTheme(value)) return
    setTheme(value)
    applyTheme(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Storage blocked: the theme lasts until the page is reloaded.
    }
  }

  return (
    <label className="theme-picker">
      <span className="theme-picker__label">Look</span>
      <select value={theme} onChange={(event) => choose(event.target.value)}>
        {themes.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}
