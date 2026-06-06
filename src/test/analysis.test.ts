import { describe, it, expect } from 'vitest'
import { getZone } from '../lib/zones'
import type { Vibe } from '../types'

// ── helpers mirrored from Analysis.tsx (pure functions) ───────────────────────

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0
}

function buildTimeSeries(vibes: Vibe[]) {
  const byDay: Record<string, { valences: number[]; arousals: number[] }> = {}
  for (const v of vibes) {
    const day = v.created_at.split('T')[0]
    if (!byDay[day]) byDay[day] = { valences: [], arousals: [] }
    byDay[day].valences.push(v.valence)
    byDay[day].arousals.push(v.arousal)
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { valences, arousals }]) => ({
      date,
      avgValence: avg(valences),
      avgArousal: avg(arousals),
    }))
}

function regressionSlope(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const xMean = (n - 1) / 2
  const yMean = avg(values)
  const num = values.reduce((s, y, i) => s + (i - xMean) * (y - yMean), 0)
  const den = values.reduce((s, _, i) => s + (i - xMean) ** 2, 0)
  return den === 0 ? 0 : num / den
}

function slopeArrow(slope: number): string {
  if (slope > 0.08) return '↑'
  if (slope < -0.08) return '↓'
  return '→'
}

function buildCSV(vibes: Vibe[]): string[] {
  const headers = ['date', 'time', 'valence', 'arousal', 'zone', 'note']
  const rows = vibes.map(v => {
    const d = new Date(v.created_at)
    const note = v.note ? `"${v.note.replace(/"/g, '""')}"` : ''
    return [
      `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`,
      d.toLocaleTimeString(),
      v.valence,
      v.arousal,
      getZone(v.valence, v.arousal),
      note,
    ].join(',')
  })
  return [headers.join(','), ...rows]
}

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeVibe(overrides: Partial<Vibe> & { created_at: string }): Vibe {
  return {
    id: 'test-id',
    user_id: 'user-1',
    valence: 7,
    arousal: 6,
    note: null,
    public: false,
    note_public: false,
    ...overrides,
  }
}

// ── export CSV ────────────────────────────────────────────────────────────────

describe('exportCSV', () => {
  it('produces correct headers', () => {
    const rows = buildCSV([])
    expect(rows[0]).toBe('date,time,valence,arousal,zone,note')
  })

  it('encodes valence, arousal, and zone correctly', () => {
    // valence 7.5, arousal 3.0 → 'vibing' (high valence, low arousal, not lfg)
    const v = makeVibe({ created_at: '2024-03-15T14:30:00.000Z', valence: 7.5, arousal: 3.0 })
    const cols = buildCSV([v])[1].split(',')
    expect(cols[2]).toBe('7.5')
    expect(cols[3]).toBe('3')
    expect(cols[4]).toBe('vibing')
  })

  it('quotes notes containing commas', () => {
    const v = makeVibe({ created_at: '2024-03-15T14:30:00.000Z', note: 'hello, world' })
    expect(buildCSV([v])[1]).toContain('"hello, world"')
  })

  it('escapes double-quotes inside notes', () => {
    const v = makeVibe({ created_at: '2024-03-15T14:30:00.000Z', note: 'say "hi"' })
    expect(buildCSV([v])[1]).toContain('"say ""hi"""')
  })

  it('leaves note column empty when note is null', () => {
    const v = makeVibe({ created_at: '2024-03-15T14:30:00.000Z', note: null })
    expect(buildCSV([v])[1].endsWith(',')).toBe(true)
  })

  it('exports multiple rows in passed order', () => {
    const vibes = [
      makeVibe({ id: 'a', created_at: '2024-03-15T10:00:00Z', valence: 8, arousal: 7 }),
      makeVibe({ id: 'b', created_at: '2024-03-16T10:00:00Z', valence: 4, arousal: 3 }),
    ]
    const rows = buildCSV(vibes)
    expect(rows).toHaveLength(3)
    expect(rows[1].split(',')[2]).toBe('8')
    expect(rows[2].split(',')[2]).toBe('4')
  })

  it('maps zone correctly for each vibe', () => {
    const cases: Array<[number, number, string]> = [
      [9, 9, 'lfg'],
      [1, 1, 'mwbs'],
      [3, 8, 'ball'],
      [8, 8, 'back'],
      [5, 5, 'whatitis'],
      [7, 3, 'vibing'],
      [3, 3, 'over'],
    ]
    for (const [valence, arousal, expected] of cases) {
      const v = makeVibe({ created_at: '2024-03-15T10:00:00Z', valence, arousal })
      const cols = buildCSV([v])[1].split(',')
      expect(cols[4]).toBe(expected)
    }
  })
})

