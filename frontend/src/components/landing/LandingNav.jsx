import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Button from '../ui/Button'

const LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#game-modes', label: 'Competition Formats' },
  { href: '#features', label: 'Features' },
  { href: '#faq', label: 'FAQ' },
]

export function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="13" stroke="#00e676" strokeWidth="1.5" />
      <path d="M7 14C7 10 10 7 14 7C18 7 21 10 21 14" stroke="#00e676" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="3" fill="#00e676" />
      <path d="M14 17L14 21" stroke="#00e676" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export default function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled ? 'border-b border-white/8 bg-pitch-950/75 backdrop-blur-xl' : 'border-b border-transparent bg-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4" aria-label="Primary">
        <Link to="/" className="flex items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg" aria-label="PL Predictor home">
          <Logo />
          <span className="text-[15px] font-bold tracking-tight text-white">PL Predictor</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3.5 py-2 text-sm text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Link to="/sign-in"><Button variant="ghost">Sign in</Button></Link>
          <Link to="/sign-up"><Button>Create free account</Button></Link>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="rounded-lg p-2 text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {menuOpen && (
        <div className="border-t border-white/8 bg-pitch-950/97 px-5 pb-6 pt-2 backdrop-blur-xl md:hidden animate-slide-down">
          <div className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-3 text-sm text-white/70 hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 border-t border-white/8 pt-4">
            <Link to="/sign-in" onClick={() => setMenuOpen(false)}>
              <Button variant="secondary" fullWidth>Sign in</Button>
            </Link>
            <Link to="/sign-up" onClick={() => setMenuOpen(false)}>
              <Button fullWidth>Create free account</Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
