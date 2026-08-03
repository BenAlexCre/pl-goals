import { Link } from 'react-router-dom'
import EmptyState from '../components/ui/EmptyState'
import Button from '../components/ui/Button'
import { SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-pitch-950 flex items-center justify-center px-4">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="The page you tried to open doesn’t exist."
        action={<Link to="/dashboard"><Button>Go to dashboard</Button></Link>}
      />
    </div>
  )
}