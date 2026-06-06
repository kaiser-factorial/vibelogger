import { useState, useEffect, useRef } from 'react'
import { gridColor } from '../lib/zones'
import type { Vibe } from '../types'
import ShareModal from './ShareModal'

interface Props {
  vibes: Vibe[]
  onDelete: (id: string) => Promise<{ error: Error | null }>
  onUpdate: (id: string, note: string | null) => Promise<{ error: Error | null }>
}

const LOCK_AFTER_MS  = 3 * 60 * 60 * 1000
const UNDO_WINDOW_MS = 5000

function isLocked(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > LOCK_AFTER_MS
}

function fmtDate(ts: string): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString()
}

interface PendingDelete {
  vibe: Vibe
  timerId: ReturnType<typeof setTimeout>
  startedAt: number
}

export default function MoodTable({ vibes, onDelete, onUpdate }: Props) {
  const [editingId,     setEditingId]     = useState<string | null>(null)
  const [editNote,      setEditNote]      = useState('')
  const [saving,        setSaving]        = useState(false)
  const [sharingVibe,   setSharingVibe]   = useState<Vibe | null>(null)
  const [pendingDeletes, setPendingDeletes] = useState<Map<string, PendingDelete>>(new Map())
  const [tick,          setTick]          = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tick every 250ms so the countdown numbers stay live while there are pending deletes
  useEffect(() => {
    if (pendingDeletes.size > 0) {
      tickRef.current = setInterval(() => setTick(t => t + 1), 250)
    } else {
      if (tickRef.current) clearInterval(tickRef.current)
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [pendingDeletes.size])

  function startDelete(v: Vibe) {
    const timerId = setTimeout(async () => {
      await onDelete(v.id)
      setPendingDeletes(prev => { const m = new Map(prev); m.delete(v.id); return m })
    }, UNDO_WINDOW_MS)
    setPendingDeletes(prev => new Map(prev).set(v.id, { vibe: v, timerId, startedAt: Date.now() }))
    setEditingId(null)
  }

  function undoDelete(id: string) {
    const entry = pendingDeletes.get(id)
    if (entry) clearTimeout(entry.timerId)
    setPendingDeletes(prev => { const m = new Map(prev); m.delete(id); return m })
  }

  function startEdit(v: Vibe) {
    setEditingId(v.id)
    setEditNote(v.note ?? '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditNote('')
  }

  async function saveEdit(id: string) {
    setSaving(true)
    await onUpdate(id, editNote.trim() || null)
    setSaving(false)
    setEditingId(null)
    setEditNote('')
  }

  const displayedVibes = vibes.filter(v => !pendingDeletes.has(v.id))

  if (displayedVibes.length === 0 && pendingDeletes.size === 0) return (
    <div className="table-empty">no vibes logged yet</div>
  )

  return (
    <div className="table-wrap">
      <div className="table-header">
        recorded moods <span className="table-count">{displayedVibes.length}</span>
      </div>

      {displayedVibes.length > 0 && (
        <table className="vibe-table">
          <thead>
            <tr>
              <th>date</th><th>time</th><th>mood</th><th>notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {displayedVibes.map(v => {
              const locked  = isLocked(v.created_at)
              const editing = editingId === v.id

              return (
                <tr key={v.id}>
                  <td className="td-muted">{fmtDate(v.created_at)}</td>
                  <td className="td-muted">{fmtTime(v.created_at)}</td>
                  <td className="td-mono">
                    <span className="vibe-dot"
                      style={{ background: gridColor(v.valence, v.arousal) }} />
                    ({v.valence}, {v.arousal})
                  </td>
                  <td className="td-note">
                    {editing ? (
                      <input
                        className="note-edit-input"
                        value={editNote}
                        onChange={e => setEditNote(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  saveEdit(v.id)
                          if (e.key === 'Escape') cancelEdit()
                        }}
                        autoFocus disabled={saving}
                      />
                    ) : (
                      v.note ?? <span className="td-empty">—</span>
                    )}
                  </td>
                  <td className="td-actions">
                    {editing ? (
                      <div className="row-actions">
                        <button className="btn-save" onClick={() => saveEdit(v.id)} disabled={saving}>
                          {saving ? '...' : 'save'}
                        </button>
                        <button className="btn-cancel-edit" onClick={cancelEdit}>×</button>
                      </div>
                    ) : (
                      <div className="row-actions">
                        {v.public && (
                          <button className="btn-share" onClick={() => setSharingVibe(v)}
                            title="share">↗</button>
                        )}
                        {locked ? (
                          <span className="entry-locked" title="locked after 3 hours">·</span>
                        ) : (
                          <>
                            <button className="btn-edit" onClick={() => startEdit(v)}>edit</button>
                            <button className="btn-delete" onClick={() => startDelete(v)}
                              title="delete">×</button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {sharingVibe && (
        <ShareModal vibe={sharingVibe} onClose={() => setSharingVibe(null)} />
      )}

      {/* Undo toast */}
      {pendingDeletes.size > 0 && (
        <div className="undo-toast-stack">
          {[...pendingDeletes.entries()].map(([id, { startedAt }]) => {
            const elapsed = Date.now() - startedAt
            const remaining = Math.max(0, Math.ceil((UNDO_WINDOW_MS - elapsed) / 1000))
            void tick // force re-render via tick
            return (
              <div key={id} className="undo-toast">
                <span className="undo-toast-msg">entry deleted</span>
                <button className="undo-toast-btn" onClick={() => undoDelete(id)}>
                  undo ({remaining}s)
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
