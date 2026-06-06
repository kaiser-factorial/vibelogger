import { useMemo, useState } from 'react'
import { getZone, ZONE_META, ZONE_ORDER } from '../lib/zones'
import { topWordsByZone } from '../lib/wordAnalysis'
import type { Vibe } from '../types'

export const UNLOCK_THRESHOLD = 10

// ── helpers ───────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0
}

function filterByDate(vibes: Vibe[], from: string, to: string): Vibe[] {
  return vibes.filter(v => {
    const d = new Date(v.created_at)
    if (from && d < new Date(from)) return false
    if (to) {
      const end = new Date(to)
      end.setHours(23, 59, 59, 999)
      if (d > end) return false
    }
    return true
  })
}

function buildHeatmap(vibes: Vibe[]): number[][] {
  const grid: number[][] = Array.from({ length: 10 }, () => Array(10).fill(0))
  for (const v of vibes) {
    const col = Math.min(9, Math.max(0, Math.floor(v.valence - 1)))
    const row = Math.min(9, Math.max(0, Math.floor(v.arousal - 1)))
    grid[row][col]++
  }
  return grid
}

interface DailyPoint {
  date: string
  avgValence: number
  avgArousal: number
}

function buildTimeSeries(vibes: Vibe[]): DailyPoint[] {
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

// Linear regression slope — positive = trending up, negative = down
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

function exportJSON(vibes: Vibe[]) {
  const data = vibes.map(v => ({
    id: v.id,
    date: v.created_at,
    valence: v.valence,
    arousal: v.arousal,
    zone: getZone(v.valence, v.arousal),
    note: v.note ?? null,
    public: v.public,
    note_public: v.note_public,
  }))
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `vibeslogger-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function exportCSV(vibes: Vibe[]) {
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
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `vibeslogger-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function getStreak(vibes: Vibe[]): { current: number; longest: number } {
  if (!vibes.length) return { current: 0, longest: 0 }
  const days = [...new Set(vibes.map(v => v.created_at.split('T')[0]))].sort()

  let longest = 1, run = 1
  for (let i = 1; i < days.length; i++) {
    const d = new Date(days[i - 1]); d.setDate(d.getDate() + 1)
    if (days[i] === d.toISOString().split('T')[0]) { run++; if (run > longest) longest = run }
    else run = 1
  }

  let current = 0
  const today     = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const last = days[days.length - 1]
  if (last === today || last === yesterday) {
    current = 1
    let check = last
    for (let i = days.length - 2; i >= 0; i--) {
      const d = new Date(check); d.setDate(d.getDate() - 1)
      if (days[i] === d.toISOString().split('T')[0]) { current++; check = days[i] }
      else break
    }
  }

  return { current, longest: Math.max(longest, current) }
}

type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night'

function getTimeSlot(ts: string): TimeSlot {
  const h = new Date(ts).getHours()
  if (h >= 6  && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 21) return 'evening'
  return 'night'
}

const TIME_META: Record<TimeSlot, { label: string; range: string }> = {
  morning:   { label: 'morning',   range: '6–11' },
  afternoon: { label: 'afternoon', range: '12–16' },
  evening:   { label: 'evening',   range: '17–20' },
  night:     { label: 'night',     range: '21–5' },
}
const TIME_ORDER: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night']

// ── sub-components ────────────────────────────────────────────────────────────

function StatsStrip({ vibes, allVibes }: { vibes: Vibe[]; allVibes: Vibe[] }) {
  const avgV      = avg(vibes.map(v => v.valence))
  const avgA      = avg(vibes.map(v => v.arousal))
  const withNotes = vibes.filter(v => v.note && v.note.trim().split(/\s+/).length >= 3).length
  const streak    = useMemo(() => getStreak(allVibes), [allVibes])

  return (
    <div className="stats-strip">
      <div className="stat-pill">
        <span className="stat-value">{vibes.length}</span>
        <span className="stat-label">entries</span>
      </div>
      <div className="stat-pill">
        <span className="stat-value">{avgV.toFixed(1)}</span>
        <span className="stat-label">avg valence</span>
      </div>
      <div className="stat-pill">
        <span className="stat-value">{avgA.toFixed(1)}</span>
        <span className="stat-label">avg arousal</span>
      </div>
      <div className="stat-pill">
        <span className="stat-value">{withNotes}</span>
        <span className="stat-label">notes ≥3w</span>
      </div>
      {streak.current > 0 && (
        <div className="stat-pill stat-pill--accent">
          <span className="stat-value">{streak.current}d</span>
          <span className="stat-label">streak</span>
        </div>
      )}
      {streak.longest > 1 && (
        <div className="stat-pill">
          <span className="stat-value">{streak.longest}d</span>
          <span className="stat-label">best streak</span>
        </div>
      )}
    </div>
  )
}

function TimeOfDayAnalysis({ vibes }: { vibes: Vibe[] }) {
  const slots = useMemo(() => {
    const grouped: Record<TimeSlot, Vibe[]> = { morning: [], afternoon: [], evening: [], night: [] }
    for (const v of vibes) grouped[getTimeSlot(v.created_at)].push(v)
    return grouped
  }, [vibes])

  const hasData = TIME_ORDER.some(s => slots[s].length > 0)
  if (!hasData) return null

  return (
    <div className="analysis-section">
      <div className="analysis-section-title">time of day</div>
      <div className="analysis-section-sub">how your vibe shifts throughout the day</div>
      <div className="tod-grid">
        {TIME_ORDER.map(slot => {
          const sv = slots[slot]
          const meta = TIME_META[slot]
          if (!sv.length) return (
            <div key={slot} className="tod-slot tod-slot--empty">
              <div className="tod-slot-name">{meta.label}</div>
              <div className="tod-slot-range">{meta.range}</div>
              <div className="tod-slot-count">—</div>
            </div>
          )
          const avgV = avg(sv.map(v => v.valence))
          const avgA = avg(sv.map(v => v.arousal))
          const zone = getZone(avgV, avgA)
          const { color } = ZONE_META[zone]
          return (
            <div key={slot} className="tod-slot" style={{ borderColor: color + '55' }}>
              <div className="tod-slot-name">{meta.label}</div>
              <div className="tod-slot-range" style={{ color }}>{meta.range}</div>
              <div className="tod-slot-count">{sv.length} {sv.length === 1 ? 'entry' : 'entries'}</div>
              <div className="tod-slot-stats">
                <span className="tod-stat">v {avgV.toFixed(1)}</span>
                <span className="tod-stat">a {avgA.toFixed(1)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrendLine({ vibes }: { vibes: Vibe[] }) {
  const series = useMemo(() => buildTimeSeries(vibes), [vibes])
  if (series.length < 2) return null

  const W = 300, H = 70, PAD_X = 4, PAD_Y = 8

  function toSvgPoint(index: number, value: number) {
    const n = series.length
    const x = PAD_X + ((index / (n - 1)) * (W - 2 * PAD_X))
    const y = PAD_Y + ((1 - (value - 1) / 9) * (H - 2 * PAD_Y))
    return { x, y }
  }

  function toPath(pts: { x: number; y: number }[]): string {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  }

  const vPts = series.map((d, i) => toSvgPoint(i, d.avgValence))
  const aPts = series.map((d, i) => toSvgPoint(i, d.avgArousal))

  const vSlope = regressionSlope(series.map(d => d.avgValence))
  const aSlope = regressionSlope(series.map(d => d.avgArousal))

  // Regression lines
  function regressionPath(values: number[]): string {
    const sl = regressionSlope(values)
    const me = avg(values)
    const n  = values.length
    const x0 = PAD_X
    const x1 = W - PAD_X
    const mid = (n - 1) / 2
    const y0 = PAD_Y + ((1 - (me + sl * (0 - mid) - 1) / 9) * (H - 2 * PAD_Y))
    const y1 = PAD_Y + ((1 - (me + sl * (n - 1 - mid) - 1) / 9) * (H - 2 * PAD_Y))
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }

  return (
    <div className="analysis-section">
      <div className="analysis-section-title">trends</div>
      <div className="analysis-section-sub">daily average valence and arousal</div>
      <div className="trend-indicators">
        <span className="trend-badge" style={{ color: '#4896A8' }}>
          valence {slopeArrow(vSlope)}
        </span>
        <span className="trend-badge" style={{ color: '#D08020' }}>
          arousal {slopeArrow(aSlope)}
        </span>
        <span className="trend-days">{series.length} days</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="trend-svg"
        aria-label="valence and arousal trends"
      >
        {/* Grid lines at 1, 5, 10 */}
        {[1, 5, 10].map(v => {
          const y = PAD_Y + ((1 - (v - 1) / 9) * (H - 2 * PAD_Y))
          return (
            <line key={v} x1={PAD_X} y1={y} x2={W - PAD_X} y2={y}
              stroke="#1a1a1a" strokeWidth="0.5" />
          )
        })}
        {/* Regression lines (dashed) */}
        <path d={regressionPath(series.map(d => d.avgValence))}
          fill="none" stroke="#4896A8" strokeWidth="0.75" strokeDasharray="3,2" opacity={0.5} />
        <path d={regressionPath(series.map(d => d.avgArousal))}
          fill="none" stroke="#D08020" strokeWidth="0.75" strokeDasharray="3,2" opacity={0.5} />
        {/* Sparklines */}
        <path d={toPath(vPts)} fill="none" stroke="#4896A8" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" />
        <path d={toPath(aPts)} fill="none" stroke="#D08020" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots */}
        {vPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#4896A8" />)}
        {aPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#D08020" />)}
      </svg>
      <div className="trend-legend">
        <span style={{ color: '#4896A8' }}>— valence</span>
        <span style={{ color: '#D08020' }}>— arousal</span>
        <span className="trend-legend-note">dashed = regression</span>
      </div>
    </div>
  )
}

function Heatmap({ vibes }: { vibes: Vibe[] }) {
  const grid   = useMemo(() => buildHeatmap(vibes), [vibes])
  const maxVal = useMemo(() => Math.max(1, ...grid.flat()), [grid])

  return (
    <div className="analysis-section">
      <div className="analysis-section-title">vibe density</div>
      <div className="analysis-section-sub">where on the map you spend most time</div>
      <div className="heatmap-wrap">
        <div className="heatmap-y-axis">
          <span>high energy ↑</span>
          <span>low energy ↓</span>
        </div>
        <div className="heatmap-col">
          <div className="heatmap-grid">
            {Array.from({ length: 100 }, (_, i) => {
              const displayRow    = Math.floor(i / 10)
              const displayCol    = i % 10
              const arousalBucket = 9 - displayRow
              const count   = grid[arousalBucket][displayCol]
              const opacity = count === 0 ? 0 : 0.12 + (count / maxVal) * 0.88
              return (
                <div
                  key={i}
                  className="heatmap-cell"
                  style={{ background: `rgba(255, 190, 0, ${opacity.toFixed(3)})` }}
                  title={`v:${displayCol + 1}–${displayCol + 2}  a:${arousalBucket + 1}–${arousalBucket + 2}  ×${count}`}
                />
              )
            })}
          </div>
          <div className="heatmap-x-axis">← unpleasant · pleasant →</div>
        </div>
      </div>
      <div className="heatmap-legend">
        <span className="legend-none">none</span>
        <div className="legend-gradient" />
        <span className="legend-max">most</span>
      </div>
    </div>
  )
}

function ZoneBreakdown({ vibes }: { vibes: Vibe[] }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const v of vibes) {
      const z = getZone(v.valence, v.arousal)
      c[z] = (c[z] ?? 0) + 1
    }
    return c
  }, [vibes])

  const total  = vibes.length || 1
  const sorted = ZONE_ORDER
    .filter(z => counts[z])
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))

  if (!sorted.length) return null

  return (
    <div className="analysis-section">
      <div className="analysis-section-title">zone time</div>
      <div className="analysis-section-sub">how you're distributed across the map</div>
      <div className="zone-bars">
        {sorted.map(zoneId => {
          const pct = Math.round((counts[zoneId] / total) * 100)
          const { label, color } = ZONE_META[zoneId]
          return (
            <div key={zoneId} className="zone-bar-row">
              <div className="zone-bar-label">{label}</div>
              <div className="zone-bar-track">
                <div className="zone-bar-fill" style={{ width: `${pct}%`, background: color }} />
              </div>
              <div className="zone-bar-pct">{pct}%</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WordAnalysis({ vibes }: { vibes: Vibe[] }) {
  const byZone = useMemo(() => topWordsByZone(vibes, 5), [vibes])
  const populated = ZONE_ORDER.filter(z => (byZone[z]?.length ?? 0) > 0)

  const qualifyingNotes = vibes.filter(
    v => v.note && v.note.trim().split(/\s+/).length >= 3
  ).length

  if (qualifyingNotes < 3) {
    return (
      <div className="analysis-section">
        <div className="analysis-section-title">word patterns</div>
        <div className="analysis-empty">
          add notes with 3+ words to at least 3 entries to see patterns
        </div>
      </div>
    )
  }

  if (!populated.length) {
    return (
      <div className="analysis-section">
        <div className="analysis-section-title">word patterns</div>
        <div className="analysis-empty">no qualifying notes in this date range</div>
      </div>
    )
  }

  return (
    <div className="analysis-section">
      <div className="analysis-section-title">word patterns</div>
      <div className="analysis-section-sub">top words in your notes, by zone (stop words removed)</div>
      <div className="word-zone-grid">
        {populated.map(zoneId => {
          const { label, color } = ZONE_META[zoneId]
          return (
            <div key={zoneId} className="word-zone-card" style={{ borderColor: color + '55' }}>
              <div className="word-zone-name" style={{ color }}>{label}</div>
              <div className="word-chips">
                {byZone[zoneId]!.map(({ word, count }) => (
                  <span key={word} className="word-chip">
                    {word}
                    {count > 1 && <span className="word-chip-count">×{count}</span>}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── main export ───────────────────────────────────────────────────────────────

export default function Analysis({ vibes }: { vibes: Vibe[] }) {
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')

  const filtered  = useMemo(() => filterByDate(vibes, from, to), [vibes, from, to])
  const hasFilter = from || to
  // allVibes (unfiltered) used for streak — a streak spans your whole history

  if (vibes.length < UNLOCK_THRESHOLD) {
    const needed = UNLOCK_THRESHOLD - vibes.length
    const pct    = Math.round((vibes.length / UNLOCK_THRESHOLD) * 100)
    return (
      <div className="analysis-lock">
        <div className="analysis-lock-inner">
          <div className="analysis-lock-title">analysis unlocks at {UNLOCK_THRESHOLD} entries</div>
          <div className="analysis-lock-bar">
            <div className="analysis-lock-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="analysis-lock-count">{vibes.length} / {UNLOCK_THRESHOLD}</div>
          <div className="analysis-lock-sub">
            log {needed} more vibe{needed !== 1 ? 's' : ''} to unlock
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="analysis-wrap">
      <div className="analysis-filter">
        <label className="filter-label">from</label>
        <input type="date" className="filter-input" value={from}
          onChange={e => setFrom(e.target.value)} />
        <label className="filter-label">to</label>
        <input type="date" className="filter-input" value={to}
          onChange={e => setTo(e.target.value)} />
        {hasFilter && (
          <button className="btn-ghost filter-clear"
            onClick={() => { setFrom(''); setTo('') }}>
            clear
          </button>
        )}
        <div className="filter-export-group">
          <button
            className="btn-ghost filter-export"
            onClick={() => exportCSV(filtered)}
            title={`export ${filtered.length} entries as CSV`}
            disabled={filtered.length === 0}
          >
            ↓ csv
          </button>
          <button
            className="btn-ghost filter-export"
            onClick={() => exportJSON(filtered)}
            title={`export ${filtered.length} entries as JSON`}
            disabled={filtered.length === 0}
          >
            ↓ json
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="analysis-empty-state">no entries in this date range</div>
      ) : (
        <>
          <StatsStrip vibes={filtered} allVibes={vibes} />
          <TrendLine  vibes={filtered} />
          <TimeOfDayAnalysis vibes={filtered} />
          <Heatmap    vibes={filtered} />
          <ZoneBreakdown vibes={filtered} />
          <WordAnalysis  vibes={filtered} />
        </>
      )}
    </div>
  )
}
