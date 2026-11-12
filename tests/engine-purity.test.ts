import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Standing rule 1: the engine is pure TypeScript. It must not reach the UI
 * libraries, the DOM, wall-clock time or unseeded randomness.
 */
const engineDir = join(import.meta.dirname, '..', 'src', 'engine')

const banned: [RegExp, string][] = [
  [/from\s+['"](react|react-dom|zustand)(\/[^'"]*)?['"]/, 'imports a UI library'],
  [/from\s+['"]@xyflow\//, 'imports React Flow'],
  [/\bMath\.random\b/, 'uses Math.random (use the seeded generator)'],
  [/\bDate\.now\b|\bnew Date\b/, 'reads wall-clock time'],
  [/\bperformance\.now\b/, 'reads wall-clock time'],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\b/, 'schedules real-time callbacks'],
  [/\b(window|document|localStorage)\./, 'touches the browser'],
]

function engineFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return engineFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('engine purity', () => {
  const files = engineFiles(engineDir)

  it('finds the engine files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files.map((file) => [relative(engineDir, file), file]))('%s stays pure', (_name, file) => {
    const source = readFileSync(file, 'utf8')
    const problems = banned.filter(([pattern]) => pattern.test(source)).map(([, reason]) => reason)
    expect(problems).toEqual([])
  })
})
