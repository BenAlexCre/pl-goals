import { Outlet } from 'react-router-dom'
import TopNav from './TopNav'
import BottomNav from './BottomNav'
import Drawer from '../ui/Drawer'
import UnverifiedBanner from './UnverifiedBanner'

export default function AppShell() {
  return (
    <div className="min-h-dvh bg-pitch-950 flex flex-col">
      <TopNav />
      <UnverifiedBanner />
      {/* Phase 8D, Part 16 — min-w-0 fixes a classic flexbox overflow bug:
          a flex item's default min-width is `auto`, not 0, so wide content
          (the Super Admin Users table, min-w-[820px]) forced this whole
          <main> wider than the viewport instead of scrolling inside its own
          overflow-x-auto wrapper — confirmed live (bodyScrollWidth >
          clientWidth) before this fix, not assumed. Pre-existing structural
          gap in AppShell, not specific to the new page; fixing it here
          benefits every wide-table page under this shell. */}
      {/* Phase 14, Part 12 — this is the one shared content container
          every authenticated page renders inside. It was `max-w-6xl`
          (1152px) while TopNav's own inner container (just above, in the
          same visual column) has always been `max-w-7xl` (1280px) —
          confirmed live as the actual cause of the reported "Dashboard
          looks misaligned": at any viewport wider than 1152px, the nav
          bar's logo/links sit 64px further left/right than the page
          content below them. Matched to TopNav's existing width rather
          than inventing a third number — one shared boundary, not a
          second competing container system. UnverifiedBanner.jsx
          (renders in this same column, just above <main>) is updated to
          match in the same change. Padding stays a flat `px-4`, exactly
          matching TopNav's own — a responsive px-6/px-8 step here alone
          would just trade one mismatch for another at those breakpoints. */}
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>
      <BottomNav />
      <Drawer />
    </div>
  )
}