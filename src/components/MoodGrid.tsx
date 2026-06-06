import { useRef, useState, useEffect } from 'react'
import type { Vibe, PendingVibe } from '../types'
import { gridColor, GRID_ZONE_COLOR } from '../lib/zones'

interface Zone {
  x1: number; y1: number; x2: number; y2: number
  bg: string; z?: number
}

interface Label {
  text: string; cx: string; cy: string; sz: number; fw: number
  rotate?: number; align?: 'left' | 'center'; color?: string
}

interface Emotion {
  text: string; vx: number; ay: number
}

interface Props {
  vibes: Vibe[]
  onGridClick: (x: number, y: number) => void
  pendingVibe: PendingVibe | null
  showLabels: boolean
  showEmotions: boolean
  exploreMode: boolean
  onToggleLabels: () => void
  onToggleEmotions: () => void
  onToggleExplore: () => void
}

// ── Zone rectangles (x1/y1 = top-left %, x2/y2 = bottom-right %) ─────────────
// Derived from SVG mockup (grid 615×615). "It is what it is" is two rects:
// a horizontal band (0–57%, 43–61%) + a vertical column (42–57%, 61–100%),
// forming an upside-down T that divides the bottom-left and bottom-right zones.
const ZONES: Zone[] = [
  { x1:  0, y1:  0, x2: 42, y2: 43, bg: GRID_ZONE_COLOR.ball },
  { x1: 42, y1:  0, x2:100, y2: 61, bg: GRID_ZONE_COLOR.back },
  { x1: 78, y1:  0, x2:100, y2: 18, bg: GRID_ZONE_COLOR.lfg, z: 4 },
  { x1:  0, y1: 43, x2: 57, y2: 61, bg: GRID_ZONE_COLOR.whatitis, z: 2 },
  { x1: 42, y1: 61, x2: 57, y2:100, bg: GRID_ZONE_COLOR.whatitis, z: 2 },
  { x1:  0, y1: 61, x2: 42, y2:100, bg: GRID_ZONE_COLOR.over },
  { x1: 57, y1: 61, x2:100, y2:100, bg: GRID_ZONE_COLOR.vibing },
  { x1:  0, y1: 87, x2: 15, y2:100, bg: GRID_ZONE_COLOR.mwbs, z: 4 },
]

// Zone labels — cx/cy = anchor of zone. Layout matches the reference mockup:
// big bold blocks, a diagonal "we are so fucking back", a rotated "what it is".
const LABELS: Label[] = [
  { text: 'fuck it\nwe ball',         cx: '21%', cy: '21%', sz: 40, fw: 900, align: 'center' },
  { text: 'we are so\nfucking back',  cx: '66%', cy: '30%', sz: 34, fw: 900, align: 'center', rotate: 34 },
  { text: 'LETS FUCKING\nGOOOOOOOO', cx: '89%', cy: '9%',  sz: 11, fw: 700, align: 'center' },
  { text: 'it is',                    cx: '30%', cy: '52%', sz: 30, fw: 900, align: 'center' },
  { text: 'what\nit is',              cx: '49%', cy: '56%', sz: 30, fw: 900, align: 'center', rotate: -68 },
  { text: "it's so\nover",            cx: '21%', cy: '79%', sz: 36, fw: 900, align: 'center' },
  { text: 'we\nvibing',               cx: '78%', cy: '80%', sz: 36, fw: 900, align: 'center' },
  { text: 'log off\nforever',         cx: '7.5%', cy: '93%', sz: 10, fw: 700, align: 'center' },
]

// Emotion wheel — standard Russell Circumplex affect labels
const EMOTIONS: Emotion[] = [
  { text: 'tense',     vx: 2.5, ay: 9.5 },
  { text: 'afraid',    vx: 1.5, ay: 8.5 },
  { text: 'angry',     vx: 2.5, ay: 8   },
  { text: 'annoyed',   vx: 3.5, ay: 6.5 },
  { text: 'stressed',  vx: 3,   ay: 9   },
  { text: 'excited',   vx: 8.5, ay: 9   },
  { text: 'delighted', vx: 9.2, ay: 7.8 },
  { text: 'happy',     vx: 8.5, ay: 7   },
  { text: 'pleased',   vx: 8,   ay: 5.8 },
  { text: 'content',   vx: 8,   ay: 4.5 },
  { text: 'serene',    vx: 7,   ay: 3   },
  { text: 'relaxed',   vx: 7.5, ay: 2   },
  { text: 'calm',      vx: 6,   ay: 3.5 },
  { text: 'bored',     vx: 3.5, ay: 3.5 },
  { text: 'sad',       vx: 2,   ay: 4.5 },
  { text: 'depressed', vx: 1.5, ay: 2.5 },
  { text: 'tired',     vx: 4,   ay: 2   },
]

