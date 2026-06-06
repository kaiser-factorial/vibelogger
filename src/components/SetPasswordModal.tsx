import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  onClose: () => void
}

export default function SetPasswordModal({ onClose }: Props) {
  const [password, setPassword]   = useState('')
  const [confirm,  setConfirm]    = useState('')
  const [loading,  setLoading]    = useState(false)
  const [done,     setDone]       = useState(false)
  const [error,    setError]      = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError("passwords don't match"); return }
    setLoading(true); setError(null)
    // Flag has_password so the header's "set password" button hides once set.
    const { error } = await supabase.auth.updateUser({ password, data: { has_password: true } })
    setLoading(false)
    if (error) setError(error.message)
    else setDone(true)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {done ? (
          <>
            <div className="modal-coords">password set</div>
            <p style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>
              you can now sign in with email + password next time.
            </p>
            <button className="btn-primary" onClick={onClose}>done</button>
          </>
        ) : (
          <>
            <div className="modal-coords">set a password for your account</div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="password" placeholder="new password (min 6 chars)"
                value={password} onChange={e => setPassword(e.target.value)}
                required minLength={6} autoFocus
                className="modal-input"
              />
              <input
                type="password" placeholder="confirm password"
                value={confirm} onChange={e => setConfirm(e.target.value)}
                required className="modal-input"
              />
              {error && <p className="auth-error">{error}</p>}
              <div className="modal-actions">
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'saving...' : 'set password'}
                </button>
                <button type="button" className="btn-ghost" onClick={onClose}>cancel</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
