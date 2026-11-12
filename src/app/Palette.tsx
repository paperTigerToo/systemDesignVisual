import { useReactFlow } from '@xyflow/react'
import type { DragEvent } from 'react'
import { kindLabel, type ComponentKind } from './design'
import { useSimulation } from './simulationStore'

export const PALETTE_DRAG_TYPE = 'application/x-system-design-component'

const entries: { kind: ComponentKind; hint: string }[] = [
  { kind: 'source', hint: 'Generates Requests' },
  { kind: 'server', hint: 'Works, then may call one Component' },
  { kind: 'database', hint: 'Works, calls nothing' },
  { kind: 'queue', hint: 'Holds Requests, releases the caller' },
]

/** Components to drag onto the canvas, or click to drop in the middle of the view. */
export function Palette() {
  const { screenToFlowPosition } = useReactFlow()

  const addInView = (kind: ComponentKind) => {
    const canvas = document.querySelector('.canvas')?.getBoundingClientRect()
    const centre = canvas
      ? { x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const position = screenToFlowPosition(centre)
    // Step right past any Component already near the drop point, so repeated clicks lay out a row.
    const placements = Object.values(useSimulation.getState().design.layout)
    let spot = { x: position.x - 95, y: position.y - 80 }
    while (placements.some((p) => Math.abs(p.x - spot.x) < 220 && Math.abs(p.y - spot.y) < 120)) {
      spot = { x: spot.x + 240, y: spot.y }
    }
    useSimulation.getState().addComponent(kind, spot)
  }

  const onDragStart = (event: DragEvent, kind: ComponentKind) => {
    event.dataTransfer.setData(PALETTE_DRAG_TYPE, kind)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <aside className="palette" aria-label="Components">
      <h2 className="panel__title">Components</h2>
      <p className="panel__hint">Drag onto the canvas, or click to add.</p>
      {entries.map(({ kind, hint }) => (
        <button
          key={kind}
          type="button"
          className="palette__item"
          aria-label={`Add ${kindLabel[kind]}: ${hint}`}
          draggable
          onDragStart={(event) => onDragStart(event, kind)}
          onClick={() => addInView(kind)}
        >
          <span className="palette__name">{kindLabel[kind]}</span>
          <span className="palette__hint">{hint}</span>
        </button>
      ))}
    </aside>
  )
}
