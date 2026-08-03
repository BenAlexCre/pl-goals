import { Outlet } from 'react-router-dom'
import TopNav from './TopNav'
import BottomNav from './BottomNav'
import Drawer from '../ui/Drawer'

export default function AppShell() {
  return (
    <div className="min-h-dvh bg-pitch-950 flex flex-col">
      <TopNav />
      <main className="flex-1 pb-24 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>
      <BottomNav />
      <Drawer />
    </div>
  )
}