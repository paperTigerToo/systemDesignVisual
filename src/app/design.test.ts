import { describe, expect, it } from 'vitest'
import { validateArchitecture } from '../engine'
import {
  addComponent,
  addConnection,
  clampSetting,
  removeComponent,
  settingFields,
  starterDesign,
  updateSetting,
} from './design'

describe('editing a Design', () => {
  it('starts valid', () => {
    expect(validateArchitecture(starterDesign.architecture)).toEqual([])
  })

  it('adds Components with unique ids and default settings', () => {
    const first = addComponent(starterDesign, 'server', { x: 1, y: 2 })
    const second = addComponent(first.design, 'server', { x: 3, y: 4 })
    expect(first.id).toBe('server-2')
    expect(second.id).toBe('server-3')
    expect(second.design.layout['server-3']).toEqual({ x: 3, y: 4, label: 'Server 3' })
    expect(second.design.architecture.components.find((c) => c.id === 'server-3')).toMatchObject({
      kind: 'server',
      concurrency: 4,
    })
  })

  it('removes a Component together with its Connections and placement', () => {
    const design = removeComponent(starterDesign, 'server-1')
    expect(design.architecture.components.map((c) => c.id)).toEqual(['source-1', 'database-1'])
    expect(design.architecture.connections).toEqual([])
    expect(design.layout['server-1']).toBeUndefined()
  })

  it('refuses a Connection to itself or one that already exists', () => {
    expect(addConnection(starterDesign, 'server-1', 'server-1')).toBe(starterDesign)
    expect(addConnection(starterDesign, 'source-1', 'server-1')).toBe(starterDesign)
    expect(addConnection(starterDesign, 'source-1', 'database-1').architecture.connections).toHaveLength(3)
  })

  it('stores settings in engine units within limits', () => {
    const workTime = settingFields.server.find((f) => f.key === 'workTime')!
    expect(clampSetting(workTime, 250)).toBe(0.25)
    expect(clampSetting(workTime, 0)).toBe(0.001)
    const concurrency = settingFields.server.find((f) => f.key === 'concurrency')!
    expect(clampSetting(concurrency, 2.6)).toBe(3)
    const design = updateSetting(starterDesign, 'server-1', 'workTime', 0.25)
    expect(design.architecture.components[1]).toMatchObject({ workTime: 0.25 })
  })
})
