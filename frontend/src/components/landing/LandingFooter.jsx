import { Link } from 'react-router-dom'
import { Github } from 'lucide-react'
import { Logo } from './LandingNav'

// Privacy/Terms/Support have no real page to link to yet — rendered as
// plain labels, not dead links, until those pages actually exist. A link
// that goes nowhere is worse for accessibility than an honest static label.
const LEGAL_PLACEHOLDERS = ['Privacy', 'Terms', 'Support']

export default function LandingFooter() {
  return (
    <footer className="border-t border-white/6 px-5 py-14">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <Link to="/" className="flex items-center gap-2.5">
              <Logo size={24} />
              <span className="text-sm font-bold text-white">PL Predictor</span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-white/40">
              Private Premier League prediction competitions for friends, family and colleagues.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/30">Competition Formats</p>
              <ul className="mt-4 space-y-2.5 text-sm text-white/50">
                <li><a href="#game-modes" className="transition-colors hover:text-white">Pick 5</a></li>
                <li><a href="#game-modes" className="transition-colors hover:text-white">Last Man Standing</a></li>
                <li><a href="#game-modes" className="transition-colors hover:text-white">Score Predictor</a></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/30">Product</p>
              <ul className="mt-4 space-y-2.5 text-sm text-white/50">
                <li><a href="#how-it-works" className="transition-colors hover:text-white">How it works</a></li>
                <li><a href="#features" className="transition-colors hover:text-white">Features</a></li>
                <li><a href="#faq" className="transition-colors hover:text-white">FAQ</a></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/30">Legal</p>
              <ul className="mt-4 space-y-2.5 text-sm text-white/30">
                {LEGAL_PLACEHOLDERS.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-col-reverse items-center justify-between gap-4 border-t border-white/6 pt-8 sm:flex-row">
          <p className="text-xs text-white/30">
            © {new Date().getFullYear()} PL Predictor. All rights reserved.
          </p>
          <a
            href="https://github.com/BenAlexCre/pl-goals"
            target="_blank"
            rel="noreferrer"
            aria-label="PL Predictor on GitHub"
            className="rounded-lg p-1.5 text-white/35 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Github size={18} />
          </a>
        </div>
      </div>
    </footer>
  )
}
