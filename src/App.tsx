import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Auth from './components/Auth'
import MoodGrid from './components/MoodGrid'
import MoodTable from './components/MoodTable'
import MoodModal from './components/MoodModal'
import Analysis from './components/Analysis'
import Timeline from './components/Timeline'
import SetPasswordModal from './components/SetPasswordModal'
import EditUsernameModal from './components/EditUsernameModal'
import PublicShareView from './components/PublicShareView'
import useVibes from './hooks/useVibes'
import useFollows from './hooks/useFollows'
import useProfile from './hooks/useProfile'
import useAccent from './hooks/useAccent'
import type { PendingVibe } from './types'

type View = 'log' | 'analysis' | 'timeline'

// Resolved once at module load — share links are static URLs, no reactivity needed
const SHARE_TOKEN = new URLSearchParams(window.location.search).get('share')

export default function App() {
  const [session,     setSession]     = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [expanded,    setExpanded]    = useState(() => localStorage.getItem('vl-has-vibes') === 'true')
  const [view,        setView]        = useState<View>('log')
  const [pendingVibe,     setPendingVibe]     = useState<PendingVibe | null>(null)
  const [settingPassword,  setSettingPassword]  = useState(false)
  const [editingUsername,  setEditingUsername]  = useState(false)
  const [showLabels,      setShowLabels]      = useState(true)
  const [showEmotions,    setShowEmotions]    = useState(false)
  const [exploreMode,     setExploreMode]     = useState(false)

  const { vibes, loading, addVibe, updateVibe, deleteVibe } = useVibes(session)
  const { followingIds, follow, unfollow } = useFollows(session)
  const { username, updateUsername } = useProfile(session)
  const { setAccentFromVibe } = useAccent(session)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (vibes.length > 0) {
      setExpanded(true)
      localStorage.setItem('vl-has-vibes', 'true')
    }
  }, [vibes])

  function handleGridClick(x: number, y: number) {
    setPendingVibe({ x, y })
    if (!expanded) setExpanded(true)
  }

  async function handleModalSubmit(note: string, isPublic: boolean, isNotePublic: boolean) {
    if (!pendingVibe) return
    const { error } = await addVibe({ x: pendingVibe.x, y: pendingVibe.y, note, isPublic, isNotePublic })
    // Recolor the UI to match the just-logged vibe's zone.
    if (!error) setAccentFromVibe(pendingVibe.x, pendingVibe.y)
    setPendingVibe(null)
  }

  if (SHARE_TOKEN) return <PublicShareView token={SHARE_TOKEN} />
  if (authLoading) return <div className="loading">loading...</div>
  if (!session)    return <Auth />

  const layoutClass = (view === 'analysis' || view === 'timeline')
    ? 'app--analysis'
    : expanded ? 'app--expanded' : 'app--landing'

  return (
    <div className={`app ${layoutClass}`}>
      <header className="app-header">
        <div className="app-header-top">
          <div className="app-title-group">
            <h1 className="app-title">vibeslogger</h1>
            {view === 'log' && !expanded && (
              <p className="app-subtitle">click to log a vibe</p>
            )}
          </div>
          <div className="header-actions">
            {username && (
              <button className="btn-username" onClick={() => setEditingUsername(true)}>
                @{username}
              </button>
            )}
            {!session.user.user_metadata?.has_password && (
              <button className="btn-setpw" onClick={() => setSettingPassword(true)}>
                set password
              </button>
            )}
            <button className="btn-signout" onClick={() => supabase.auth.signOut()}>
              sign out
            </button>
          </div>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-tab ${view === 'log' ? 'nav-tab--active' : ''}`}
            onClick={() => setView('log')}
          >
            log
          </button>
          <button
            className={`nav-tab ${view === 'analysis' ? 'nav-tab--active' : ''}`}
            onClick={() => setView('analysis')}
          >
            analyze
          </button>
          <button
            className={`nav-tab ${view === 'timeline' ? 'nav-tab--active' : ''}`}
            onClick={() => setView('timeline')}
          >
            timeline
          </button>
        </nav>
      </header>

      <main className="app-main">
        {view === 'log' ? (
          <>
            <div className="panel-grid">
              <MoodGrid
                vibes={vibes}
                onGridClick={handleGridClick}
                pendingVibe={pendingVibe}
                showLabels={showLabels}
                showEmotions={showEmotions}
                exploreMode={exploreMode}
                onToggleLabels={() => setShowLabels(v => !v)}
                onToggleEmotions={() => setShowEmotions(v => !v)}
                onToggleExplore={() => setExploreMode(v => !v)}
              />
            </div>

            {expanded && (
              <div className="panel-table">
                {loading
                  ? <div className="loading">loading vibes...</div>
                  : <MoodTable vibes={vibes} onDelete={deleteVibe} onUpdate={updateVibe} />
                }
              </div>
            )}
          </>
        ) : view === 'analysis' ? (
          <div className="panel-analysis">
            <Analysis vibes={vibes} />
          </div>
        ) : (
          <div className="panel-analysis">
            <Timeline
            session={session}
            followingIds={followingIds}
            follow={follow}
            unfollow={unfollow}
          />
          </div>
        )}
      </main>

      {settingPassword && (
        <SetPasswordModal onClose={() => setSettingPassword(false)} />
      )}

      {editingUsername && username && (
        <EditUsernameModal
          currentUsername={username}
          onSave={updateUsername}
          onClose={() => setEditingUsername(false)}
        />
      )}

      {pendingVibe && (
        <MoodModal
          vibe={pendingVibe}
          onSubmit={handleModalSubmit}
          onClose={() => setPendingVibe(null)}
        />
      )}
    </div>
  )
}
