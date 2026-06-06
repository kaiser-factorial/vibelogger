import { useState } from 'react'
import { supabase } from '../lib/supabase'

type AuthMode = 'magic' | 'password'

export default function Auth() {
  const [mode,     setMode]     = useState<AuthMode>('magic')
  const [isSignUp, setIsSignUp] = useState(false)
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  function switchMode(m: AuthMode) { setMode(m); setError(null); setSent(false) }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    if (isSignUp) {
      // Flag has_password so the header's "set password" button never shows.
      const { error } = await supabase.auth.signUp({
        email, password, options: { data: { has_password: true } },
      })
      setLoading(false)
      if (error) setError(error.message)
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      // Backfill the flag for accounts created before it existed — signing in
      // with a password proves one is set.
      if (!error && data.user && !data.user.user_metadata?.has_password) {
        await supabase.auth.updateUser({ data: { has_password: true } })
      }
      setLoading(false)
      if (error) setError(error.message)
    }
    // success: onAuthStateChange in App.tsx handles session
  }

  if (sent) return (
    <div className="auth-wrap">
      <h1>vibeslogger</h1>
      <p>check your email — magic link sent to <strong>{email}</strong></p>
      <button className="btn-ghost" onClick={() => setSent(false)}>use a different email</button>
    </div>
  )

  return (
    <div className="auth-wrap">
      <h1>vibeslogger</h1>
      <p className="auth-sub">log your position on the vibe spectrum</p>

      <div className="auth-modes">
        <button
          className={`auth-mode-tab ${mode === 'magic' ? 'auth-mode-tab--active' : ''}`}
          onClick={() => switchMode('magic')}
        >
          magic link
        </button>
        <button
          className={`auth-mode-tab ${mode === 'password' ? 'auth-mode-tab--active' : ''}`}
          onClick={() => switchMode('password')}
        >
          password
        </button>
      </div>

      {mode === 'magic' ? (
        <form onSubmit={handleMagicLink} className="auth-form">
          <input
            type="email" placeholder="your email" value={email}
            onChange={e => setEmail(e.target.value)} required autoFocus
          />
          <button type="submit" disabled={loading}>
            {loading ? 'sending...' : 'send magic link'}
          </button>
        </form>
      ) : (
        <form onSubmit={handlePassword} className="auth-form">
          <input
            type="email" placeholder="your email" value={email}
            onChange={e => setEmail(e.target.value)} required autoFocus
          />
          <input
            type="password" placeholder="password" value={password}
            onChange={e => setPassword(e.target.value)} required minLength={6}
          />
          <button type="submit" disabled={loading}>
            {loading ? '...' : isSignUp ? 'create account' : 'sign in'}
          </button>
          <button
            type="button" className="btn-ghost auth-toggle"
            onClick={() => { setIsSignUp(v => !v); setError(null) }}
          >
            {isSignUp ? 'already have an account? sign in' : "new here? create account"}
          </button>
        </form>
      )}

      {error && <p className="auth-error">{error}</p>}
    </div>
  )
}
