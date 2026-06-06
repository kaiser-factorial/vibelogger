import { ZONE_META } from '../lib/zones'
import { vibeColor } from '../lib/vibeColor'
import type { SharePayload } from './ShareModal'

interface Props {
  token: string
}

export default function PublicShareView({ token }: Props) {
  let payload: SharePayload | null = null
  try {
    payload = JSON.parse(atob(token)) as SharePayload
  } catch {
    // malformed token
  }

  if (!payload) {
    return (
      <div className="share-view">
        <div className="share-view-error">invalid share link</div>
        <a className="share-view-cta" href="/">open vibeslogger</a>
      </div>
    )
  }

  const meta  = ZONE_META[payload.z as keyof typeof ZONE_META] ?? ZONE_META['whatitis']
  const color = vibeColor(payload.v, payload.a)
  const date  = new Date(payload.t).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })

  return (
    <div className="share-view">
      <div className="share-view-card" style={{ borderLeftColor: meta.color }}>
        <div className="share-view-zone" style={{ color: meta.color }}>{meta.label}</div>
        <div className="share-view-coords">
          <span className="share-dot" style={{ background: color }} />
          v {payload.v.toFixed(1)} · a {payload.a.toFixed(1)}
        </div>
        {payload.n && (
          <div className="share-view-note">"{payload.n}"</div>
        )}
        <div className="share-view-date">{date}</div>
        <div className="share-card-brand">vibeslogger</div>
      </div>
      <a className="share-view-cta" href="/">log your own vibes</a>
    </div>
  )
}
