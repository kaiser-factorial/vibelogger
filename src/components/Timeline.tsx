import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import useTimeline from '../hooks/useTimeline'
import useUserSearch from '../hooks/useUserSearch'
import { getZone, gridColor, ZONE_META, ZONE_ORDER } from '../lib/zones'
import type { ZoneId } from '../lib/zones'
import type { TimelineEntry } from '../types'

interface Props {
  session: Session
  followingIds: Set<string>
  blockedIds: Set<string>
  follow: (userId: string) => Promise<void>
  unfollow: (userId: string) => Promise<void>
  onOpenProfile: (userId: string) => void
}

type FeedFilter = 'everyone' | 'following'

function timeAgo(ts: string): string {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function inDateRange(ts: string, from: string, to: string): boolean {
  const d = new Date(ts)
  if (from && d < new Date(from)) return false
  if (to) {
    const end = new Date(to)
    end.setHours(23, 59, 59, 999)
    if (d > end) return false
  }
  return true
}

// ── User search ──────────────────────────────────────────────────────────────

interface UserSearchProps {
  session: Session
  followingIds: Set<string>
  follow: (userId: string) => Promise<void>
  unfollow: (userId: string) => Promise<void>
  onOpenProfile: (userId: string) => void
}

function UserSearchBox({ session, followingIds, follow, unfollow, onOpenProfile }: UserSearchProps) {
  const [term, setTerm] = useState('')
  const { results, loading } = useUserSearch(term, session.user.id)
  const trimmed = term.trim()

  return (
    <div className="user-search">
      <input
        className="user-search-input"
        type="text"
        value={term}
        onChange={e => setTerm(e.target.value)}
        placeholder="search people by @username..."
        spellCheck={false}
      />
      {trimmed && (
        <div className="user-search-results">
          {loading ? (
            <div className="user-search-status">searching...</div>
          ) : results.length === 0 ? (
            <div className="user-search-status">no users found matching "{trimmed}"</div>
          ) : (
            results.map(p => {
              const isFollowing = followingIds.has(p.id)
              return (
                <div key={p.id} className="user-search-row">
                  <button className="user-search-name" onClick={() => onOpenProfile(p.id)}>
                    @{p.username}
                  </button>
                  <button
                    className={`follow-btn ${isFollowing ? 'follow-btn--following' : ''}`}
                    onClick={() => isFollowing ? unfollow(p.id) : follow(p.id)}
                  >
                    {isFollowing ? 'following' : 'follow'}
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ── Similar vibers ───────────────────────────────────────────────────────────

interface SimilarVibersProps {
  entries: TimelineEntry[]
  currentUserId: string
  followingIds: Set<string>
  follow: (userId: string) => Promise<void>
  unfollow: (userId: string) => Promise<void>
  onOpenProfile: (userId: string) => void
}

interface UserData {
  counts: Partial<Record<ZoneId, number>>
  total: number
  username: string
}

function SimilarVibers({ entries, currentUserId, followingIds, follow, unfollow, onOpenProfile }: SimilarVibersProps) {
  const [isOpen, setIsOpen] = useState(false)
  const byUser: Record<string, UserData> = {}
  entries.forEach(e => {
    if (!byUser[e.user_id]) byUser[e.user_id] = { counts: {}, total: 0, username: e.username }
    const z = getZone(e.valence, e.arousal)
    byUser[e.user_id].counts[z] = (byUser[e.user_id].counts[z] ?? 0) + 1
    byUser[e.user_id].total++
  })

  const toVec = (d: UserData) => ZONE_ORDER.map(z => (d.counts[z] ?? 0) / d.total)
  const myData = byUser[currentUserId]
  if (!myData || myData.total < 5) return null

  const myVec = toVec(myData)
  const SQRT2  = Math.sqrt(2)

  const matches = Object.entries(byUser)
    .filter(([uid, d]) => uid !== currentUserId && d.total >= 3)
    .map(([uid, d]) => {
      const theirVec = toVec(d)
      const dist = Math.sqrt(myVec.reduce((s, v, i) => s + (v - theirVec[i]) ** 2, 0))
      return { uid, username: d.username, pct: Math.round((1 - dist / SQRT2) * 100) }
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)

  if (!matches.length) return null

  return (
    <div className="similar-vibers">
      <div 
        className="timeline-section-title"
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', userSelect: 'none' }}
        onClick={() => setIsOpen(!isOpen)}
      >
        similar vibers <span style={{ fontSize: '11px', opacity: 0.6 }}>{isOpen ? '▲' : '▼'}</span>
      </div>
      {isOpen && (
        <>
          <div className="similar-sub">based on zone distribution across all public entries</div>
          <div className="similar-list">
            {matches.map(m => {
              const isFollowing = followingIds.has(m.uid)
              return (
                <div key={m.uid} className="similar-row">
                  <button className="similar-name similar-name--clickable" onClick={() => onOpenProfile(m.uid)}>
                    @{m.username}
                  </button>
                  <div className="similar-bar-track">
                    <div className="similar-bar-fill" style={{ width: `${m.pct}%` }} />
                  </div>
                  <span className="similar-pct">{m.pct}%</span>
                  <button
                    className={`follow-btn ${isFollowing ? 'follow-btn--following' : ''}`}
                    onClick={() => isFollowing ? unfollow(m.uid) : follow(m.uid)}
                  >
                    {isFollowing ? 'following' : 'follow'}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export default function Timeline({ session, followingIds, blockedIds, follow, unfollow, onOpenProfile }: Props) {
  const { entries, loading, loadingMore, hasMore, loadMore } = useTimeline(session)
  const [filter,   setFilter]   = useState<FeedFilter>('everyone')
  const [from,     setFrom]     = useState('')
  const [to,       setTo]       = useState('')
  const [zones,    setZones]    = useState<Set<ZoneId>>(new Set())
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  function toggleZone(z: ZoneId) {
    setZones(prev => {
      const next = new Set(prev)
      next.has(z) ? next.delete(z) : next.add(z)
      return next
    })
  }

  if (loading) return <div className="loading">loading timeline...</div>

  const hasDateFilter = from || to
  const hasZoneFilter = zones.size > 0
  const hasAnyFilter  = hasDateFilter || hasZoneFilter

  const unblocked = entries.filter(e => !blockedIds.has(e.user_id))

  const feedFiltered = filter === 'following'
    ? unblocked.filter(e => e.user_id === session.user.id || followingIds.has(e.user_id))
    : unblocked

  const visibleEntries = feedFiltered.filter(e =>
    inDateRange(e.created_at, from, to) &&
    (!hasZoneFilter || zones.has(getZone(e.valence, e.arousal)))
  )

  return (
    <div className="timeline-wrap">
      <SimilarVibers
        entries={entries}
        currentUserId={session.user.id}
        followingIds={followingIds}
        follow={follow}
        unfollow={unfollow}
        onOpenProfile={onOpenProfile}
      />

      <UserSearchBox
        session={session}
        followingIds={followingIds}
        follow={follow}
        unfollow={unfollow}
        onOpenProfile={onOpenProfile}
      />

      <div className="timeline-header-row">
        <div className="timeline-section-title" style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>timeline</div>
        <div className="timeline-filter">
          <button
            className={`timeline-filter-btn ${filter === 'everyone' ? 'timeline-filter-btn--active' : ''}`}
            onClick={() => setFilter('everyone')}
          >
            everyone
          </button>
          <button
            className={`timeline-filter-btn ${filter === 'following' ? 'timeline-filter-btn--active' : ''}`}
            onClick={() => setFilter('following')}
          >
            following{followingIds.size > 0 ? ` (${followingIds.size})` : ''}
          </button>
        </div>
      </div>
      <div className="timeline-sub">
        {filter === 'following'
          ? followingIds.size === 0
            ? 'follow someone from the similar vibers list to see their posts here'
            : 'posts from people you follow + your own'
          : 'public vibes from everyone'}
      </div>

      <div style={{ marginBottom: '16px' }}>
        <button
          style={{ 
            width: '100%',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--muted)',
            padding: '9px 12px', 
            fontSize: '12px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
          onClick={() => setFiltersExpanded(!filtersExpanded)}
        >
          <span>filter vibes...</span>
          <span style={{ fontSize: '10px' }}>{filtersExpanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {filtersExpanded && (
        <div className="timeline-mood-filter">
          <label className="filter-label">from</label>
          <input type="date" className="filter-input" value={from} onChange={e => setFrom(e.target.value)} />
          <label className="filter-label">to</label>
          <input type="date" className="filter-input" value={to} onChange={e => setTo(e.target.value)} />
          <div className="zone-filter-chips">
            {ZONE_ORDER.map(z => (
              <button
                key={z}
                className={`zone-chip ${zones.has(z) ? 'zone-chip--active' : ''}`}
                style={zones.has(z) ? { background: ZONE_META[z].color, color: '#111', borderColor: ZONE_META[z].color } : undefined}
                onClick={() => toggleZone(z)}
                title={ZONE_META[z].label}
              >
                {ZONE_META[z].label}
              </button>
            ))}
          </div>
          {hasAnyFilter && (
            <button className="btn-ghost filter-clear" onClick={() => { setFrom(''); setTo(''); setZones(new Set()) }}>
              clear filters
            </button>
          )}
        </div>
      )}

      {visibleEntries.length === 0 ? (
        <div className="timeline-empty">
          {hasAnyFilter
            ? 'no vibes match these filters'
            : filter === 'following' ? 'nothing here yet' : 'no public vibes yet — be the first'}
        </div>
      ) : (
        <div className="timeline-feed">
          {visibleEntries.map(e => {
            const zone = getZone(e.valence, e.arousal)
            const meta = ZONE_META[zone]
            const isOwn = e.user_id === session.user.id
            return (
              <div key={e.id} className={`tl-entry${isOwn ? ' tl-entry--own' : ''}`}>
                <span className="tl-dot" style={{ background: gridColor(e.valence, e.arousal) }} />
                <div className="tl-body">
                  <div className="tl-top">
                    <span className="tl-zone" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="tl-meta">
                      <button className="tl-username" onClick={() => onOpenProfile(e.user_id)}>@{e.username}</button>
                      {' '}· {timeAgo(e.created_at)}
                    </span>
                  </div>
                  {e.note_public && e.note && (
                    <div className="tl-note">{e.note}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {filter === 'everyone' && !hasAnyFilter && (hasMore || loadingMore) && (
        <button
          className="tl-load-more"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'loading...' : 'load more'}
        </button>
      )}
    </div>
  )
}
