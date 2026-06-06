import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

import { supabase } from '../lib/supabase'
import useFollows from '../hooks/useFollows'

const mockFrom = vi.mocked(supabase.from)

// Session is created ONCE per test, NOT inside the renderHook callback.
// A new object on every render changes the useEffect([session]) dependency
// every cycle, causing infinite re-fires.
function fakeSession(userId = 'user-1'): Session {
  return { user: { id: userId } } as unknown as Session
}

/** Thenable chain object. Each method returns itself; await resolves with `result`. */
function chain(result: object) {
  const c: any = {
    select: vi.fn(() => c),
    insert: vi.fn(() => c),
    delete: vi.fn(() => c),
    eq:     vi.fn(() => c),
    match:  vi.fn(() => c),
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
    catch(onRejected: (r: unknown) => unknown) {
      return Promise.resolve(result).catch(onRejected)
    },
  }
  return c as ReturnType<typeof supabase.from>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useFollows', () => {
  it('starts with an empty set when session is null', () => {
    const { result } = renderHook(() => useFollows(null))
    expect(result.current.followingIds.size).toBe(0)
    expect(result.current.loading).toBe(false)
  })

  it('loads existing follows from the database on mount', async () => {
    mockFrom.mockReturnValue(chain({ data: [{ followee_id: 'u2' }, { followee_id: 'u3' }], error: null }))
    const session = fakeSession()
    const { result } = renderHook(() => useFollows(session))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.followingIds.has('u2')).toBe(true)
    expect(result.current.followingIds.has('u3')).toBe(true)
  })

  it('handles a missing / empty follows table gracefully', async () => {
    mockFrom.mockReturnValue(chain({ data: null, error: { message: 'relation "follows" does not exist' } }))
    const session = fakeSession()
    const { result } = renderHook(() => useFollows(session))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.followingIds.size).toBe(0)
  })

  it('optimistically adds a user on follow', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [], error: null }))
    const session = fakeSession()
    const { result } = renderHook(() => useFollows(session))
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }))
    await act(async () => { await result.current.follow('u2') })

    expect(result.current.followingIds.has('u2')).toBe(true)
  })

  it('reverts the optimistic follow when the insert fails', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [], error: null }))
    const session = fakeSession()
    const { result } = renderHook(() => useFollows(session))
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValueOnce(chain({ data: null, error: { message: 'relation does not exist' } }))
    await act(async () => { await result.current.follow('u2') })

    expect(result.current.followingIds.has('u2')).toBe(false)
  })

  it('optimistically removes a user on unfollow', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [{ followee_id: 'u2' }], error: null }))
    const session = fakeSession()
    const { result } = renderHook(() => useFollows(session))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.followingIds.has('u2')).toBe(true)

    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }))
    await act(async () => { await result.current.unfollow('u2') })

    expect(result.current.followingIds.has('u2')).toBe(false)
  })

  it('reverts the optimistic unfollow when the delete fails', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [{ followee_id: 'u2' }], error: null }))
    const session = fakeSession()
    const { result } = renderHook(() => useFollows(session))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.followingIds.has('u2')).toBe(true)

    mockFrom.mockReturnValueOnce(chain({ data: null, error: { message: 'network error' } }))
    await act(async () => { await result.current.unfollow('u2') })

    expect(result.current.followingIds.has('u2')).toBe(true)
  })
})
