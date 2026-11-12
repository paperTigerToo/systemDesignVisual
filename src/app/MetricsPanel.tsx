import { useMemo, type ReactNode } from 'react'
import type { ComponentId, ComponentMetrics, MetricSample, SourceMetrics } from '../engine'
import { Chart } from './Chart'
import { kindLabel } from './design'
import { useSimulation } from './simulationStore'

/** Simulated seconds the charts show; matches the engine's default metrics window. */
const WINDOW = 30

/** Chart colours, validated for the dark surface (see the colour tokens in styles.css). */
const COLOR = {
  primary: 'var(--series-1)',
  secondary: 'var(--series-2)',
  completed: 'var(--outcome-completed)',
  rejected: 'var(--outcome-rejected)',
  timedOut: 'var(--outcome-timed-out)',
  failed: 'var(--outcome-failed)',
}

const perSecond = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}/s`
const milliseconds = (v: number) => `${v * 1000 < 10 ? (v * 1000).toFixed(1) : Math.round(v * 1000)} ms`
const percent = (v: number) => `${Math.round(v * 100)}%`
const count = (v: number) => `${Math.round(v)}`

interface Common {
  times: number[]
  start: number
  window: number
  markers: number[]
}

function sourceCharts(common: Common, metrics: (SourceMetrics | undefined)[]) {
  const pick = (f: (m: SourceMetrics) => number | null) => metrics.map((m) => (m ? f(m) : null))
  return (
    <>
      <Chart
        {...common}
        title="Completed per second"
        series={[{ name: 'Completed', color: COLOR.primary, values: pick((m) => m.completedPerSecond) }]}
        minMax={5}
        format={perSecond}
      />
      <Chart
        {...common}
        title="Latency of Completed Requests"
        series={[
          { name: 'Median', color: COLOR.primary, values: pick((m) => m.medianLatency) },
          { name: '95th percentile', color: COLOR.secondary, values: pick((m) => m.p95Latency) },
        ]}
        minMax={0.1}
        format={milliseconds}
      />
      <Chart
        {...common}
        title="Outcomes per second"
        stacked
        series={[
          { name: 'Completed', color: COLOR.completed, values: pick((m) => m.outcomesPerSecond.completed) },
          { name: 'Rejected', color: COLOR.rejected, values: pick((m) => m.outcomesPerSecond.rejected) },
          { name: 'Timed out', color: COLOR.timedOut, values: pick((m) => m.outcomesPerSecond.timedOut) },
          { name: 'Failed', color: COLOR.failed, values: pick((m) => m.outcomesPerSecond.failed) },
        ]}
        minMax={5}
        format={perSecond}
      />
    </>
  )
}

function componentCharts(common: Common, metrics: (ComponentMetrics | undefined)[], kind: ComponentMetrics['kind']) {
  if (kind === 'source') return sourceCharts(common, metrics.map((m) => (m?.kind === 'source' ? m : undefined)))
  if (kind === 'queue') {
    const queue = metrics.map((m) => (m?.kind === 'queue' ? m : undefined))
    return (
      <>
        <Chart
          {...common}
          title="Depth"
          series={[{ name: 'Depth', color: COLOR.primary, values: queue.map((m) => m?.depth ?? null) }]}
          minMax={5}
          format={count}
        />
        <Chart
          {...common}
          title="Time held"
          series={[{ name: 'Time held', color: COLOR.primary, values: queue.map((m) => m?.timeHeld ?? null) }]}
          minMax={0.1}
          format={milliseconds}
        />
      </>
    )
  }
  const worker = metrics.map((m) => (m?.kind === 'server' || m?.kind === 'database' ? m : undefined))
  return (
    <>
      <Chart
        {...common}
        title="Utilisation"
        series={[{ name: 'Utilisation', color: COLOR.primary, values: worker.map((m) => m?.utilisation ?? null) }]}
        minMax={1}
        fixedMax={1}
        format={percent}
      />
      <Chart
        {...common}
        title="Backlog depth"
        series={[{ name: 'Backlog', color: COLOR.primary, values: worker.map((m) => m?.backlog ?? null) }]}
        minMax={5}
        format={count}
      />
    </>
  )
}

/** For each sample, the Server or Database with the highest Utilisation. */
function busiest(samples: MetricSample[]): { id: ComponentId; utilisation: number }[] {
  return samples.map((sample) => {
    let best = { id: '', utilisation: -1 }
    for (const [id, m] of Object.entries(sample.components)) {
      if ((m.kind === 'server' || m.kind === 'database') && m.utilisation > best.utilisation) best = { id, utilisation: m.utilisation }
    }
    return best
  })
}

/** Rolling charts along the bottom: the whole architecture, or the selected Component. */
export function MetricsPanel() {
  const samples = useSimulation((state) => state.metrics)
  const interventions = useSimulation((state) => state.interventions)
  const selection = useSimulation((state) => state.selection)
  const layout = useSimulation((state) => state.design.layout)
  const selectedKind = useSimulation((state) => {
    const selected = state.selection
    if (selected?.kind !== 'component') return undefined
    return state.design.architecture.components.find((c) => c.id === selected.id)?.kind
  })

  const times = useMemo(() => samples.map((s) => s.time), [samples])
  // Several changes made at one instant (adding a Server and its Connections) share one marker.
  const markers = useMemo(() => [...new Set(interventions.map((i) => i.time))], [interventions])
  const latest = times.at(-1) ?? 0
  const common: Common = { times, start: Math.max(0, latest - WINDOW), window: WINDOW, markers }

  const selectedId = selection?.kind === 'component' && selectedKind ? selection.id : null
  const name = (id: ComponentId) => layout[id]?.label ?? id

  let heading: string
  let charts: ReactNode
  if (selectedId && selectedKind) {
    heading = `${name(selectedId)} (${kindLabel[selectedKind]})`
    charts = componentCharts(
      common,
      samples.map((s) => s.components[selectedId]),
      selectedKind,
    )
  } else {
    heading = 'Whole architecture'
    const top = busiest(samples)
    charts = (
      <>
        {sourceCharts(
          common,
          samples.map((s) => s.overall),
        )}
        <Chart
          {...common}
          title="Highest Utilisation"
          series={[
            { name: 'Highest Utilisation', color: COLOR.primary, values: top.map((b) => (b.utilisation < 0 ? null : b.utilisation)) },
          ]}
          minMax={1}
          fixedMax={1}
          format={percent}
          detail={(i) => (top[i]?.id ? name(top[i].id) : null)}
        />
      </>
    )
  }

  return (
    <section className="metrics" aria-label="Metrics">
      <header className="metrics__header">
        <h2 className="panel__title">Metrics</h2>
        <span className="metrics__scope">{heading}</span>
        <span className="metrics__hint">
          Last {WINDOW} simulated seconds{markers.length > 0 ? ' · dashed lines mark recorded changes' : ''}
          {selectedId ? '' : ' · select a Component for its own charts'}
        </span>
      </header>
      {samples.length === 0 ? (
        <p className="panel__hint metrics__empty">Press Play to start sampling.</p>
      ) : (
        <div className="metrics__charts">{charts}</div>
      )}
    </section>
  )
}
