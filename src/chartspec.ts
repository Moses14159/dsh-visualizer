/**
 * ChartSpec: the model-facing structured chart contract of dsh-visualizer.
 *
 * A ChartSpec is untrusted JSON that arrives either as the `visualize` tool
 * argument (host half) or as the tool/result content text (client half), so
 * every read goes through {@link parseChartSpec} before any rendering. The
 * shape is deliberately small and echarts-mappable; unknown fields are
 * rejected (not ignored) so a drifting model cannot silently render
 * something the validator never approved.
 *
 * This module is PURE — no DSH imports, no DOM, no echarts runtime — so the
 * same contract serves the host tool validator and the client renderer and
 * the unit tests.
 *
 * @module dsh-visualizer/chartspec
 */

/** Chart kinds the renderer knows. */
export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'scatter'

/** One data series: name plus numeric values. */
export interface ChartSeries {
  readonly name?: string
  readonly data: readonly number[]
}

/** Validated chart specification (every field checked, arrays bounded). */
export interface ChartSpec {
  readonly kind: ChartKind
  readonly title?: string
  /** Category labels for bar/line/area and pie-slice names. */
  readonly xAxis?: readonly string[]
  readonly yName?: string
  readonly series: readonly ChartSeries[]
}

/** Rejection reason; `parseChartSpec(null)`-style callers report the message. */
export interface ChartSpecParseError {
  readonly ok: false
  readonly message: string
}

/** Accepted parse result. */
export interface ChartSpecParseOk {
  readonly ok: true
  readonly spec: ChartSpec
}

export type ChartSpecParseResult = ChartSpecParseOk | ChartSpecParseError

/** Kind vocabulary; closed — an unknown kind is a validation error. */
const KINDS: readonly ChartKind[] = ['bar', 'line', 'area', 'pie', 'scatter']

/** Upper bounds on a single spec (untrusted input: keep rendering bounded). */
const MAX_SERIES = 8
const MAX_POINTS = 500
const MAX_LABEL = 120

/** Bound one string field. */
function boundString(value: unknown, field: string, required: boolean, max = MAX_LABEL): string | undefined {
  if (value === undefined) {
    if (required) throw new Error(`${field} is required`)
    return undefined
  }
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  if (value.length === 0) throw new Error(`${field} must not be empty`)
  if (value.length > max) throw new Error(`${field} exceeds ${max} characters`)
  return value
}

/** Bound one finite number array. */
function boundNumbers(value: unknown, field: string): readonly number[] {
  if (!Array.isArray(value)) throw new Error(`${field}.data must be an array`)
  if (value.length === 0) throw new Error(`${field}.data must not be empty`)
  if (value.length > MAX_POINTS) throw new Error(`${field}.data exceeds ${MAX_POINTS} points`)
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error(`${field}.data must contain finite numbers`)
    }
  }
  return value as readonly number[]
}

/** Bound one series object. */
function boundSeries(value: unknown, index: number): ChartSeries {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`series[${index}] must be an object`)
  }
  const record = value as Record<string, unknown>
  const data = boundNumbers(record['data'], `series[${index}]`)
  const name = record['name'] === undefined
    ? undefined
    : boundString(record['name'], `series[${index}].name`, true)
  return name === undefined ? { data } : { name, data }
}

/**
 * Validate untrusted JSON into a ChartSpec.
 * @param input - unknown payload (tool argument or parsed result text).
 * @returns the validated spec, or a rejection reason.
 */
export function parseChartSpec(input: unknown): ChartSpecParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'chart spec must be an object' }
  }
  const record = input as Record<string, unknown>
  try {
    // Closed kind vocabulary: an unknown kind fails loudly instead of
    // falling through to a generic renderer.
    if (typeof record['kind'] !== 'string' || !KINDS.includes(record['kind'] as ChartKind)) {
      throw new Error(`kind must be one of: ${KINDS.join(', ')}`)
    }
    const kind = record['kind'] as ChartKind
    if (!Array.isArray(record['series']) || record['series'].length === 0) {
      throw new Error('series must be a non-empty array')
    }
    if (record['series'].length > MAX_SERIES) throw new Error(`series exceeds ${MAX_SERIES} entries`)
    const series = record['series'].map(boundSeries)
    const title = boundString(record['title'], 'title', false)
    const yName = boundString(record['yName'], 'yName', false)
    const xAxis = record['xAxis'] === undefined
      ? undefined
      : (() => {
        if (!Array.isArray(record['xAxis'])) throw new Error('xAxis must be an array of strings')
        if (record['xAxis'].length > MAX_POINTS) throw new Error(`xAxis exceeds ${MAX_POINTS} labels`)
        const labels: string[] = []
        for (const label of record['xAxis']) {
          const bound = boundString(label, 'xAxis[]', true)
          if (bound !== undefined) labels.push(bound)
        }
        return labels as readonly string[]
      })()
    return {
      ok: true,
      spec: {
        kind,
        ...title === undefined ? {} : { title },
        ...yName === undefined ? {} : { yName },
        ...xAxis === undefined ? {} : { xAxis },
        series,
      },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Chart kinds requiring a scatter-point reading; kept for renderers. */
export function isPairKind(kind: ChartKind): boolean {
  return kind === 'scatter'
}
