import { Component } from 'react'
import EmptyState from './ui/EmptyState'
import Button from './ui/Button'
import { AlertTriangle } from 'lucide-react'

// Phase 20 — beta-readiness gap found live: this app had no error
// boundary anywhere. Without one, an uncaught render-time error in any
// component unmounts the entire React tree to a blank white page —
// exactly the "blank screen"/"silent failure" this phase's audit was
// asked to look for. Every other unhappy-path in this app (403, 404,
// empty states) already has a real, styled fallback (NotAuthorized.jsx,
// NotFound.jsx, EmptyState) — this is the one missing catch-all above
// all of them. Deliberately minimal: catch, log to console for local
// debugging, show a real recovery action (reload). Not a monitoring
// platform — matches this phase's own "do not build a large monitoring
// platform" instruction.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error caught by ErrorBoundary:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-pitch-950 flex items-center justify-center px-4">
          <EmptyState
            icon={AlertTriangle}
            title="Something went wrong"
            description="An unexpected error occurred. Reloading the page usually fixes this."
            action={<Button onClick={() => window.location.reload()}>Reload page</Button>}
          />
        </div>
      )
    }
    return this.props.children
  }
}
