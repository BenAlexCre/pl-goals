import { Users, ShieldCheck, ShieldOff, Crown, Trophy, Sparkles } from 'lucide-react'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import { useOverviewStats } from '../../hooks/useSuperAdmin'

const STAT_CARDS = [
  { key: 'total_users', label: 'Total users', icon: Users },
  { key: 'active_users', label: 'Active users', icon: ShieldCheck },
  { key: 'banned_users', label: 'Banned / suspended', icon: ShieldOff },
  { key: 'app_admins', label: 'App admins', icon: Crown },
  { key: 'active_pots', label: 'Active pots', icon: Trophy },
]

export default function Overview() {
  const { data, isLoading, error } = useOverviewStats()

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-red-goal">{error.message}</p>
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {STAT_CARDS.map(({ key, label, icon: Icon }) => (
        <Card key={key} className="p-4">
          <div className="flex items-center gap-2 text-white/40">
            <Icon size={15} />
            <span className="text-xs">{label}</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{data?.[key] ?? 0}</div>
        </Card>
      ))}

      <Card className="p-4">
        <div className="flex items-center gap-2 text-white/40">
          <Sparkles size={15} />
          <span className="text-xs">Demo Centre</span>
        </div>
        <div className="mt-2 text-2xl font-bold text-white capitalize">{data?.demo_status ?? 'none'}</div>
      </Card>
    </div>
  )
}
