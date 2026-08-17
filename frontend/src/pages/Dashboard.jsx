import { Link } from 'react-router-dom'
import { usePots } from '../hooks/usePots'
import { useCurrentGameweek } from '../hooks/useGameweek'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import CountdownTimer from '../components/ui/CountdownTimer'
import { SkeletonCard } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import { Trophy, Users } from 'lucide-react'

const GAME_TYPE_LABELS = {
  pick5: 'Pick 5',
  last_man_standing: 'Last Man Standing',
  score_predictor: 'Score Predictor',
}

export default function Dashboard() {
  const { data: pots = [], isLoading } = usePots()
  const { data: currentGw } = useCurrentGameweek()

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-br from-surface-1 to-surface-3 border border-white/6 p-6">
        <Badge status={currentGw?.status || 'upcoming'}>
          {currentGw?.name || 'No current gameweek'}
        </Badge>
        <h1 className="mt-3 text-3xl font-bold text-white">Your pots</h1>
        <p className="mt-2 text-white/45 max-w-2xl">
          Track deadlines, submit picks, and follow live scoring in your private groups.
        </p>
        {currentGw?.deadline_utc && (
          <div className="mt-4">
            <CountdownTimer deadlineUtc={currentGw.deadline_utc} />
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Active pots</h2>
          <Badge status="member">{pots.length} pots</Badge>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 gap-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : pots.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No pots yet"
            description="You haven’t joined any private pots yet."
          />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {pots.map((pot) => (
              <Link key={pot.id} to={`/pot/${pot.id}`}>
                <Card hover className="p-5 h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-white font-semibold">{pot.name}</h3>
                      <p className="text-sm text-white/35 mt-1">
                        {pot.description || 'No description yet'}
                      </p>
                    </div>
                    <Badge status={pot.pot_members?.[0]?.role || 'member'}>
                      {pot.pot_members?.[0]?.role || 'member'}
                    </Badge>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-white/45">
                      <Trophy size={15} />
                      <span>{pot.leagues?.name}</span>
                    </div>
                    <span className="text-white/30">{pot.seasons?.name}</span>
                  </div>

                  <div className="mt-2 text-xs text-white/35">
                    {GAME_TYPE_LABELS[pot.game_type] || pot.game_type || 'Pick 5'}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}