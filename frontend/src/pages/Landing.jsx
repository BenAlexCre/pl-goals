import { Link } from 'react-router-dom'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { Shield, Timer, Trophy, Users } from 'lucide-react'

export default function Landing() {
  return (
    <div className="min-h-screen bg-pitch-950">
      <header className="border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="30" height="30" viewBox="0 0 28 28" fill="none" aria-label="PL Goals">
              <circle cx="14" cy="14" r="13" stroke="#00e676" strokeWidth="1.5" />
              <path d="M7 14C7 10 10 7 14 7C18 7 21 10 21 14" stroke="#00e676" strokeWidth="1.5" />
              <circle cx="14" cy="14" r="3" fill="#00e676" />
              <path d="M14 17L14 21" stroke="#00e676" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>
              <p className="text-white font-bold">PL Goals</p>
              <p className="text-[11px] text-white/35">Premier League pick game</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/sign-in"><Button variant="ghost">Sign in</Button></Link>
            <Link to="/sign-up"><Button>Get started</Button></Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 py-16 md:py-24">
        <div className="max-w-3xl">
          <Badge status="live" className="mb-4">Live scoring</Badge>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight text-white">
            Private Premier League goals pots with a premium live pick experience
          </h1>
          <p className="mt-5 text-base md:text-lg text-white/55 max-w-2xl">
            Join private pots, lock in 5 player picks each gameweek, track live goal events,
            and climb your group leaderboard as matches unfold.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link to="/sign-up"><Button size="lg">Create account</Button></Link>
            <Link to="/sign-in"><Button size="lg" variant="secondary">Already have an account</Button></Link>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4 mt-12">
          {[
            { icon: Users, title: 'Private pots', text: 'Only members can see each pot and its entries.' },
            { icon: Timer, title: 'Deadline lock', text: 'Picks close 30 minutes before first kickoff.' },
            { icon: Trophy, title: 'Duplicate thresholds', text: 'Pick the same scorer twice and they need 2 goals.' },
            { icon: Shield, title: 'Paid entry rules', text: 'Unpaid entries are stored but excluded from scoring.' },
          ].map(({ icon: Icon, title, text }) => (
            <Card key={title} className="p-5">
              <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center text-accent mb-4">
                <Icon size={18} />
              </div>
              <h2 className="text-white font-semibold">{title}</h2>
              <p className="text-sm text-white/40 mt-2">{text}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}