// ── trend line / time series ──────────────────────────────────────────────────

describe('buildTimeSeries', () => {
  it('returns empty array for no vibes', () => {
    expect(buildTimeSeries([])).toEqual([])
  })

  it('groups same-day entries into one averaged point', () => {
    const vibes = [
      makeVibe({ created_at: '2024-03-15T10:00:00Z', valence: 6, arousal: 4 }),
      makeVibe({ created_at: '2024-03-15T18:00:00Z', valence: 8, arousal: 6 }),
    ]
    const series = buildTimeSeries(vibes)
    expect(series).toHaveLength(1)
    expect(series[0].avgValence).toBe(7)
    expect(series[0].avgArousal).toBe(5)
  })

  it('produces separate points for different days', () => {
    const vibes = [
      makeVibe({ created_at: '2024-03-15T10:00:00Z', valence: 5, arousal: 5 }),
      makeVibe({ created_at: '2024-03-16T10:00:00Z', valence: 7, arousal: 7 }),
    ]
    const series = buildTimeSeries(vibes)
    expect(series).toHaveLength(2)
    expect(series[0].date).toBe('2024-03-15')
    expect(series[1].date).toBe('2024-03-16')
  })

  it('sorts by date ascending regardless of input order', () => {
    const vibes = [
      makeVibe({ created_at: '2024-03-17T10:00:00Z', valence: 9, arousal: 9 }),
      makeVibe({ created_at: '2024-03-15T10:00:00Z', valence: 3, arousal: 3 }),
    ]
    const series = buildTimeSeries(vibes)
    expect(series[0].date).toBe('2024-03-15')
    expect(series[1].date).toBe('2024-03-17')
  })
})

describe('regressionSlope', () => {
  it('returns 0 for a single value', () => {
    expect(regressionSlope([5])).toBe(0)
  })

  it('returns 0 for empty array', () => {
    expect(regressionSlope([])).toBe(0)
  })

  it('returns positive slope for ascending series', () => {
    expect(regressionSlope([1, 2, 3, 4, 5])).toBeGreaterThan(0)
  })

  it('returns negative slope for descending series', () => {
    expect(regressionSlope([5, 4, 3, 2, 1])).toBeLessThan(0)
  })

  it('returns ~0 for flat series', () => {
    expect(Math.abs(regressionSlope([5, 5, 5, 5]))).toBeLessThan(0.001)
  })

  it('steeper ascent → larger slope magnitude', () => {
    const gentle = regressionSlope([4, 5, 6])
    const steep  = regressionSlope([1, 5, 9])
    expect(Math.abs(steep)).toBeGreaterThan(Math.abs(gentle))
  })
})

describe('slopeArrow', () => {
  it('returns ↑ for slope above threshold', () => {
    expect(slopeArrow(0.1)).toBe('↑')
    expect(slopeArrow(1.0)).toBe('↑')
  })

  it('returns ↓ for slope below negative threshold', () => {
    expect(slopeArrow(-0.1)).toBe('↓')
    expect(slopeArrow(-1.0)).toBe('↓')
  })

  it('returns → for slope within threshold band', () => {
    expect(slopeArrow(0)).toBe('→')
    expect(slopeArrow(0.07)).toBe('→')
    expect(slopeArrow(-0.07)).toBe('→')
  })
})
