import { useEffect, useMemo, useRef, useState } from 'react'
import { CreditCard, Upload, CheckCircle2, AlertTriangle, FileText, Wallet } from 'lucide-react'
import {
  usePotsForAdmin,
  useGameweeksForPot,
  usePotMembers,
  usePaymentStatus,
  useMarkPayment,
  useBulkVerifyPayments,
  useRecordPayment,
  useReinstateEntry,
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

function GameweekChip({ gw, tone = 'allocate' }) {
  return (
    <span
      className={
        tone === 'allocate'
          ? 'inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent'
          : 'inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/45'
      }
    >
      {tone === 'allocate' ? '✓' : '·'} GW{gw.number}
    </span>
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
  const { data: statusRows = [], isLoading: statusLoading } = usePaymentStatus(selectedPotId, gameweekIdNum, selectedPot?.game_type)

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
      addToast({ type: 'success', message: `${row.display_name || row.username} marked ${isPaid ? 'paid' : 'unpaid'} for this week` })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to update payment status' })
    } finally {
      setLoadingUserId(null)
    }
  }

  // ISSUE-36 — Late Payment Override has always had a working backend
  // action, reinstate_entry, with no UI trigger anywhere. Offered only
  // where it's actually decidable: an entry voided for non-payment whose
  // payment is now marked paid.
  const reinstateEntry = useReinstateEntry()
  const [reinstatingUserId, setReinstatingUserId] = useState(null)

  async function handleReinstate(row) {
    if (!selectedGameweekId) return
    setReinstatingUserId(row.user_id)
    try {
      const result = await reinstateEntry.mutateAsync({
        potId: selectedPotId,
        userId: row.user_id,
        gameweekId: selectedPot?.game_type === 'pick5' ? gameweekIdNum : undefined,
      })
      addToast({
        type: result.reinstated ? 'success' : 'error',
        message: result.reinstated
          ? `${row.display_name || row.username}'s entry reinstated`
          : (result.reason || 'Could not reinstate this entry'),
      })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to reinstate entry' })
    } finally {
      setReinstatingUserId(null)
    }
  }

  // --- Record payment received (Pick 5 only) ---
  // Deliberately independent of the gameweek selector above: a recorded
  // payment allocates across whichever future gameweeks are unpaid, not
  // the one gameweek happening to be selected for the per-week table below
  // — forcing the organiser to pick one first would be an unnecessary
  // click with no bearing on this action.
  const { data: potMembers = [], isLoading: membersLoading } = usePotMembers(selectedPot?.game_type === 'pick5' ? selectedPotId : null)
  const recordPayment = useRecordPayment()
  const [paymentUserId, setPaymentUserId] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentPreview, setPaymentPreview] = useState(null)
  const [paymentApplied, setPaymentApplied] = useState(null) // last successful result, kept until the next preview starts
  // Refs, not state: a ref updates synchronously, so a second click fired
  // in the same tick as the first (before React re-renders the button as
  // disabled) is still caught. Button's own `loading`-driven `disabled`
  // covers every render after the first — this covers the render before it.
  const previewInFlight = useRef(false)
  const confirmInFlight = useRef(false)

  useEffect(() => {
    setPaymentUserId('')
    setPaymentAmount('')
    setPaymentPreview(null)
    setPaymentApplied(null)
  }, [selectedPotId])

  const paymentAmountNumber = Number(paymentAmount)
  const paymentAmountValid = paymentAmount !== '' && Number.isFinite(paymentAmountNumber) && paymentAmountNumber > 0

  async function handlePreviewPayment() {
    if (previewInFlight.current || !paymentUserId || !paymentAmountValid) return
    previewInFlight.current = true
    setPaymentApplied(null)
    try {
      const result = await recordPayment.mutateAsync({ potId: selectedPotId, userId: paymentUserId, amount: paymentAmountNumber, dryRun: true })
      setPaymentPreview(result)
    } catch (err) {
      setPaymentPreview(null)
      addToast({ type: 'error', message: err.message || 'Could not preview this payment' })
    } finally {
      previewInFlight.current = false
    }
  }

  async function handleConfirmPayment() {
    if (confirmInFlight.current || !paymentPreview) return
    confirmInFlight.current = true
    try {
      const result = await recordPayment.mutateAsync({ potId: selectedPotId, userId: paymentUserId, amount: paymentAmountNumber, dryRun: false })
      setPaymentApplied(result)
      setPaymentPreview(null)
      setPaymentAmount('') // ready for a genuinely new payment; selected member is kept
      addToast({
        type: 'success',
        message: result.weeks_materialized > 0
          ? `Payment recorded — ${result.weeks_materialized} week${result.weeks_materialized === 1 ? '' : 's'} marked paid`
          : 'Payment recorded — no eligible unpaid weeks remained to allocate',
      })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to record this payment' })
    } finally {
      confirmInFlight.current = false
    }
  }

  const selectedMemberName = potMembers.find((m) => m.user_id === paymentUserId)?.display_name

  // --- CSV bulk import ---
  const [csvText, setCsvText] = useState('')
  const [csvFileName, setCsvFileName] = useState('')
  const [preview, setPreview] = useState(null) // { rows, results, summary }
  const [applyResult, setApplyResult] = useState(null)
  const bulkVerify = useBulkVerifyPayments()
  const bulkConfirmInFlight = useRef(false)

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
    if (bulkConfirmInFlight.current || !preview) return
    bulkConfirmInFlight.current = true
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
    } finally {
      bulkConfirmInFlight.current = false
    }
  }

  const paymentTableRows = statusRows.map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name || r.username || 'User',
    username: r.username || 'unknown',
    is_paid: r.is_paid,
    // Reinstate is only ever offered where it's decidable: a void entry
    // whose payment is now marked paid — matches reinstate_entry's own
    // "payment_not_verified"/"not_void" guard rejections one-to-one, so
    // the button never appears somewhere the backend would just reject it.
    canReinstate: r.is_paid && r.entry_status === 'void',
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
            <label htmlFor="admin-payments-pot" className="mb-2 block text-sm text-white/70">Pot</label>
            {potsLoading ? (
              <div className="flex items-center gap-2 text-sm text-white/40">
                <Spinner size="sm" /> Loading pots...
              </div>
            ) : pots.length === 0 ? (
              <p className="text-sm text-white/40">You are not an admin of any pot.</p>
            ) : (
              <select
                id="admin-payments-pot"
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
            <label htmlFor="admin-payments-gameweek" className="mb-2 block text-sm text-white/70">
              Gameweek <span className="text-white/30">(for per-week actions below)</span>
            </label>
            <select
              id="admin-payments-gameweek"
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

      {!selectedPotId ? (
        <EmptyState icon={CreditCard} title="Select a pot" description="Choose a pot above to manage its payments." />
      ) : (
        <>
          {selectedPot?.game_type === 'pick5' && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-white">Record payment received</h2>
              <Card className="p-5 space-y-4">
                <p className="text-sm text-white/45">
                  The organiser collects payment off-platform (cash, bank transfer, Revolut, PayPal, etc.) — this
                  only records that it was received. Enter who paid and how much; the amount must be an exact
                  multiple of the weekly entry fee ({selectedPot?.entry_fee ?? '—'}), and the app allocates it
                  automatically to that member's next unpaid eligible Pick 5 gameweeks. No individual week-ticking
                  required.
                </p>

                {membersLoading ? (
                  <div className="flex items-center gap-2 text-sm text-white/40"><Spinner size="sm" /> Loading members...</div>
                ) : potMembers.length === 0 ? (
                  <EmptyState icon={Wallet} title="No members yet" description="Invite players to this pot before recording a payment." />
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
                      <select
                        aria-label="Member who paid"
                        value={paymentUserId}
                        onChange={(e) => { setPaymentUserId(e.target.value); setPaymentPreview(null); setPaymentApplied(null) }}
                        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
                      >
                        <option value="">Select a member</option>
                        {potMembers.map((m) => (
                          <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
                        ))}
                      </select>
                      <input
                        aria-label="Amount received"
                        type="number"
                        min="0"
                        step="0.01"
                        value={paymentAmount}
                        onChange={(e) => { setPaymentAmount(e.target.value); setPaymentPreview(null); setPaymentApplied(null) }}
                        placeholder="Amount received"
                        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
                      />
                      <Button
                        variant="secondary"
                        onClick={handlePreviewPayment}
                        loading={recordPayment.isPending && !paymentApplied}
                        disabled={!paymentUserId || !paymentAmountValid}
                      >
                        Preview
                      </Button>
                    </div>

                    {paymentPreview && (
                      <div className="rounded-xl border border-white/8 bg-black/10 p-4 space-y-3" role="status">
                        <p className="text-sm text-white">
                          <span className="font-medium">{paymentAmount} received</span> from {selectedMemberName}. This will mark
                          {' '}{paymentPreview.weeks_materialized === 0 ? 'no' : paymentPreview.weeks_materialized} future Pick 5 week
                          {paymentPreview.weeks_materialized === 1 ? '' : 's'} as paid:
                        </p>

                        {paymentPreview.already_paid_gameweeks.length > 0 && (
                          <div>
                            <div className="mb-1.5 text-xs uppercase tracking-wide text-white/35">Already paid (skipped)</div>
                            <div className="flex flex-wrap gap-1.5">
                              {paymentPreview.already_paid_gameweeks.map((gw) => (
                                <GameweekChip key={gw.id} gw={gw} tone="skip" />
                              ))}
                            </div>
                          </div>
                        )}

                        {paymentPreview.gameweeks.length > 0 && (
                          <div>
                            <div className="mb-1.5 text-xs uppercase tracking-wide text-white/35">Will allocate to</div>
                            <div className="flex flex-wrap gap-1.5">
                              {paymentPreview.gameweeks.map((gw) => (
                                <GameweekChip key={gw.id} gw={gw} tone="allocate" />
                              ))}
                            </div>
                          </div>
                        )}

                        {paymentPreview.weeks_materialized < paymentPreview.weeks_requested && (
                          <p className="flex items-center gap-2 text-xs text-amber">
                            <AlertTriangle size={14} />
                            Only {paymentPreview.weeks_materialized} of {paymentPreview.weeks_requested} requested weeks
                            are available — fewer eligible gameweeks remain this season. Nothing is refunded or carried
                            over automatically.
                          </p>
                        )}

                        <div className="flex justify-end">
                          <Button onClick={handleConfirmPayment} loading={recordPayment.isPending}>
                            <CheckCircle2 size={16} />
                            Confirm &amp; record payment
                          </Button>
                        </div>
                      </div>
                    )}

                    {paymentApplied && (
                      <div className="flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm text-accent" role="status">
                        <CheckCircle2 size={16} />
                        Payment verified — {paymentApplied.weeks_materialized} week{paymentApplied.weeks_materialized === 1 ? '' : 's'} marked paid
                        {paymentApplied.gameweeks.length > 0 && (
                          <span className="text-accent/70">({paymentApplied.gameweeks.map((gw) => `GW${gw.number}`).join(', ')})</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </Card>
            </section>
          )}

          {!selectedGameweekId ? (
            <EmptyState
              icon={CreditCard}
              title="Select a gameweek"
              description="Marking individual weeks paid/unpaid and CSV import are scoped to one gameweek at a time."
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
                    reinstatingUserId={reinstatingUserId}
                    onMarkPaid={(row) => handleMark(row, true)}
                    onMarkUnpaid={(row) => handleMark(row, false)}
                    onReinstate={handleReinstate}
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
                      <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" aria-label="Choose CSV file" />
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
        </>
      )}
    </div>
  )
}
