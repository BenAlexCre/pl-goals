import Reveal from './Reveal'
import {
  AdminPaymentsMock,
  BrowserFrame,
  FixtureListMock,
  LeaderboardMock,
  NotificationMock,
  PredictionCardMock,
} from './ProductMockups'

const ROWS = [
  {
    eyebrow: 'Live fixtures',
    title: 'Every goal, live',
    text: 'Real Premier League fixtures and live scores, matched straight to your picks — no refreshing, no waiting for full time.',
    mock: <FixtureListMock />,
    label: 'Gameweek 12 · Live',
  },
  {
    eyebrow: 'Predictions',
    title: 'A prediction screen for every format',
    text: 'Whichever format your pot plays, submitting a prediction takes seconds — and locks itself automatically at kickoff.',
    mock: <PredictionCardMock />,
    label: 'Score Predictor',
  },
  {
    eyebrow: 'Standings',
    title: 'Standings that update themselves',
    text: 'Ranked, tie-broken, and refreshed automatically the moment scores change — nobody needs to calculate anything by hand.',
    mock: <LeaderboardMock />,
    label: 'Friday Night Pool',
  },
  {
    eyebrow: 'Notifications',
    title: "Know the moment you've won",
    text: 'A prize payout, a new gameweek, a reinstated entry — every real event in your pot reaches you the moment it happens.',
    mock: <div className="space-y-3 p-4"><NotificationMock /></div>,
    label: 'Notifications',
  },
  {
    eyebrow: 'Organiser tools',
    title: 'Payment tracking, built in',
    text: 'Record who has paid, mark entries unpaid, and reinstate a late payer — all from one screen, for weekly or season pots.',
    mock: <AdminPaymentsMock />,
    label: 'Payment verification',
  },
]

export default function ProductShowcase() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 md:py-32">
      <Reveal className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">Inside the product</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Built for people who actually run competitions
        </h2>
      </Reveal>

      <div className="mt-16 space-y-20 md:space-y-28">
        {ROWS.map((row, i) => (
          <Reveal key={row.title}>
            <div className={`grid items-center gap-10 md:grid-cols-2 md:gap-16 ${i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''}`}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">{row.eyebrow}</p>
                <h3 className="mt-3 text-2xl font-bold text-white">{row.title}</h3>
                <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/50">{row.text}</p>
              </div>

              <BrowserFrame>
                <div className="border-b border-white/6 px-4 py-3">
                  <p className="text-xs font-medium text-white/35">{row.label}</p>
                </div>
                {row.mock}
              </BrowserFrame>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
