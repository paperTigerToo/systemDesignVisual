import type { Architecture, ComponentId, ComponentSpec, Scenario } from '../engine'

/** Where a Component sits on the canvas and what the user calls it. Not part of the engine's Scenario. */
export interface Placement {
  x: number
  y: number
  label: string
}

/** What the editor edits: an architecture, its seed, and how it is laid out. */
export interface Design {
  seed: number
  architecture: Architecture
  layout: Record<ComponentId, Placement>
}

export type ComponentKind = ComponentSpec['kind']

export const kindLabel: Record<ComponentKind, string> = {
  source: 'Source',
  server: 'Server',
  database: 'Database',
  queue: 'Queue',
}

/** Settings a newly added Component starts with. */
export function defaultSpec(kind: ComponentKind, id: ComponentId): ComponentSpec {
  switch (kind) {
    case 'source':
      return { kind, id, rate: 10, timeLimit: 2 }
    case 'server':
      return { kind, id, concurrency: 4, workTime: 0.1, backlogCapacity: 50 }
    case 'database':
      return { kind, id, concurrency: 4, workTime: 0.05, backlogCapacity: 50 }
    case 'queue':
      return { kind, id, capacity: 100 }
  }
}

/** A numeric setting the settings panel can edit, with its limits. */
export interface SettingField {
  key: string
  label: string
  /** Shown next to the input; the stored value is multiplied by `scale` for display. */
  unit: string
  scale: number
  min: number
  max: number
  step: number
  whole: boolean
}

export const settingFields: Record<ComponentKind, SettingField[]> = {
  source: [
    { key: 'rate', label: 'Rate', unit: 'req/s', scale: 1, min: 0, max: 2000, step: 1, whole: false },
    { key: 'timeLimit', label: 'Time limit', unit: 's', scale: 1, min: 0.05, max: 120, step: 0.1, whole: false },
  ],
  server: [
    { key: 'concurrency', label: 'Concurrency', unit: 'slots', scale: 1, min: 1, max: 500, step: 1, whole: true },
    { key: 'workTime', label: 'Work time', unit: 'ms', scale: 1000, min: 1, max: 60_000, step: 5, whole: false },
    { key: 'backlogCapacity', label: 'Backlog capacity', unit: 'req', scale: 1, min: 0, max: 100_000, step: 1, whole: true },
  ],
  database: [
    { key: 'concurrency', label: 'Concurrency', unit: 'slots', scale: 1, min: 1, max: 500, step: 1, whole: true },
    { key: 'workTime', label: 'Work time', unit: 'ms', scale: 1000, min: 1, max: 60_000, step: 5, whole: false },
    { key: 'backlogCapacity', label: 'Backlog capacity', unit: 'req', scale: 1, min: 0, max: 100_000, step: 1, whole: true },
  ],
  queue: [{ key: 'capacity', label: 'Capacity', unit: 'req', scale: 1, min: 1, max: 1_000_000, step: 1, whole: true }],
}

/** Bring a displayed value back to a stored one, within the field's limits. */
export function clampSetting(field: SettingField, displayed: number): number {
  const clamped = Math.min(Math.max(displayed, field.min), field.max)
  const stored = field.whole ? Math.round(clamped) : clamped
  return stored / field.scale
}

export function toScenario(design: Design): Scenario {
  return { seed: design.seed, architecture: design.architecture }
}

function nextId(design: Design, kind: ComponentKind): ComponentId {
  const taken = new Set(design.architecture.components.map((c) => c.id))
  for (let n = 1; ; n++) {
    const id = `${kind}-${n}`
    if (!taken.has(id)) return id
  }
}

function nextLabel(design: Design, kind: ComponentKind): string {
  const count = design.architecture.components.filter((c) => c.kind === kind).length
  return `${kindLabel[kind]} ${count + 1}`
}

export function addComponent(design: Design, kind: ComponentKind, position: { x: number; y: number }) {
  const id = nextId(design, kind)
  const next: Design = {
    ...design,
    architecture: { ...design.architecture, components: [...design.architecture.components, defaultSpec(kind, id)] },
    layout: { ...design.layout, [id]: { ...position, label: nextLabel(design, kind) } },
  }
  return { design: next, id }
}

export function removeComponent(design: Design, id: ComponentId): Design {
  const { [id]: _removed, ...layout } = design.layout
  return {
    ...design,
    architecture: {
      components: design.architecture.components.filter((c) => c.id !== id),
      connections: design.architecture.connections.filter((c) => c.from !== id && c.to !== id),
    },
    layout,
  }
}

export function moveComponent(design: Design, id: ComponentId, position: { x: number; y: number }): Design {
  const placement = design.layout[id]
  if (!placement) return design
  return { ...design, layout: { ...design.layout, [id]: { ...placement, ...position } } }
}

export function renameComponent(design: Design, id: ComponentId, label: string): Design {
  const placement = design.layout[id]
  if (!placement) return design
  return { ...design, layout: { ...design.layout, [id]: { ...placement, label } } }
}

export function updateSetting(design: Design, id: ComponentId, key: string, value: number): Design {
  return {
    ...design,
    architecture: {
      ...design.architecture,
      components: design.architecture.components.map((c) => (c.id === id ? ({ ...c, [key]: value } as ComponentSpec) : c)),
    },
  }
}

/**
 * Add a Connection. A Component connecting to itself, or a Connection that
 * already exists, is refused outright rather than left for validation.
 */
export function addConnection(design: Design, from: ComponentId, to: ComponentId): Design {
  const exists = design.architecture.connections.some((c) => c.from === from && c.to === to)
  if (from === to || exists) return design
  return {
    ...design,
    architecture: { ...design.architecture, connections: [...design.architecture.connections, { from, to }] },
  }
}

export function removeConnection(design: Design, from: ComponentId, to: ComponentId): Design {
  return {
    ...design,
    architecture: {
      ...design.architecture,
      connections: design.architecture.connections.filter((c) => !(c.from === from && c.to === to)),
    },
  }
}

export const connectionId = (from: ComponentId, to: ComponentId) => `${from}->${to}`

/**
 * What the app opens on: one Source, one Server, one Database. Each Server slot
 * is held for about 0.1 s of its own work plus 0.05 s on the Database, so the
 * Server manages about 26 Requests per second and the Database 40.
 */
export const starterDesign: Design = {
  seed: 1,
  architecture: {
    components: [
      { kind: 'source', id: 'source-1', rate: 10, timeLimit: 2 },
      { kind: 'server', id: 'server-1', concurrency: 4, workTime: 0.1, backlogCapacity: 50 },
      { kind: 'database', id: 'database-1', concurrency: 2, workTime: 0.05, backlogCapacity: 50 },
    ],
    connections: [
      { from: 'source-1', to: 'server-1' },
      { from: 'server-1', to: 'database-1' },
    ],
  },
  layout: {
    'source-1': { x: 0, y: 0, label: 'Traffic' },
    'server-1': { x: 320, y: 0, label: 'Web server' },
    'database-1': { x: 640, y: 0, label: 'Database' },
  },
}
