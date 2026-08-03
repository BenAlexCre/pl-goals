import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Avatar from '../ui/Avatar'

export default function MemberTable({ members = [], onRemove }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-white/8">
        <h3 className="text-sm font-semibold text-white">Members</h3>
      </div>

      <div className="divide-y divide-white/6">
        {members.map((member) => (
          <div key={member.user_id} className="px-4 py-3 flex items-center gap-3">
            <Avatar user={member.profiles} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{member.profiles?.display_name}</p>
              <p className="text-xs text-white/35 truncate">@{member.profiles?.username}</p>
            </div>
            <Badge status={member.role}>{member.role}</Badge>
            {onRemove && (
              <Button size="sm" variant="danger" onClick={() => onRemove(member)}>
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}