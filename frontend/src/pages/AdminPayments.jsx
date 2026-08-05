import { useEffect, useMemo, useState } from 'react'
import { CreditCard, Upload, CheckCircle2, AlertTriangle, FileText } from 'lucide-react'
import {
  usePotsForAdmin,
  useGameweeksForPot,
  usePaymentStatus,
  useMarkPayment,
  useBulkVerifyPayments,
} from '../hooks/useAdmin'
import { parsePaymentCsv } from '../utils/csv'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import PaymentTable from '../components/admin/PaymentTable'
import { useUiStore } from '../store/uiStore'

const CSV_EXAMPLE = `Identifier,Pot,Status,Notes
ben@example.com,Premier League Pool,Paid,Revolut
adam@example.com,Premier League Pool,Paid,Cash
0871234567,Premier League Pool,Unpaid,Chargeback`

function outcomeBadgeStatus(outcome) {
  if (outcome === 'updated') return 'won'
  if (outcome === 'skipped') return 'pending'
  return 'lost'
}

function SummaryStat({ label, value, tone = 'default' }) {
  const toneClass = {
    default: 'text-white',
    good: 'text-accent',
    warn: 'text-amber',
    bad: 'text-red-goal',
  }[tone]
  return (
    <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-white/35">{label}</div>
      <div className={`text-2xl font-semibold tabular ${toneClass}`}>{value}</div>
    </div>
  )
}

