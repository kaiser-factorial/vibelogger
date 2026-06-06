import { useState } from 'react'
import { getZone, ZONE_META } from '../lib/zones'
import { vibeColor } from '../lib/vibeColor'
import type { Vibe } from '../types'

interface Props {
  vibe: Vibe
  onClose: () => void
}

export interface SharePayload {
  z: string
  v: number
  a: number
  t: string
  n?: string
}

export function encodeShare(vibe: Vibe): string {
  const payload: SharePayload = {
    z: getZone(vibe.valence, vibe.arousal),
    v: vibe.valence,
    a: vibe.arousal,
    t: vibe.created_at,
    ...(vibe.note_public && vibe.note ? { n: vibe.note } : {}),
  }
  return btoa(JSON.stringify(payload))
}

export default function ShareModal({ vibe, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  const zone    = getZone(vibe.valence, vibe.arousal)
  const meta    = ZONE_META[zone]
  const color   = vibeColor(vibe.valence, vibe.arousal)
  const date    = new Date(vibe.created_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })

  function copyLink() {
    const token = encodeShare(vibe)
    const url   = `${window.location.origin}?share=${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-coords">share vibe</div>

        <div className="share-card" style={{ borderLeftColor: meta.color }}>
          <div className="share-card-zone" style={{ color: meta.color }}>{meta.label}</div>
          <div className="share-card-coords">
            <span className="share-dot" style={{ background: color }} />
            v {vibe.valence.toFixed(1)} · a {vibe.arousal.toFixed(1)}
          </div>
          {vibe.note_public && vibe.note && (
            <div className="share-card-note">"{vibe.note}"</div>
          )}
          <div className="share-card-date">{date}</div>
          <div className="share-card-brand">vibeslogger</div>
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={copyLink}>
            {copied ? 'copied!' : 'copy link'}
          </button>
          <button className="btn-ghost" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  )
}
