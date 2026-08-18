import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import { useInspectUser } from '../../hooks/useSuperAdmin'

export default function UserDetail() {
  const { userId } = useParams()
  const { data, isLoading, error } = useInspectUser(userId)

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  }
  if (error) {
    return <p className="text-sm text-red-goal">{error.message}</p>
  }
  if (!data) return null

  return (
    <div className="space-y-4">
      <Link to="/super-admin/users" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
        <ArrowLeft size={14} />
        Back to Users
      </Link>

      <Card className="p-5">
        <h1 className="text-xl font-bold text-white">{data.profile?.display_name || data.profile?.username || 'User'}</h1>
        <p className="text-sm text-white/40">{data.email}</p>

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-white/40">Username</dt>
            <dd className="text-white">{data.profile?.username ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-white/40">Role</dt>
            <dd className="capitalize text-white">{data.role}</dd>
          </div>
          <div>
            <dt className="text-white/40">Verified</dt>
            <dd className="text-white">{data.email_verified ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-white/40">Status</dt>
            <dd className={data.banned ? 'text-red-goal' : 'text-white'}>{data.banned ? 'Banned' : 'Active'}</dd>
          </div>
          <div>
            <dt className="text-white/40">Demo account</dt>
            <dd className="text-white">{data.profile?.is_demo ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-white/40">Joined</dt>
            <dd className="text-white">{data.created_at ? new Date(data.created_at).toLocaleDateString() : '—'}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">Pots ({data.pots?.length ?? 0})</h2>
        {!data.pots?.length ? (
          <p className="text-sm text-white/40">Not a member of any pot.</p>
        ) : (
          <ul className="space-y-2">
            {data.pots.map((m, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl border border-white/8 px-4 py-3 text-sm">
                <span className="text-white">{m.pots?.name}</span>
                <span className="text-white/40 capitalize">{m.role} · {m.pots?.game_type?.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
