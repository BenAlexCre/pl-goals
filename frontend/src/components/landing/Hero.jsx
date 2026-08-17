import { Link } from 'react-router-dom'
import { ArrowRight, Sparkles } from 'lucide-react'
import Button from '../ui/Button'
import Reveal from './Reveal'
import { BrowserFrame, LeaderboardMock, NotificationMock, PhoneFrame, PredictionCardMock } from './ProductMockups'

export default function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-14 md:pb-28 md:pt-20">
      {/* Ambient glow — the "stadium light" the brief asks for, without a stock photo */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-32 top-40 h-[360px] w-[360px] rounded-full bg-accent/5 blur-[100px]" aria-hidden="true" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
        {/* Left */}
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3.5 py-1.5 text-xs font-medium text-accent">
            <Sparkles size={13} /> Now in beta — free to play
          </div>

          <h1 className="mt-6 text-[2.75rem] font-bold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-[3.5rem]">
            Predict.<br />Compete.<br /> <span className="text-accent">Win.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/55">
            PL Predictor is the best way to run private Premier League prediction
            competitions with friends, family, or colleagues — three ways to
            play, live scoring every gameweek, and standings that update
            themselves.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to="/sign-up">
              <Button size="lg" fullWidth className="sm:w-auto">
                Create account <ArrowRight size={17} />
              </Button>
            </Link>
            <Link to="/sign-in">
              <Button size="lg" variant="secondary" fullWidth className="sm:w-auto">
                Sign in
              </Button>
            </Link>
          </div>

          <div className="mt-10 flex items-center gap-4">
            <div className="flex -space-x-2.5" aria-hidden="true">
              {['#00e676', '#ffab00', '#ff5252', '#00c853'].map((color) => (
                <span
                  key={color}
                  className="h-8 w-8 rounded-full border-2 border-pitch-950"
                  style={{ backgroundColor: color, opacity: 0.35 }}
                />
              ))}
            </div>
            <p className="text-sm text-white/40">
              Built for private groups — invite-only, no public leagues.
            </p>
          </div>
        </Reveal>

        {/* Right — layered product showcase */}
        <Reveal delay={150} className="relative">
          <div className="relative mx-auto max-w-md lg:max-w-none">
            <BrowserFrame className="animate-fade-in">
              <div className="border-b border-white/6 px-4 py-3">
                <p className="text-xs font-medium text-white/35">Friday Night Pool · Standings</p>
              </div>
              <LeaderboardMock />
            </BrowserFrame>

            <div className="absolute -bottom-10 -left-6 hidden sm:block lg:-left-14">
              <PhoneFrame className="shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
                <PredictionCardMock />
              </PhoneFrame>
            </div>

            <div className="absolute -top-8 -right-3 w-64 sm:-right-8">
              <NotificationMock />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
