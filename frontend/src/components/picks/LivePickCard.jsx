import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Avatar from '../ui/Avatar'
import { Trophy, AlertTriangle, Minus, ArrowRightLeft, Armchair, Play } from 'lucide-react'

const resultIcons = {
  won: Trophy,
  winning: Trophy,
  lost: AlertTriangle,
  losing: AlertTriangle,
  pending: Minus,
  void: Minus,
}

const appearanceConfig = {
  starting: {
    label: 'Starting',
    icon: Play,
    className: 'text-green-400 bg-green-400/10 border border-green-400/20',
  },
  bench: {
    label: 'Bench',
    icon: Armchair,
    className: 'text-white/50 bg-white/5 border border-white/10',
  },
  sub_on: {
    label: 'Sub on',
    icon: ArrowRightLeft,
    className: 'text-blue-400 bg-blue-400/10 border border-blue-400/20',
  },
  sub_off: {
    label: 'Sub off',
    icon: ArrowRightLeft,
    className: 'text-white/35 bg-white/5 border border-white/10',
  },
  not_in_squad: {
    label: 'Not in squad',
    icon: Minus,
    className: 'text-white/25 bg-white/5 border border-white/10',
  },
}

function renderAppearanceLabel(appearance) {
  if (!appearance?.status) return null

  if (appearance.status === 'sub_on' && appearance.came_on_minute) {
    return `Sub on ${appearance.came_on_minute}'`
  }

  if (appearance.status === 'sub_off' && appearance.went_off_minute) {
    return `Off ${appearance.went_off_minute}'`
  }

  return appearanceConfig[appearance.status]?.label ?? null
}

export default function LivePickCard({ pick, className = '' }) {
  const status = pick.result || 'pending'
  const ResultIcon = resultIcons[status] ?? Minus

  const appearance = pick.appearance ?? null
  const appearanceMeta = appearance?.status ? appearanceConfig[appearance.status] : null
  const AppearanceIcon = appearanceMeta?.icon

  const resultIconClass =
    status === 'won' || status === 'winning'
      ? 'text-accent'
      : status === 'lost' || status === 'losing'
      ? 'text-red-goal'
      : 'text-white/35'

  return (
    <Card className={`p-3 ${className}`}>
      <div className="flex items-start gap-3">
        <Avatar
          user={{
            display_name: pick.player_name,
            avatar_url: pick.player_photo ?? pick.photo_url ?? null,
          }}
          size="sm"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-white truncate">
              {pick.player_name}
            </p>
            <Badge status={status}>{status}</Badge>
          </div>

          <p className="text-xs text-white/35 mt-1">
            Goals: {pick.goals_scored ?? 0} / Threshold: {pick.goal_threshold ?? 1}
          </p>

          {appearanceMeta ? (
            <div className="mt-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ${appearanceMeta.className}`}
              >
                {AppearanceIcon ? <AppearanceIcon size={12} /> : null}
                {renderAppearanceLabel(appearance)}
              </span>
            </div>
          ) : null}
        </div>

        <div className={`flex-shrink-0 mt-1 ${resultIconClass}`}>
          <ResultIcon size={18} />
        </div>
      </div>
    </Card>
  )
}