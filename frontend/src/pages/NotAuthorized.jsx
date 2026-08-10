import { Link } from 'react-router-dom'
import EmptyState from '../components/ui/EmptyState'
import Button from '../components/ui/Button'
import { ShieldAlert } from 'lucide-react'

export default function NotAuthorized() {
  return (
    <div className="min-h-screen bg-pitch-950 flex items-center justify-center px-4">
      <EmptyState
        icon={ShieldAlert}
        title="Not authorised"
        description="You don't have admin access to this page. If you think this is a mistake, ask a pot organiser to add you as an admin."
        action={<Link to="/dashboard"><Button>Go to dashboard</Button></Link>}
      />
    </div>
  )
}
