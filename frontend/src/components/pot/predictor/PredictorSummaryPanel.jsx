import { CheckCircle2, Target, Goal, Pencil } from 'lucide-react'
import Button from '../../ui/Button'
import { formatTeamName } from '../../../utils/format'

// Phase 25 — the persistent predictions panel: a sidebar on desktop, the
// expanded content of a sticky bottom sheet on mobile (see
// PredictorPotDetail.jsx for how each wraps this) — same pattern
// PicksSummaryPanel.jsx already established for Pick 5, adapted for Score
// Predictor's own shape (exactly one prediction per gameweek — a real,
// unrelated-to-this-change UNIQUE(game_entry_id, gameweek_id) constraint —
// rather than up to five player picks).
//
// `draft` is the locally-staged, not-yet-saved selection (set when a
// fixture card's own "Use this prediction" is clicked); `savedPick` is
// what the server actually has right now. The panel always shows whichever
// exists (draft takes priority — it's what pressing Save would submit),
// and makes the saved/unsaved distinction explicit rather than leaving the
// user to guess from a plain "Saved" checkmark that may be stale.
export default function PredictorSummaryPanel({
  draft,
  savedPick,
  fixture,
  gameweekNumber,
  gameweekWide,
  goalscorerName,
  onEdit,
  onSave,
  saving,
  deadlineClosed,
}) {
  const prediction = draft ?? savedPick
  // Item 20 (P0) — root cause of "an existing selection cannot be
  // updated": this never compared `fixtureId`. Replacing a saved
  // prediction with a different fixture whose scoreline+goalscorer
  // happened to numerically match the OLD saved values (a very ordinary
  // coincidence — 1-0/2-1/1-1 are common scorelines) evaluated to
  // `isDirty = false`, silently disabling Save with no explanation. Any
  // fixture change is now unconditionally treated as dirty, matching what
  // "replacing a selection" actually means, regardless of whether the
  // score/goalscorer values happen to coincide.
  const isDirty = !!draft && (
    !savedPick ||
    String(draft.fixtureId) !== String(savedPick.fixture_id) ||
    draft.homeScore !== savedPick.predicted_home_score ||
    draft.awayScore !== savedPick.predicted_away_score ||
    (draft.goalscorerId ? Number(draft.goalscorerId) : null) !== (savedPick.goalscorer_player_id ?? null)
  )
  const selectedCount = prediction ? 1 : 0

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Your predictions</h2>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold tabular ${
            selectedCount === 1
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-white/10 bg-white/5 text-white/60'
          }`}
        >
          {selectedCount} / 1 selected
        </span>
      </div>

      {!prediction ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-center">
          <Target size={20} className="mx-auto mb-2 text-white/25" />
          <p className="text-sm text-white/45">Tap a fixture to add a prediction.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          disabled={deadlineClosed}
          className="w-full rounded-2xl border border-white/8 bg-surface-1 p-4 text-left transition-colors hover:border-white/20 hover:bg-surface-2 disabled:cursor-not-allowed disabled:hover:border-white/8 disabled:hover:bg-surface-1"
        >
          {/* Gameweek-wide mode is presented distinctly (per business-rules.md
              § Score Predictor: predictor_scorer_scope only changes when the
              scorer bonus is awarded — anywhere in the gameweek, not just
              this fixture — never a different picker or a different fixture
              scope for the prediction itself). Framed by round number, not
              team names, so it never reads as if it were a fixture-specific
              pick with the wrong teams. */}
          {gameweekWide && (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/35">
              Gameweek {gameweekNumber}
            </p>
          )}
          <p className="font-semibold text-white">
            {gameweekWide ? (
              <>Score: {prediction.homeScore ?? prediction.predicted_home_score}&ndash;{prediction.awayScore ?? prediction.predicted_away_score}</>
            ) : (
              <>
                {formatTeamName(fixture?.home_team)} {prediction.homeScore ?? prediction.predicted_home_score}&ndash;{prediction.awayScore ?? prediction.predicted_away_score} {formatTeamName(fixture?.away_team)}
              </>
            )}
          </p>
          {goalscorerName && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-white/50">
              <Goal size={13} className="text-white/30" />
              {goalscorerName}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {isDirty ? (
              <span className="font-medium text-amber">Unsaved</span>
            ) : (
              <span className="flex items-center gap-1 font-medium text-accent">
                <CheckCircle2 size={12} /> Saved
              </span>
            )}
            {!deadlineClosed && (
              <span className="ml-auto flex items-center gap-1 text-white/35">
                <Pencil size={11} /> Edit
              </span>
            )}
          </div>
        </button>
      )}

      <Button
        type="button"
        onClick={onSave}
        disabled={saving || !draft || !isDirty || deadlineClosed}
        className="mt-4 w-full"
      >
        <CheckCircle2 size={16} />
        {saving ? 'Saving...' : savedPick ? 'Update prediction' : 'Save prediction'}
      </Button>
    </div>
  )
}
