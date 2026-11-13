import type { Architecture, ComponentId, ComponentSpec, Intervention, TimedIntervention } from '../engine'
import { settingFields, type Design, type Placement, type SettingField } from './design'

/**
 * A Scenario as saved, exported and shared: the starting architecture with
 * where each Component sits, the seed, and the recorded Interventions.
 * Versioned so later formats can still read old files and links.
 */
export interface ScenarioDocument {
  format: typeof SCENARIO_FORMAT
  version: typeof SCENARIO_VERSION
  name: string
  seed: number
  architecture: Architecture
  /**
   * Position and name of every Component in the Run: those at time zero and
   * those added by an Intervention.
   */
  layout: Record<ComponentId, Placement>
  /** In the order they were made; times never go backwards. */
  interventions: TimedIntervention[]
}

export const SCENARIO_FORMAT = 'system-design-simulator/scenario'
export const SCENARIO_VERSION = 1

/** The starting Design of a Scenario: only the Components present at time zero. */
export function startingDesign(scenario: ScenarioDocument): Design {
  const layout: Record<ComponentId, Placement> = {}
  for (const component of scenario.architecture.components) {
    layout[component.id] = scenario.layout[component.id] ?? { x: 0, y: 0, label: component.id }
  }
  return { seed: scenario.seed, architecture: scenario.architecture, layout }
}

