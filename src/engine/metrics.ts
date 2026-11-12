/** Pure helpers for the metric series the engine samples. */

/**
 * The `p`th percentile (0 to 1) of `values`, interpolating linearly between
 * the two nearest ranks. Returns null for an empty list. Does not modify `values`.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = Math.min(Math.max(p, 0), 1) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const low = sorted[lower]!
  const high = sorted[upper]!
  return low + (high - low) * (position - lower)
}
