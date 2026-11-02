import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from './BottomNav'

// Mobile audit (2026-11-02) — regression test: the phone-only bottom bar had
// no route to /pots (TopNav's links are hidden below md), so the pot list,
// create-pot and join flows were unreachable from navigation on a phone.
let ownsAnyPot = false
let isSuperAdmin = false
vi.mock('../../hooks/useAdmin', () => ({
  useOwnsAnyPot: () => ({ data: ownsAnyPot }),
  useIsSuperAdmin: () => isSuperAdmin,
}))

function renderNav() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <BottomNav />
    </MemoryRouter>
  )
}

describe('BottomNav', () => {
  beforeEach(() => {
    ownsAnyPot = false
    isSuperAdmin = false
  })

  it('always offers Home, Pots and Profile to a regular player', () => {
    renderNav()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: 'Pots' })).toHaveAttribute('href', '/pots')
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('fits all five destinations for a pot-owning super admin, keeping a full accessible name', () => {
    ownsAnyPot = true
    isSuperAdmin = true
    renderNav()
    expect(screen.getAllByRole('link')).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'Super Admin' })).toHaveAttribute('href', '/super-admin')
    // Five columns must be a literal class Tailwind can see.
    expect(screen.getByRole('navigation').firstChild).toHaveClass('grid-cols-5')
  })
})