function toRel(valence: number, arousal: number) {
  return { rx: (valence - 1) / 9, ry: 1 - (arousal - 1) / 9 }
}

function fromRel(rx: number, ry: number) {
  return {
    x: parseFloat((1 + rx * 9).toFixed(2)),
    y: parseFloat((10 - ry * 9).toFixed(2)),
  }
}

/** Daytime = logged between 06:00 and 17:59 local time. */
function isDaytime(createdAt: string): boolean {
  const h = new Date(createdAt).getHours()
  return h >= 6 && h < 18
}

function fmtStamp(ts: string): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

// ── Sun / moon glyphs — drawn in currentColor so the parent .vibe-point can
// animate them from white (default) to the zone color (explore mode) ─────────
function SunGlyph({ size }: { size: number }) {
  const r = size / 2
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    const x1 = r + Math.cos(a) * (r * 0.62)
    const y1 = r + Math.sin(a) * (r * 0.62)
    const x2 = r + Math.cos(a) * (r * 0.95)
    const y2 = r + Math.sin(a) * (r * 0.95)
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block' }}
      stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.4} strokeLinecap="round">
      <circle cx={r} cy={r} r={r * 0.42} fill="currentColor" fillOpacity={0.28}
        stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.4} />
      {rays}
    </svg>
  )
}

function MoonGlyph({ size }: { size: number }) {
  const maskId = useRef(`moon-${Math.random().toString(36).slice(2, 7)}`).current
  const r = size / 2
  const R = r * 0.78
  const cutCx = r + R * 0.42
  const cutCy = r - R * 0.10
  const cutR  = R * 0.82
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <defs>
        <mask id={maskId}>
          <rect width={size} height={size} fill="white" />
          <circle cx={cutCx} cy={cutCy} r={cutR} fill="black" />
        </mask>
      </defs>
      <circle cx={r} cy={r} r={R}
        fill="currentColor" fillOpacity={0.28}
        stroke="currentColor" strokeOpacity={0.55}
        strokeWidth={1.2}
        mask={`url(#${maskId})`}
      />
      <circle cx={cutCx} cy={cutCy} r={cutR}
        fill="none"
        stroke="currentColor" strokeOpacity={0.18}
        strokeWidth={1.0}
        mask={`url(#${maskId})`}
      />
    </svg>
  )
}

function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])
  return isMobile
}

