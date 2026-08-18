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
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>
      <BottomNav />
      <Drawer />
    </div>
  )
}