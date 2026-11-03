import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LivePickCard from './LivePickCard'
import { summariseEntry } from '../../utils/scoring'

// Owner decision 2026-11-03: a pick whose match is postponed has its own status.
describe('Postponed pick status', () => {
  it('LivePickCard shows a "Postponed" badge, not Pending or Lost', () => {
    render(<LivePickCard pick={{ player_name: 'A Player', result: 'postponed', goals_scored: 0, goal_threshold: 1 }} />)
    expect(screen.getByText('Postponed')).toBeInTheDocument()
    expect(screen.queryByText(/Lost/)).not.toBeInTheDocument()
  })

  it('summariseEntry counts postponed separately — not won, lost or pending', () => {
    const s = summariseEntry([
      { result: 'won' }, { result: 'lost' }, { result: 'pending' }, { result: 'postponed' }, { result: 'postponed' },
    ])
    expect(s).toEqual({ won: 1, lost: 1, pending: 1, voided: 0, postponed: 2, total: 5 })
  })
})
