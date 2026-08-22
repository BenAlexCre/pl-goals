import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'

// Remediation (F1, red-team audit) — regression test for the Dashboard
// mobile horizontal-overflow bug. Root cause: the pot grid had no explicit
// `grid-cols-N` utility below the `md` breakpoint, so the browser fell back
// to an unbounded single implicit column sized to the widest card's
// max-content width (driven by a `truncate` heading's `white-space: nowrap`)
// instead of the container width. jsdom has no real layout engine, so this
// cannot re-measure scrollWidth/clientWidth the way the live-browser
// verification did (360/375/390/430px + 1440px, all `scrollWidth ===
// clientWidth`, done separately against real production data) — this test
// instead pins the two className changes that constitute the actual fix, so
// a future edit that drops `grid-cols-1` or a pot Link's `min-w-0` fails
// immediately instead of silently reopening the overflow.
vi.mock('../hooks/usePots', () => ({
  usePots: () => ({ data: mockPots, isLoading: false }),
  useDashboardPotStatus: () => ({ data: new Map() }),
}))
vi.mock('../hooks/useGameweek', () => ({
  useCurrentGameweek: () => ({ data: null, isLoading: false }),
  useNextGameweek: () => ({ data: null, isLoading: false }),
  useGameweek: () => ({ data: null, isLoading: false }),
  useAllGameweeks: () => ({ data: [] }),
}))
vi.mock('../hooks/useLiveScores', () => ({ useLiveScores: () => ({}) }))
vi.mock('../hooks/useLeaderboard', () => ({ useLeaderboard: () => ({ data: [], isLoading: false }) }))
vi.mock('../hooks/useAdmin', () => ({
  useOwnsAnyPot: () => ({ data: false }),
  useIsSuperAdmin: () => false,
}))
vi.mock('../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'u1' }, profile: { display_name: 'Test User' } }),
}))

const mockPots = [
  { id: 'pot-1', name: 'Pot One', game_type: 'pick5', leagues: { name: 'Premier League' }, seasons: { name: '2026/27', year_start: 2026 }, pot_members: [{ role: 'member' }] },
  { id: 'pot-2', name: 'Pot Two', game_type: 'score_predictor', leagues: { name: 'Premier League' }, seasons: { name: '2026/27', year_start: 2026 }, pot_members: [{ role: 'admin' }] },
]

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  )
}

describe('Dashboard pot grid (F1 overflow fix)', () => {
  it('renders the pot grid with an explicit single column below md, bound with minmax(0,1fr)', () => {
    renderDashboard()
    const heading = screen.getByRole('heading', { level: 3, name: 'Pot One' })
    const grid = heading.closest('.grid')
    expect(grid).not.toBeNull()
    expect(grid.className).toMatch(/\bgrid-cols-1\b/)
    expect(grid.className).toMatch(/\bmd:grid-cols-2\b/)
  })

  it('wraps each pot card link in min-w-0 so it can shrink below its content width', () => {
    renderDashboard()
    const heading = screen.getByRole('heading', { level: 3, name: 'Pot One' })
    const link = heading.closest('a')
    expect(link.className).toMatch(/\bmin-w-0\b/)
  })
})