export default function AdminPayments() {
  const addToast = useUiStore((s) => s.addToast)

  const { data: pots = [], isLoading: potsLoading } = usePotsForAdmin()
  const [selectedPotId, setSelectedPotId] = useState('')
  const selectedPot = useMemo(() => pots.find((p) => p.id === selectedPotId) ?? null, [pots, selectedPotId])

  useEffect(() => {
    if (!selectedPotId && pots.length > 0) setSelectedPotId(pots[0].id)
  }, [pots, selectedPotId])

  const { data: gameweeks = [] } = useGameweeksForPot(selectedPot?.season_id, selectedPot?.league_id)
  const [selectedGameweekId, setSelectedGameweekId] = useState('')

  useEffect(() => {
    setSelectedGameweekId('')
  }, [selectedPotId])

  useEffect(() => {
    if (selectedGameweekId || gameweeks.length === 0) return
    const current = gameweeks.find((gw) => gw.is_current) || gameweeks.find((gw) => gw.status === 'upcoming') || gameweeks[0]
    if (current) setSelectedGameweekId(String(current.id))
  }, [gameweeks, selectedGameweekId])

  const gameweekIdNum = selectedGameweekId ? Number(selectedGameweekId) : null
  const { data: statusRows = [], isLoading: statusLoading } = usePaymentStatus(selectedPotId, gameweekIdNum)

  const markPayment = useMarkPayment()
  const [loadingUserId, setLoadingUserId] = useState(null)

  async function handleMark(row, isPaid) {
    if (!selectedGameweekId) return
    setLoadingUserId(row.user_id)
    try {
      await markPayment.mutateAsync({
        action: isPaid ? 'mark_paid' : 'mark_unpaid',
        potId: selectedPotId,
        userId: row.user_id,
        gameweekId: gameweekIdNum,
      })
      addToast({ type: 'success', message: `${row.display_name || row.username} marked ${isPaid ? 'paid' : 'unpaid'}` })
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setLoadingUserId(null)
    }
  }

  // --- CSV bulk import ---
  const [csvText, setCsvText] = useState('')
  const [csvFileName, setCsvFileName] = useState('')
  const [preview, setPreview] = useState(null) // { rows, results, summary }
  const [applyResult, setApplyResult] = useState(null)
  const bulkVerify = useBulkVerifyPayments()

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setCsvText(text)
    setCsvFileName(file.name)
    setPreview(null)
    setApplyResult(null)
  }

  async function handlePreview() {
    if (!selectedGameweekId) {
      addToast({ type: 'error', message: 'Select a gameweek first — every row in this import applies to it' })
      return
    }
    const parsedRows = parsePaymentCsv(csvText)
    if (parsedRows.length === 0) {
      addToast({ type: 'error', message: 'No rows found in this CSV' })
      return
    }
    setApplyResult(null)
    try {
      const result = await bulkVerify.mutateAsync({
        potId: selectedPotId,
        gameweekId: gameweekIdNum,
        rows: parsedRows,
        dryRun: true,
      })
      setPreview({ rows: parsedRows, results: result.results, summary: result.summary })
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    }
  }

  async function handleConfirmImport() {
    if (!preview) return
    try {
      const result = await bulkVerify.mutateAsync({
        potId: selectedPotId,
        gameweekId: gameweekIdNum,
        rows: preview.rows,
        dryRun: false,
      })
      setApplyResult(result)
      addToast({
        type: 'success',
        message: `Import complete — ${result.summary.updated} updated, ${result.summary.skipped} skipped, ${result.summary.failed} failed`,
      })
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    }
  }

  const paymentTableRows = statusRows.map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name || r.username || 'User',
    username: r.username || 'unknown',
    is_paid: r.is_paid,
  }))

  const activeSummary = applyResult?.summary ?? preview?.summary ?? null
  const activeResults = applyResult?.results ?? preview?.results ?? null

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Payment verification</h1>
            <p className="mt-1 text-sm text-white/40">
              The app never processes payments — it only records whether an admin has verified one, off-platform.
            </p>
          </div>
          <Badge status="admin">Admin</Badge>
        </div>
      </Card>

      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm text-white/70">Pot</label>
            {potsLoading ? (
              <div className="flex items-center gap-2 text-sm text-white/40">
                <Spinner size="sm" /> Loading pots...
              </div>
            ) : pots.length === 0 ? (
              <p className="text-sm text-white/40">You are not an admin of any pot.</p>
            ) : (
              <select
                value={selectedPotId}
                onChange={(e) => setSelectedPotId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
              >
                {pots.map((pot) => (
                  <option key={pot.id} value={pot.id}>{pot.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-white/70">Gameweek</label>
            <select
              value={selectedGameweekId}
              onChange={(e) => { setSelectedGameweekId(e.target.value); setPreview(null); setApplyResult(null) }}
              disabled={!selectedPotId || gameweeks.length === 0}
              className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50 disabled:opacity-50"
            >
              <option value="">Select a gameweek</option>
              {gameweeks.map((gw) => (
                <option key={gw.id} value={gw.id}>
                  GW{gw.number} — {gw.name}{gw.is_current ? ' — Current' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {!selectedGameweekId ? (
        <EmptyState
          icon={CreditCard}
          title="Select a pot and gameweek"
          description="Payment verification is scoped to one gameweek at a time."
        />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">Entries awaiting verification</h2>
            {statusLoading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : paymentTableRows.length === 0 ? (
              <EmptyState icon={CreditCard} title="No members" description="This pot has no members yet." />
            ) : (
              <PaymentTable
                rows={paymentTableRows}
                loadingUserId={loadingUserId}
                onMarkPaid={(row) => handleMark(row, true)}
                onMarkUnpaid={(row) => handleMark(row, false)}
              />
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Bulk CSV import</h2>
            <Card className="p-5 space-y-4">
              <p className="text-sm text-white/45">
                Format: <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs">Identifier,Pot,Status,Notes</code> — Identifier
                is an email or phone number, Status is exactly <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs">Paid</code> or{' '}
                <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs">Unpaid</code>, Notes is optional. Every row in this
                import applies to the gameweek selected above.
              </p>

              <details className="rounded-xl border border-white/8 bg-black/10 p-3 text-xs text-white/40">
                <summary className="cursor-pointer select-none text-white/60">Example CSV</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre">{CSV_EXAMPLE}</pre>
              </details>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-surface-2 px-4 py-2.5 text-sm text-white transition hover:border-accent/40">
                  <Upload size={16} />
                  Choose CSV file
                  <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
                </label>
                {csvFileName && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-white/60">
                    <FileText size={14} /> {csvFileName}
                  </span>
                )}
                <Button
                  variant="secondary"
                  disabled={!csvText}
                  loading={bulkVerify.isPending && !applyResult}
                  onClick={handlePreview}
                >
                  Validate &amp; preview
                </Button>
              </div>
            </Card>

            {activeSummary && (
              <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-white">
                    {applyResult ? 'Import summary' : 'Preview — nothing has been written yet'}
                  </h3>
                  {!applyResult && (
                    <Button onClick={handleConfirmImport} loading={bulkVerify.isPending}>
                      <CheckCircle2 size={16} />
                      Confirm import
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <SummaryStat label="Processed" value={activeSummary.processed} />
                  <SummaryStat label="Updated" value={activeSummary.updated} tone="good" />
                  <SummaryStat label="Skipped" value={activeSummary.skipped} tone="warn" />
                  <SummaryStat label="Failed" value={activeSummary.failed} tone="bad" />
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/8">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/8 text-xs uppercase tracking-wide text-white/35">
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Identifier</th>
                        <th className="px-3 py-2">Pot</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Outcome</th>
                        <th className="px-3 py-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/6">
                      {activeResults.map((r) => (
                        <tr key={r.row}>
                          <td className="px-3 py-2 text-white/50 tabular">{r.row}</td>
                          <td className="px-3 py-2 text-white">{r.identifier}</td>
                          <td className="px-3 py-2 text-white/70">{r.pot}</td>
                          <td className="px-3 py-2 text-white/70">{r.status}</td>
                          <td className="px-3 py-2">
                            <Badge status={outcomeBadgeStatus(r.outcome)}>{r.outcome}</Badge>
                          </td>
                          <td className="px-3 py-2 text-white/45">{r.reason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!applyResult && activeSummary.failed > 0 && (
                  <p className="flex items-center gap-2 text-xs text-amber">
                    <AlertTriangle size={14} />
                    {activeSummary.failed} row(s) will be skipped on import — fix and re-upload if they should be included.
                  </p>
                )}
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  )
}
