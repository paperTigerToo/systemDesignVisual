import { memo, useState, type MouseEvent } from 'react'

/** Plot coordinates; the SVG stretches to fit, so strokes are drawn non-scaling. */
const W = 300
const H = 100

export interface Series {
  name: string
  /** A CSS colour, from the chart palette in styles.css. */
  color: string
  /** One value per sample time; null leaves a gap. */
  values: (number | null)[]
}

export interface ChartProps {
  title: string
  /** Sample times, oldest first. */
  times: number[]
  /** The visible time span: [start, start + window]. */
  start: number
  window: number
  series: Series[]
  /** Draw `series` as stacked bars (for parts of a whole) rather than lines. */
  stacked?: boolean
  /** The y axis covers at least 0 to this. */
  minMax: number
  /** A fixed y maximum, for example 1 for Utilisation. */
  fixedMax?: number
  format(value: number): string
  /** Simulated times of Interventions, drawn as markers. */
  markers: number[]
  /** Extra line for the tooltip at a sample index, for example which Component it was. */
  detail?(index: number): string | null
}

/** Round up to 1, 2, 2.5 or 5 times a power of ten, so the y-axis label is a tidy number. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * power) return step * power
  return 10 * power
}

function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let path = ''
  let drawing = false
  values.forEach((value, i) => {
    if (value === null) {
      drawing = false
      return
    }
    path += `${drawing ? 'L' : 'M'}${x(i).toFixed(2)},${y(value).toFixed(2)}`
    drawing = true
  })
  return path
}

/** A small rolling chart drawn as plain SVG: cheap enough to redraw on every new sample. */
export const Chart = memo(function Chart(props: ChartProps) {
  const { title, times, start, window, series, stacked, format, markers } = props
  const [hover, setHover] = useState<number | null>(null)

  const totals = times.map((_, i) =>
    stacked
      ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
      : Math.max(0, ...series.map((s) => s.values[i] ?? 0)),
  )
  const yMax = props.fixedMax ?? niceMax(Math.max(props.minMax, ...totals) * 1.1)
  const x = (i: number) => ((times[i]! - start) / window) * W
  const y = (v: number) => H - (Math.min(v, yMax) / yMax) * H
  const barWidth = Math.max(0.5, (W / window) * (times.length > 1 ? times[1]! - times[0]! : 0.5) - 0.8)

  const latestIndex = times.length - 1
  const shown = hover ?? latestIndex

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    if (times.length === 0) return
    const box = event.currentTarget.getBoundingClientRect()
    const t = start + ((event.clientX - box.left) / box.width) * window
    let nearest = 0
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - t) < Math.abs(times[nearest]! - t)) nearest = i
    setHover(nearest)
  }

  const valueText = (s: Series, i: number) => {
    const v = s.values[i]
    return v === null || v === undefined ? '–' : format(v)
  }

  return (
    <figure className="chart">
      <figcaption className="chart__header">
        <span className="chart__title">{title}</span>
        {series.length === 1 && shown >= 0 && <span className="chart__value">{valueText(series[0]!, shown)}</span>}
      </figcaption>
      {series.length > 1 && (
        <ul className="chart__legend">
          {series.map((s) => (
            <li key={s.name}>
              <span className="chart__swatch" style={{ background: s.color }} />
              {s.name} <span className="chart__legend-value">{shown >= 0 ? valueText(s, shown) : '–'}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="chart__plot">
        <span className="chart__axis chart__axis--max">{format(yMax)}</span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}, last ${window} simulated seconds`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <line className="chart__grid" x1={0} x2={W} y1={H / 2} y2={H / 2} vectorEffect="non-scaling-stroke" />
          <line className="chart__baseline" x1={0} x2={W} y1={H} y2={H} vectorEffect="non-scaling-stroke" />
          {stacked
            ? times.map((_, i) => {
                let base = 0
                return series.map((s) => {
                  const v = s.values[i] ?? 0
                  if (v <= 0) return null
                  const top = y(base + v)
                  const height = y(base) - top
                  base += v
                  return (
                    <rect
                      key={`${s.name}:${i}`}
                      x={x(i) - barWidth}
                      y={top}
                      width={barWidth}
                      height={Math.max(height, 0)}
                      fill={s.color}
                    />
                  )
                })
              })
            : series.map((s) => (
                <path
                  key={s.name}
                  d={linePath(s.values, x, y)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
          {markers
            .filter((t) => t >= start && t <= start + window)
            .map((t, i) => (
              <line
                key={`${t}:${i}`}
                className="chart__marker"
                x1={((t - start) / window) * W}
                x2={((t - start) / window) * W}
                y1={0}
                y2={H}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          {hover !== null && (
            <line className="chart__crosshair" x1={x(hover)} x2={x(hover)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {hover !== null && (
          <div
            className={`chart__tooltip${x(hover) > W / 2 ? ' chart__tooltip--left' : ''}`}
            style={{ left: `${(x(hover) / W) * 100}%` }}
          >
            <div className="chart__tooltip-time">t = {times[hover]!.toFixed(1)} s</div>
            {series.map((s) => (
              <div key={s.name}>
                {series.length > 1 && <span className="chart__swatch" style={{ background: s.color }} />}
                {series.length > 1 ? `${s.name}: ` : ''}
                {valueText(s, hover)}
              </div>
            ))}
            {props.detail?.(hover) && <div className="chart__tooltip-detail">{props.detail(hover)}</div>}
          </div>
        )}
      </div>
    </figure>
  )
})
