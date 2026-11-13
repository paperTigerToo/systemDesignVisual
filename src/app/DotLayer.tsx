import { EdgeLabelRenderer } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import type { ComponentId } from '../engine'
import { DOT_TRAVEL_TIME, useSimulation, type Dot } from './simulationStore'

/** Where each Connection is drawn, in flow coordinates, keyed by `from>to`. Kept up to date by the edges. */
const geometry = new Map<string, { sourceX: number; sourceY: number; targetX: number; targetY: number }>()

export function setConnectionGeometry(from: ComponentId, to: ComponentId, line: { sourceX: number; sourceY: number; targetX: number; targetY: number }) {
  geometry.set(`${from}>${to}`, line)
}

export function clearConnectionGeometry(from: ComponentId, to: ComponentId) {
  geometry.delete(`${from}>${to}`)
}

const SIZE = 6
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Every sampled Request in one layer under the Components. It is drawn by hand from
 * a store subscription, not by React, so moving dots never re-render the edges or nodes:
 * each frame only moves a pool of squares that is at most the dot cap in size.
 */
export function DotLayer() {
  const group = useRef<SVGGElement>(null)

  useEffect(() => {
    const pool: SVGRectElement[] = []

    const draw = (dots: Dot[], time: number) => {
      const g = group.current
      if (!g) return
      let used = 0
      for (const dot of dots) {
        // A call travels from caller to callee along the Connection; a response travels back along it.
        const line = dot.direction === 'call' ? geometry.get(`${dot.from}>${dot.to}`) : geometry.get(`${dot.to}>${dot.from}`)
        if (!line) continue
        const travelled = Math.min(Math.max((time - dot.startedAt) / DOT_TRAVEL_TIME, 0), 1)
        const progress = dot.direction === 'call' ? travelled : 1 - travelled
        const x = line.sourceX + (line.targetX - line.sourceX) * progress
        // Responses ride slightly below the line so the two directions stay readable.
        const y = line.sourceY + (line.targetY - line.sourceY) * progress + (dot.direction === 'response' ? 6 : -6)
        let rect = pool[used]
        if (!rect) {
          rect = document.createElementNS(SVG_NS, 'rect')
          rect.setAttribute('width', String(SIZE))
          rect.setAttribute('height', String(SIZE))
          g.appendChild(rect)
          pool.push(rect)
        }
        rect.setAttribute('x', (x - SIZE / 2).toFixed(1))
        rect.setAttribute('y', (y - SIZE / 2).toFixed(1))
        const className = `request-dot request-dot--${dot.direction}${dot.bad ? ' request-dot--bad' : ''}`
        if (rect.getAttribute('class') !== className) rect.setAttribute('class', className)
        if (rect.style.display) rect.style.display = ''
        used++
      }
      for (let i = used; i < pool.length; i++) {
        if (pool[i]!.style.display !== 'none') pool[i]!.style.display = 'none'
      }
    }

    const initial = useSimulation.getState()
    draw(initial.dots, initial.snapshot.time)
    return useSimulation.subscribe((state, previous) => {
      if (state.dots !== previous.dots || state.snapshot.time !== previous.snapshot.time) draw(state.dots, state.snapshot.time)
    })
  }, [])

  return (
    <EdgeLabelRenderer>
      <svg className="dot-layer" aria-hidden="true">
        <g ref={group} />
      </svg>
    </EdgeLabelRenderer>
  )
}