export default function MoodGrid({
  vibes, onGridClick, pendingVibe,
  showLabels, showEmotions, exploreMode,
  onToggleLabels, onToggleEmotions, onToggleExplore,
}: Props) {
  const gridRef    = useRef<HTMLDivElement>(null)
  const isMobile   = useIsMobile()
  const labelScale = isMobile ? 0.5 : 1
  const dotSize    = isMobile ? 16 : 20

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (exploreMode) return // in explore mode the grid is read-only
    if (!gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const ry = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height))
    const { x, y } = fromRel(rx, ry)
    onGridClick(x, y)
  }

  return (
    <div className="grid-outer">
      <div className="y-axis">
        <span>↓ low energy &nbsp;·&nbsp; high energy ↑</span>
      </div>

      <div className="grid-col">
        {/* Header strip: toggles sit top-right, before the notes column */}
        <div className="grid-header">
          <div className="grid-toggles">
            <button
              className={`grid-toggle ${showLabels ? 'grid-toggle--on' : ''}`}
              onClick={onToggleLabels}
            >
              labels
            </button>
            <button
              className={`grid-toggle ${showEmotions ? 'grid-toggle--on' : ''}`}
              onClick={onToggleEmotions}
            >
              emotion wheel
            </button>
            <button
              className={`grid-toggle ${exploreMode ? 'grid-toggle--on' : ''}`}
              onClick={onToggleExplore}
            >
              explore
            </button>
          </div>
        </div>

        <div
          ref={gridRef}
          className={`grid-area ${exploreMode ? 'grid-area--explore' : ''}`}
          onClick={handleClick}
        >

          {/* Background zones — clean rectangles using left/top/right/bottom */}
          {ZONES.map((z, i) => (
            <div key={i} style={{
              position: 'absolute',
              left:   `${z.x1}%`,
              top:    `${z.y1}%`,
              right:  `${100 - z.x2}%`,
              bottom: `${100 - z.y2}%`,
              background: z.bg,
              zIndex: z.z ?? 1,
              pointerEvents: 'none',
            }} />
          ))}

          {/* Zone labels (toggleable) */}
          {showLabels && LABELS.map((l, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: l.cx, top: l.cy,
              transform: `translate(-50%, -50%)${l.rotate ? ` rotate(${l.rotate}deg)` : ''}`,
              fontSize: l.sz * labelScale,
              fontWeight: l.fw,
              color: l.color ?? '#141414',
              lineHeight: 1.02,
              whiteSpace: 'pre-line',
              textAlign: l.align ?? 'center',
              letterSpacing: '-0.01em',
              zIndex: 6, pointerEvents: 'none',
              fontFamily: "'Impact', 'Franklin Gothic Heavy', 'Arial Narrow Bold', sans-serif",
            }}>
              {l.text}
            </div>
          ))}

          {/* Emotion wheel overlay (toggleable) */}
          {showEmotions && EMOTIONS.map((em, i) => {
            const { rx, ry } = toRel(em.vx, em.ay)
            return (
              <div key={i} style={{
                position: 'absolute',
                left: `${rx * 100}%`,
                top:  `${ry * 100}%`,
                transform: 'translate(-50%, -50%)',
                fontSize: isMobile ? 7 : 9,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.6)',
                letterSpacing: '0.04em',
                textTransform: 'lowercase',
                textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                zIndex: 7, pointerEvents: 'none',
                whiteSpace: 'nowrap',
                fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
              }}>
                {em.text}
              </div>
            )
          })}

          {/* Plotted vibes — sun (day) / moon (night) glyphs */}
          {vibes.map(v => {
            const { rx, ry } = toRel(v.valence, v.arousal)
            const day = isDaytime(v.created_at)
            const flip = rx > 0.62
            // In explore mode the glyph (and its tooltip accent, via currentColor)
            // animates to the zone color it sits in; otherwise it stays white.
            return (
              <div
                key={v.id}
                className={`vibe-point ${exploreMode ? 'vibe-point--explore' : ''}`}
                style={{
                  left: `${rx * 100}%`,
                  top:  `${ry * 100}%`,
                  width: dotSize, height: dotSize,
                  color: exploreMode ? gridColor(v.valence, v.arousal) : undefined,
                }}
                aria-label={day ? 'logged during the day' : 'logged at night'}
              >
                {day ? <SunGlyph size={dotSize} /> : <MoonGlyph size={dotSize} />}

                {exploreMode && (
                  <div className={`vibe-tip ${flip ? 'vibe-tip--left' : ''}`}>
                    <div className="vibe-tip-head">
                      <span className="vibe-tip-glyph">{day ? '☀' : '☾'}</span>
                      <span className="vibe-tip-coord">({v.valence}, {v.arousal})</span>
                    </div>
                    {v.note && <div className="vibe-tip-note">{v.note}</div>}
                    <div className="vibe-tip-stamp">{fmtStamp(v.created_at)}</div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Pending (unsaved) vibe */}
          {pendingVibe && (() => {
            const { rx, ry } = toRel(pendingVibe.x, pendingVibe.y)
            return (
              <div
                className="vibe-pending"
                style={{ left: `${rx * 100}%`, top: `${ry * 100}%` }}
              />
            )
          })()}
        </div>

        <div className="x-axis">
          <span>← unpleasant &nbsp;·&nbsp; pleasant →</span>
        </div>
      </div>
    </div>
  )
}
