import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Button from '../components/ui/Button'
import LandingNav from '../components/landing/LandingNav'
import Hero from '../components/landing/Hero'
import HowItWorks from '../components/landing/HowItWorks'
import GameModes from '../components/landing/GameModes'
import WhyUseIt from '../components/landing/WhyUseIt'
import ProductShowcase from '../components/landing/ProductShowcase'
import TrustSection from '../components/landing/TrustSection'
import FAQSection from '../components/landing/FAQSection'
import LandingFooter from '../components/landing/LandingFooter'
import Reveal from '../components/landing/Reveal'

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-pitch-950">
      <LandingNav />
      <main>
        <Hero />
        <HowItWorks />
        <GameModes />
        <WhyUseIt />
        <ProductShowcase />
        <TrustSection />
        <FAQSection />

        <section className="mx-auto max-w-4xl px-5 py-24 text-center md:py-32">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Ready to run your first competition?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] text-white/50">
              Free to play, free to organise. Create a private pot in under a minute.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
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
          </Reveal>
        </section>
      </main>
      <LandingFooter />
    </div>
  )
}
