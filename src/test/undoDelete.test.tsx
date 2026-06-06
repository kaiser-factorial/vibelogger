import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import MoodTable from '../components/MoodTable'
import type { Vibe } from '../types'

vi.mock('../lib/vibeColor', () => ({ vibeColor: () => '#aaa' }))

function makeVibe(id: string): Vibe {
  // Note: created_at must be recent so isLocked() returns false
  return {
    id,
    user_id: 'u1',
    valence: 6,
    arousal: 5,
    note: null,
    public: false,
    note_public: false,
    created_at: new Date().toISOString(),
  }
}

const onDelete = vi.fn().mockResolvedValue({ error: null })
const onUpdate = vi.fn().mockResolvedValue({ error: null })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: Date.now() })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('undo delete', () => {
  it('renders all vibes initially (header + data rows)', () => {
    render(<MoodTable vibes={[makeVibe('a'), makeVibe('b')]} onDelete={onDelete} onUpdate={onUpdate} />)
    // thead row + 2 tbody rows
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('hides the row and shows an undo toast when × is clicked', () => {
    render(<MoodTable vibes={[makeVibe('a')]} onDelete={onDelete} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByTitle('delete'))

    // The table disappears entirely when all vibes are pending delete
    expect(screen.queryAllByRole('row')).toHaveLength(0)
    expect(screen.getByText('entry deleted')).toBeInTheDocument()
    expect(screen.getByText(/undo/i)).toBeInTheDocument()
  })

  it('restores the row when undo is clicked', async () => {
    render(<MoodTable vibes={[makeVibe('a')]} onDelete={onDelete} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByTitle('delete'))
    // Confirm row is hidden
    expect(screen.queryAllByRole('row')).toHaveLength(0)

    fireEvent.click(screen.getByText(/undo/i))

    // Row comes back (header + 1 data row)
    expect(screen.getAllByRole('row')).toHaveLength(2)
    // Toast gone
    expect(screen.queryByText('entry deleted')).not.toBeInTheDocument()
    // onDelete was NOT called
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('calls onDelete after 5 seconds when undo is not clicked', async () => {
    render(<MoodTable vibes={[makeVibe('a')]} onDelete={onDelete} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByTitle('delete'))
    expect(onDelete).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(5001)
    })

    expect(onDelete).toHaveBeenCalledWith('a')
  })

  it('does NOT call onDelete when undo is clicked before the timer fires', async () => {
    render(<MoodTable vibes={[makeVibe('a')]} onDelete={onDelete} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByTitle('delete'))
    fireEvent.click(screen.getByText(/undo/i))

    await act(async () => {
      vi.advanceTimersByTime(5001)
    })

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('handles two simultaneous pending deletes, each with its own toast', () => {
    render(<MoodTable vibes={[makeVibe('a'), makeVibe('b')]} onDelete={onDelete} onUpdate={onUpdate} />)

    const delBtns = screen.getAllByTitle('delete')
    fireEvent.click(delBtns[0])
    fireEvent.click(delBtns[1])

    // Both rows hidden
    expect(screen.queryAllByRole('row')).toHaveLength(0)
    // Two toasts
    expect(screen.getAllByText('entry deleted')).toHaveLength(2)
  })

  it('undo on one of two pending deletes restores only that row', async () => {
    render(<MoodTable vibes={[makeVibe('a'), makeVibe('b')]} onDelete={onDelete} onUpdate={onUpdate} />)

    const delBtns = screen.getAllByTitle('delete')
    fireEvent.click(delBtns[0])
    fireEvent.click(delBtns[1])

    // Undo the first toast
    fireEvent.click(screen.getAllByText(/undo/i)[0])

    // One row comes back
    expect(screen.getAllByRole('row')).toHaveLength(2) // header + 1 row
    // One toast remains
    expect(screen.getAllByText('entry deleted')).toHaveLength(1)
  })
})