export type ParseResult = { ok: true; scenario: ScenarioDocument } | { ok: false; error: string }

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function finiteNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where} must be a number.`)
  return value
}

function text(value: unknown, where: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.length > maxLength) fail(`${where} must be text.`)
  return value
}

function id(value: unknown, where: string): ComponentId {
  const result = text(value, where, 80)
  if (result === '') fail(`${where} must not be empty.`)
  return result
}

/** Check one setting against the same limits the settings panel enforces. */
function setting(field: SettingField, value: unknown, where: string): number {
  const { key } = field
  const number = finiteNumber(value, `${where} ${key}`)
  const stored = { min: field.min / field.scale, max: field.max / field.scale }
  if (number < stored.min || number > stored.max) fail(`${where} ${key} must be between ${stored.min} and ${stored.max}.`)
  if (field.whole && !Number.isInteger(number)) fail(`${where} ${key} must be a whole number.`)
  return number
}

function component(value: unknown, where: string): ComponentSpec {
  if (!isObject(value)) fail(`${where} must be an object.`)
  const componentId = id(value.id, `${where} id`)
  const kind = value.kind
  if (kind !== 'source' && kind !== 'server' && kind !== 'database' && kind !== 'queue') {
    fail(`${where} has an unknown kind.`)
  }
  const label = `${where} (${componentId})`
  const settings: Record<string, number> = {}
  for (const field of settingFields[kind]) settings[field.key] = setting(field, value[field.key], label)
  return { kind, id: componentId, ...settings } as ComponentSpec
}

function placement(value: unknown, where: string): Placement {
  if (!isObject(value)) fail(`${where} must be an object.`)
  return { x: finiteNumber(value.x, `${where} x`), y: finiteNumber(value.y, `${where} y`), label: text(value.label, `${where} label`, 80) }
}

function intervention(value: unknown, where: string, kinds: Map<ComponentId, ComponentSpec['kind']>): Intervention {
  if (!isObject(value)) fail(`${where} must be an object.`)
  switch (value.kind) {
    case 'kill':
    case 'revive':
    case 'removeComponent':
      return { kind: value.kind, componentId: id(value.componentId, `${where} componentId`) }
    case 'setSetting': {
      const componentId = id(value.componentId, `${where} componentId`)
      const kind = kinds.get(componentId) ?? fail(`${where} changes ${componentId}, which is never added.`)
      const key = text(value.key, `${where} key`)
      const field = settingFields[kind].find((f) => f.key === key) ?? fail(`${where}: a ${kind} has no setting "${key}".`)
      return { kind: 'setSetting', componentId, key: field.key, value: setting(field, value.value, where) }
    }
    case 'addComponent':
      return { kind: 'addComponent', component: component(value.component, `${where} component`) }
    case 'addConnection':
    case 'removeConnection':
      return { kind: value.kind, from: id(value.from, `${where} from`), to: id(value.to, `${where} to`) }
    default:
      fail(`${where} has an unknown kind.`)
  }
}

function parseOrThrow(value: unknown): ScenarioDocument {
  if (!isObject(value)) fail('A Scenario must be a JSON object.')
  if (value.format !== SCENARIO_FORMAT) fail('This is not a Scenario file.')
  if (value.version !== SCENARIO_VERSION) fail(`Scenario version ${String(value.version)} is not supported.`)
  const name = text(value.name, 'The name', 120)
  const seed = finiteNumber(value.seed, 'The seed')
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) fail('The seed must be a whole number from 0 to 4294967295.')

  if (!isObject(value.architecture)) fail('The architecture is missing.')
  const { components: rawComponents, connections: rawConnections } = value.architecture
  if (!Array.isArray(rawComponents) || !Array.isArray(rawConnections)) fail('The architecture must list Components and Connections.')
  const components = rawComponents.map((c, i) => component(c, `Component ${i + 1}`))
  const kinds = new Map<ComponentId, ComponentSpec['kind']>()
  for (const c of components) {
    if (kinds.has(c.id)) fail(`Two Components share the id ${c.id}.`)
    kinds.set(c.id, c.kind)
  }
  const connections = rawConnections.map((c, i) => {
    if (!isObject(c)) fail(`Connection ${i + 1} must be an object.`)
    const from = id(c.from, `Connection ${i + 1} from`)
    const to = id(c.to, `Connection ${i + 1} to`)
    if (!kinds.has(from) || !kinds.has(to)) fail(`Connection ${i + 1} names a Component that does not exist.`)
    return { from, to }
  })

  if (!Array.isArray(value.interventions)) fail('The list of Interventions is missing.')
  let previousTime = 0
  const interventions = value.interventions.map((entry, i): TimedIntervention => {
    const where = `Intervention ${i + 1}`
    if (!isObject(entry)) fail(`${where} must be an object.`)
    const time = finiteNumber(entry.time, `${where} time`)
    if (time < previousTime) fail(`${where} happens before the one listed ahead of it.`)
    previousTime = time
    const parsed = intervention(entry.intervention, where, kinds)
    if (parsed.kind === 'addComponent') kinds.set(parsed.component.id, parsed.component.kind)
    return { time, intervention: parsed }
  })

  if (!isObject(value.layout)) fail('The layout is missing.')
  const layout: Record<ComponentId, Placement> = {}
  for (const componentId of kinds.keys()) {
    const entry = value.layout[componentId]
    if (entry === undefined) fail(`The layout has no position for ${componentId}.`)
    layout[componentId] = placement(entry, `The position of ${componentId}`)
  }

  return {
    format: SCENARIO_FORMAT,
    version: SCENARIO_VERSION,
    name,
    seed,
    architecture: { components, connections },
    layout,
    interventions,
  }
}

/**
 * Check something read from a file, a link or browser storage before using it.
 * Settings must be within the limits the settings panel allows. Architecture
 * problems (such as an unconnected Server) are allowed, as in the editor;
 * Interventions that turn out not to apply stop the replay with a message.
 */
export function parseScenario(value: unknown): ParseResult {
  try {
    return { ok: true, scenario: parseOrThrow(value) }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message }
    throw error
  }
}

export function scenarioToJson(scenario: ScenarioDocument): string {
  return JSON.stringify(scenario, null, 2)
}

export function scenarioFromJson(json: string): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }
  return parseScenario(value)
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const output = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(output).arrayBuffer())
}

/** The whole Scenario, compressed, as text safe to put in a URL. */
export async function scenarioToUrlParam(scenario: ScenarioDocument): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(scenario))
  return toBase64Url(await transform(json, new CompressionStream('deflate-raw')))
}

export async function scenarioFromUrlParam(param: string): Promise<ParseResult> {
  let json: string
  try {
    json = new TextDecoder().decode(await transform(fromBase64Url(param), new DecompressionStream('deflate-raw')))
  } catch {
    return { ok: false, error: 'The link is damaged or incomplete.' }
  }
  return scenarioFromJson(json)
}

/** The URL fragment key that carries a shared Scenario. */
export const SHARE_PARAM = 'scenario'
