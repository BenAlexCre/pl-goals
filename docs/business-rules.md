# Business Rules

Last reviewed: 2026-08-05.

This document describes **what the game's rules are**, in plain language, for anyone
who needs to reason about the product without reading code — a support conversation,
a dispute about a payout, a new feature that has to respect an existing rule. It is
deliberately *not* an implementation document: it says "picks lock 30 minutes before
kickoff," not "`compute-deadlines` sets `deadline_utc` to `earliest_kickoff_utc` minus
1800 seconds." For the implementation, follow the link in each section to
[database.md](./database.md) or [api.md](./api.md).

Every rule below is a **verified fact**, derived from reading the schema, RLS
policies, edge functions, and the two pick-building flows in the frontend — not
inferred or assumed. Where the app's actual behavior is inconsistent or the rule is
genuinely undefined, this document says so explicitly and links to the relevant
[current-state.md](./current-state.md) issue, rather than stating a rule that isn't
really being enforced. If you're relying on this document to settle a real dispute
(e.g. a payout), cross-check the linked issue first — an "undefined" rule here means
the system's actual behavior is whatever happened to run, not something you can
appeal to as intended design.

See also: [features.md](./features.md) (what's actually reachable in the UI),
[decisions.md](./decisions.md) (why some of these rules were designed the way they
were).

## When picks lock

Each gameweek has a `deadline_utc`, computed as **30 minutes before the earliest
kickoff of any fixture in that gameweek** — not 30 minutes before each individual
match, one single deadline for the whole gameweek, set by the earliest game. Once the
deadline passes, an entry can no longer be created or edited.

Implementation: `compute-deadlines` edge function
([api.md § compute-deadlines](./api.md#post-functionsv1compute-deadlines)) sets
`gameweeks.deadline_utc`; enforcement is a client-side check in `useSubmitPicks`
(`PicksPage` flow) that compares `deadline_utc` to the current time before allowing a
submission — there is no database-level (RLS or constraint) enforcement of the
deadline itself, only of entry `status` (see
[database.md § Row Level Security summary](./database.md#row-level-security-summary):
`user_entries`/`user_entry_picks` can only be updated while `status = 'pending'`).

**Caveat — this 30-minute rule is not reliably what's actually live.** An
undocumented SQL trigger on `fixtures` recomputes the same column using a
different, 15-minute offset on every fixture change, silently overwriting
`compute-deadlines`' correct 30-minute value in the common case. Confirmed
live 2026-08-05 — see
[current-state.md ISSUE-24](./current-state.md#issue-24--an-undocumented-sql-trigger-recomputes-gameweeksdeadline_utc-with-a-conflicting-incorrect-offset).
Until that's resolved, treat the live `deadline_utc` value as potentially 15
minutes early, not the 30 minutes this section (and the codebase's own
`compute-deadlines` function) describes as intended.

## What counts as a valid goal

A goal counts toward a player's tally for a gameweek if it's a `fixture_events` row
with `event_type` in (`goal`, `penalty`) **and `is_own_goal` is false**. Own goals do
not count for the scoring player (they're recorded as events but excluded from goal
counts). Missed penalties, cards, and substitutions don't count as goals, obviously,
but are tracked as separate event types for the match-event timeline.

Implementation: the `player_fixture_goals` materialized view
([database.md § player_fixture_goals](./database.md#player_fixture_goals-materialized-view)).
**Caveat:** this view is only as fresh as its last refresh, which nothing in the
repository currently triggers automatically — see
[current-state.md ISSUE-3](./current-state.md#issue-3--player_fixture_goals-materialized-view-is-never-refreshed).
A goal that's happened in the real world may not yet be reflected here.

## How scoring works

A pick wins if the picked player's goal count for the gameweek is **greater than or
equal to a threshold**, where the threshold is **how many times that member picked
that same player** in their 5-player entry for that gameweek. Picking a player once
means they need 1+ goals; picking the same player twice (allowed, up to 5 times)
means they need 2+ goals for *that* pick to count as a win — each of the duplicate
picks is scored independently against the same running goal count, so picking one
prolific scorer 5 times is a legitimate (if concentrated) strategy, not a way to get 5
independent easy wins.

An entry's overall score for the gameweek is `picks_won` — the count of its 5 picks
that individually met their threshold. While the gameweek has a live fixture in
progress, picks display as `winning`/`losing` rather than the final `won`/`lost`, but
the underlying win/loss logic is identical either way.

Implementation: the `recompute_goal_thresholds()` trigger derives the threshold
automatically from how many picks share a `(entry_id, player_id)` pair (see
[database.md § user_entry_picks](./database.md#user_entry_picks) and
[decisions.md § Duplicate-pick scoring model](./decisions.md#duplicate-pick-scoring-model-goal-thresholds-via-trigger));
`compute-scores` compares goal counts against thresholds
([api.md § compute-scores](./api.md#post-functionsv1compute-scores)).

## How ties are resolved

**Not currently defined.** `settle-gameweek` ranks pot members by `picks_won`
descending and assigns sequential ranks (1st, 2nd, 3rd...) with no secondary
tie-break — two members with the same `picks_won` get different ranks based on
incidental row order, not a rule anyone chose. This was discovered while writing this
document: there is no strike-rate comparison, submission-time comparison, or
shared-rank behavior anywhere in the system. Treat this as an open product decision,
not a documented rule to rely on — see
[current-state.md ISSUE-17](./current-state.md#issue-17--leaderboard-ranking-has-no-tie-break-rule)
and [roadmap.md § P1 item 10](./roadmap.md#p1--close-the-loop-on-features-that-are-half-built)
for the plan to fix this. Once a rule is chosen, it belongs in this section.

## Payment verification rules

**Canonical design, decided 2026-08-05** — see
[decisions.md § Payment Verification, not payment processing](./decisions.md#payment-verification-not-payment-processing).
The application never collects, processes, or holds money, and never integrates a
payment gateway (Stripe, PayPal, Revolut's API, or any other). Payment happens
entirely off-platform, by whatever means the pot's members agree on — Revolut,
bank transfer, cash, anything. The application's only responsibility is recording
**whether an entry has been verified as paid**, by an admin.

Every entry starts **unverified** by default (`entry_payments.is_paid = false`),
created automatically the moment a member submits an entry for a gameweek — payment
status is tracked separately from pick submission, so a member can lock in their
picks before their payment is verified. A pot admin (or app admin) verifies an entry
as paid or unpaid in one of two ways:

- **Single entry** — mark one member's entry as paid, manually, one at a time.
- **Bulk CSV import** — verify many members' payments in one operation. Format:
  ```
  Identifier,Pot,Status,Notes
  ben@example.com,Premier League Pool,Paid,Revolut
  adam@example.com,Premier League Pool,Paid,Cash
  0871234567,Premier League Pool,Paid,Bank Transfer
  ```
  `Identifier` matches a member by **email or phone number** — whichever the pot's
  member record has on file. The importer must: validate every row before touching
  any data; show a full preview of every change it's about to make; report every
  validation error up front rather than failing mid-import; apply only rows the
  admin has explicitly confirmed; keep a full audit trail of what was
  imported, by whom, and when; and never partially apply an import without explicit
  confirmation — a batch either goes in as reviewed, or nothing does.

**An entry that is not verified as paid by the time settlement runs is automatically
voided** — all of its picks are marked `void` and it's excluded from the leaderboard
entirely, regardless of how well its picks would have scored. Settlement depends
**only** on `entry_payments.is_paid` — never on any external payment gateway's status,
by design. This rule is implemented in `Pick5Engine.settle()` (Milestone 4 Slice 5)
and, for the retired prototype schema, in `compute-scores`. **For Last Man Standing**
(`LmsEngine.settle()`, Milestone 5 Slice 5), the same rule reads
`entry_payments.scope = 'season'` instead of `'gameweek'` — LMS charges one flat fee
for the whole competition, not a weekly one — so voiding an entry voids **every** one
of its picks, across every gameweek it's played, not just the current one. **For
Score Predictor** (`PredictorEngine.settle()`, Milestone 6 Slice 5), the same
`scope = 'season'` flat-fee shape applies, for the same reason (one entry for the
whole competition, GE-4.5) — an unpaid entry is excluded going forward, though its
individual already-scored predictions are not currently marked void on their own
row the way Pick 5's/LMS's picks tables are (a known, documented gap — see
[decisions.md § Score Predictor settlement](./decisions.md#score-predictor-settlement)).

**Late Payment Override, decided and implemented 2026-08-08.** A voided
entry is not permanently lost — if a player pays late, a pot admin (or app
admin) can mark the payment paid and then, as a second, separate,
explicit action, choose to reinstate the entry. This never happens
automatically; accepting the payment alone does not reinstate anything.
Reinstatement re-scores everything the entry missed while voided (a
gameweek during the void window the entry had no chance to pick for is
still treated as a miss, same as any other missed gameweek — reinstatement
restores the entry to the competition, it doesn't retroactively grant
picks that were never made) and lets the pot's own normal settlement
continue from there. **One firm limit**: reinstatement is refused outright
once the relevant competition instance has already paid out (a gameweek's
prize for Pick 5, or the whole competition's prize for LMS/Predictor) —
money that's already been distributed is never clawed back or re-split.
Applies to all three modes, including Pick 5. Full reasoning:
[decisions.md § Late Payment Override](./decisions.md#late-payment-override).

**Implemented, 2026-08-05**: a pot admin (or app admin) can now actually verify
payments, both ways, through `/admin/payments` — `pages/AdminPayments.jsx`. Single
entry: a table of every pot member's payment status for the selected pot+gameweek,
with Mark paid/Mark unpaid buttons, calling `admin-actions`' existing `mark_paid`/
`mark_unpaid` actions. Bulk CSV: upload a file in the exact format above, click
"Validate & preview" (calls the new `bulk_verify_payments` action with `dry_run:
true` — resolves every identifier/pot, validates every row, writes nothing, shows
the full outcome table), review it, then "Confirm import" (the same call with
`dry_run: false`) to apply. Every row in one import applies to a single gameweek,
selected in the UI before uploading — the fixed CSV format has no gameweek column.
Verified live, end-to-end, through the real application: manual paid/unpaid,
CSV import (including duplicate identifiers, unknown users, unknown pots, an
invalid status value, and rows already in their target state), and settlement
correctly respecting a payment verified via CSV (an entry that would otherwise
void settled and won its pot once its CSV row was applied).

**Two rules from the spec above with a real, disclosed limitation, not silently
assumed satisfied:**
- **"Never partially apply an import without explicit confirmation"** — satisfied
  for the write step itself (nothing is written until "Confirm import" is clicked,
  and the confirm step re-validates from scratch server-side, never trusting a
  stale client-side preview) — but within one confirmed batch, rows are still
  reported individually as updated/skipped/failed, per the CSV format's own
  row-level granularity and the required processed/updated/skipped/failed summary.
  This was the correct reading, not an all-or-nothing single-transaction import —
  see [decisions.md § Payment Verification bulk import](./decisions.md#payment-verification-bulk-import-no-schema-change-needed).
- **"Keep a full audit trail of what was imported, by whom, and when"** — satisfied
  at the **row** level (`entry_payments.marked_by`/`marked_at`/`notes`, identical to
  manual verification) but **not** at the batch level — there is no record of "admin
  X ran a CSV import of N rows at time Y" as a single auditable event, only the
  per-row outcome. Exactly the gap `entry_payments`' own column set already
  anticipated (see the file's git history) and not closed here — it would need a
  new table, out of scope for a no-schema-change implementation.

Implementation: `entry_payments` table, `create_entry_payment()` trigger,
`admin-actions`' `mark_paid`/`mark_unpaid`/`bulk_verify_payments` actions
([api.md § admin-actions](./api.md#post-functionsv1admin-actions)), the
payment-verification check inside `compute-scores`/`Pick5Engine.settle()`, and
`pages/AdminPayments.jsx`/`hooks/useAdmin.js`/`utils/csv.js` on the frontend.

## Last Man Standing

**Revised 2026-08-05** — see
[decisions.md § LMS: Wipeout Resolution, automatic rollover, and a fixed per-competition entry fee](./decisions.md#lms-wipeout-resolution-automatic-rollover-and-a-fixed-per-competition-entry-fee)
and [game-engine.md § GE-5.2](./game-engine.md#ge-52-last-man-standing) for
the implementation-level detail these rules are drawn from. Supersedes an
earlier same-session version of this section that proposed cumulative
per-gameweek backfill billing for late entry — that proposal has been
withdrawn; see the linked decision for why. These rules are now largely
shipped — see the **Status** paragraph at the end of this section for
exactly what's implemented and what (Final Prediction, pot activation)
remains deliberately unbuilt.

**Payment.** One entry fee per competition, paid once — never a recurring
weekly charge. This applies to every LMS pot, rollover or not. (Pick 5's
payment model — one fee per gameweek — is unchanged and unaffected; the two
modes have genuinely different payment shapes, tracked identically under the
hood via `entry_payments.scope`.)

**Elimination.** Each entrant picks one team to win its gameweek's fixture. A
loss or a draw eliminates that entrant. Elimination continues gameweek by
gameweek until exactly one entrant remains — that entrant wins the pot. There
is no tiebreak pick during the competition itself; a **wipeout** is resolved
by the pot's **Wipeout Resolution** setting, and a **season-end tie** by its
own, separate **Season-End Tie Rule** setting — both below.

**No repeat teams, ever — decided 2026-08-05, no cycles.** An entrant may
never pick the same team twice across the whole competition — one
continuous sequence from the opening gameweek to the end, with no resets,
no half-season cycles, and no configurable cycle mode of any kind. A
rollover competition is a brand-new pot with brand-new entries (see
"Roll Prize" below), so every entrant's available-team pool starts fresh
there naturally, not because anything reset mid-competition.

**When picks lock.** Each gameweek's pick locks independently, at that
gameweek's own deadline (the same 30-minutes-before-earliest-kickoff rule
as Pick 5 — see [§ When picks lock](#when-picks-lock)) — locking one
gameweek's pick never affects any other gameweek. This is different from
Pick 5, where locking an entry locks the entry as a whole: an LMS entry
lasts the whole competition, so only the individual pick can lock, never
the entry itself.

**Missing a pick eliminates you, exactly like a losing pick — decided
2026-08-06.** If an alive entry has not submitted a pick before its
gameweek's deadline, that entry is eliminated immediately. There is no
grace period, no automatically-assigned pick, and no admin override. This
applies even if every remaining entry misses the same gameweek at once —
that's still a wipeout, and **Wipeout Resolution** (below) decides the
outcome exactly as it would for a gameweek where everyone's picked team
lost or drew.

**Standings — decided 2026-08-06, designed specifically for Last Man
Standing, not copied from Pick 5's points-based leaderboard.** LMS has no
points, so "who's ahead" isn't a score comparison:
- Every currently-alive entrant **ties for first place**. Nothing
  distinguishes one survivor from another — there is no rule (and none was
  invented) that would rank one alive entrant above another.
- Eliminated entrants rank below every alive one, ordered by **how
  recently they were eliminated** — outlasting another eliminated entrant
  is a real accomplishment, so the more recent elimination ranks better.
  Entrants eliminated in the same gameweek (including a wipeout) tie with
  each other.
- The standings update continuously, every gameweek — not just at the
  end — and always show the single current picture of the competition, not
  a separate view per gameweek the way Pick 5's weekly leaderboard does.

**Wipeout and Wipeout Resolution.** Every LMS pot has a required,
immutable-once-entries-exist setting, **Wipeout Resolution** — `Split Prize`
or `Roll Prize` — chosen when the pot is created. It only matters for a
**wipeout**: every remaining entrant eliminated by the same gameweek's
results (as opposed to the ordinary case, where elimination narrows down to
exactly one survivor over several gameweeks).
- **Split Prize** — every entrant eliminated in that final gameweek is a
  joint winner; the net prize is split equally between them. The competition
  ends there.
- **Roll Prize** — nobody wins, and the competition's net prize becomes a
  **carry-over amount**. **A new LMS pot is created automatically** —
  organisers are never asked to create it by hand. The carry-over amount
  belongs entirely to the **new** pot, stored on it explicitly — the old
  pot only ever records that it ended via rollover, it doesn't hold or
  track the amount going forward. This means the new pot's prize-pool
  breakdown (carry-over + new entry fees = total pool) reads directly off
  its own row, with no need to look up the pot it came from. Only the
  organiser is a member of it initially; everyone else must explicitly
  rejoin, and every joiner (including the organiser, if they want a paid
  entry themselves) pays that new competition's own entry fee — the
  carry-over amount is added on top of collected entry fees to form the new
  prize pool, it is never a substitute for anyone paying in. Example: a
  finished pot rolls over €300; the new pot collects €220 in entry fees;
  that new pot's prize pool is €520. The new pot gets a sensible default
  name derived from the old one — e.g. "Premier League LMS" becomes
  "Premier League LMS (Rollover #1)"; rolling that pot over again becomes
  "Premier League LMS (Rollover #2)", never a stacked "(Rollover #1)
  (Rollover #2)" — and starts inactive (draft) — see "Late entry" below for
  what the organiser does before opening it. The old pot is never reopened
  or modified further — an immutable historical record from the moment it
  settles.

**Season-end tie.** A separate case from a wipeout: multiple entrants are
still alive when the season's actual final gameweek finishes (nobody was
eliminated that gameweek — they simply ran out of season to play).
**Season-End Tie Rule**, a second required LMS setting, decides the outcome:
- **Split Prize** — the net prize is split equally among the remaining
  entrants.
- **Final Prediction** — each remaining entrant submits one prediction for a
  designated fixture: winning team, first goalscorer, and the minute of that
  goal. The winner is whoever's prediction is closest, checked in this
  order: (1) correct winning team, (2) correct first goalscorer, (3) closest
  predicted minute, (4) if still tied after all three, split the prize
  equally.

**Late entry.** Joining an LMS pot after it has started is **not allowed**,
with one exception: a **rollover pot** — one the Game Engine created
automatically after a Roll Prize wipeout, above. While that pot is still in
its draft (pre-launch) phase, the organiser may rename it (the
auto-generated default is just a starting point), invite players, verify
their payments, and choose the competition's starting gameweek — the next
gameweek, any future gameweek, or even the following season's first
gameweek, so a nearly-finished season doesn't force an awkward immediate
restart. Nothing starts automatically — the organiser must explicitly
activate the pot once ready. Anyone may join during this draft phase. **Once
the organiser
opens (activates) the pot, normal LMS entry rules apply — no further
joining, ever, same as any other pot.** There is no cumulative billing and
no catch-up payment at any point: everyone entering a rollover competition,
whenever during the draft phase they join, pays exactly one entry fee — the
new competition's own, same as anyone joining a brand-new (non-rollover)
pot.

**Status: every part of the Last Man Standing lifecycle is now implemented
and verified live, as of 2026-08-06 — entry creation (`ISSUE-32`'s
entry-window rule included), pick submission, locking, scoring,
elimination, payment-void settlement, standings, winner determination,
prize awarding, and notifications.** See
[current-state.md § Resolved issues](./current-state.md#resolved-issues),
[decisions.md § LMS: no cycles](./decisions.md#lms-no-cycles-current_cycle-removed-slice-2-implemented),
[decisions.md § LMS locking](./decisions.md#lms-locking),
[decisions.md § LMS scoring and elimination](./decisions.md#lms-scoring-and-elimination),
[decisions.md § LMS settlement](./decisions.md#lms-settlement),
[decisions.md § LMS standings](./decisions.md#lms-standings),
[decisions.md § LMS winner determination](./decisions.md#lms-winner-determination),
[decisions.md § LMS prize awarding](./decisions.md#lms-prize-awarding),
[decisions.md § LMS prize awarding: transactionality correction](./decisions.md#lms-prize-awarding-transactionality-correction),
and [decisions.md § LMS notifications](./decisions.md#lms-notifications).
Pick submission enforces the no-repeat-team rule above via a real database
constraint, not just application logic. A single survivor is paid the full
net prize; a Split Prize wipeout or season-end tie splits it equally among
the group; a Roll Prize wipeout pays nobody and automatically creates the
new draft rollover pot described above (name, config, `carry_over_amount`,
sole organiser member — all Game-Engine-created, no manual step). Every
paid winner receives an in-app notification once the payout is written.
**Not implemented, deliberately:** the Final Prediction settlement path
(throws a specific, catchable error rather than guessing if a pot
configured that way ever actually reaches a season-end tie — most won't);
activating a draft rollover pot (`status` leaving `'draft'` — nothing about
a rollover pot starts on its own; a separate, not-yet-designed piece of
work); and a rollover-specific notification (telling the organiser their
competition rolled over — flagged as a likely future addition, not built
ahead of being asked for).

## Score Predictor

**Milestone 6, in progress — this section covers only what's actually
decided and shipped so far (Slices 1-9: entry creation, pick submission,
locking, scoring, settlement, standings, winner determination, prize
awarding, and notifications — all eight `GameEngine` contract methods).**
See
[decisions.md § Score Predictor architecture review](./decisions.md#score-predictor-architecture-review),
[§ Score Predictor pick submission](./decisions.md#score-predictor-pick-submission-slice-2),
[§ Score Predictor locking](./decisions.md#score-predictor-locking),
[§ Score Predictor scoring](./decisions.md#score-predictor-scoring),
[§ Score Predictor settlement](./decisions.md#score-predictor-settlement),
[§ Score Predictor standings](./decisions.md#score-predictor-standings),
[§ Score Predictor winner determination](./decisions.md#score-predictor-winner-determination),
[§ Score Predictor prize awarding](./decisions.md#score-predictor-prize-awarding),
and [§ Score Predictor notifications](./decisions.md#score-predictor-notifications)
for the full reasoning and everything still genuinely undecided. Every
paid winner receives an in-app notification once the payout is written —
tied winners each receive their own.

**Entry.** One entry per pot for the whole season (like Last Man Standing,
unlike Pick 5's per-gameweek entries) — cumulative points accrue across
every gameweek's prediction, so there's no separate entry per week.

**Payment.** One entry fee per competition, paid once — never a recurring
weekly charge, same shape as Last Man Standing's and for the same reason
(one entry for the whole season). An entry that isn't verified as paid is
excluded going forward — see [§ Payment verification rules](#payment-verification-rules)
for the shared mechanics and Predictor's one known gap (no per-pick void
marker yet).

**Predicting a fixture.** Each gameweek, an entrant chooses exactly one
fixture from that gameweek and predicts its exact scoreline (e.g. 2-1).
There is no separate "who wins" pick — a draw is simply predicting an
equal score (e.g. 1-1); the winning team, if any, is worked out from the
predicted scoreline itself, not chosen separately.

**Goalscorer bonus prediction — optional.** An entrant may also guess a
player to score in that fixture, for a bonus. This is entirely optional —
a prediction with no goalscorer guess is fully valid, it simply isn't
eligible for that gameweek's bonus and loses no points for omitting it.
If a goalscorer guess is given, it must be a player who's actually on one
of the two teams playing in the predicted fixture.

**When picks lock.** Same 30-minutes-before-earliest-kickoff deadline rule
as every other mode (§ [When picks lock](#when-picks-lock)) — a prediction
for a gameweek can no longer be made or changed once that gameweek's
deadline passes.

**Changing a prediction.** An entrant may resubmit a different prediction
for the same gameweek any time before that gameweek's deadline — this
replaces the previous prediction for that gameweek, it does not create a
second one.

**Scoring — points are per-pot configurable, defaulting to 5-3-2.** Once a
predicted fixture finishes, each prediction is scored one of three ways,
using that pot's own configured point values (an organiser sets these when
creating the pot; every pot defaults to 5/3/2 and most will never need to
change them):

- **Exact scoreline** — the predicted score matches the final score
  exactly (e.g. predicted 2-1, actual 2-1). Worth
  `predictor_exact_score_points`, default **5**.
- **Correct result, wrong scoreline** — the predicted outcome (home win,
  away win, or draw) matches the actual outcome, but the exact score
  doesn't (e.g. predicted 2-1, actual 3-0 — both home wins). Worth
  `predictor_correct_result_points`, default **3**. Mutually exclusive
  with exact-scoreline points — a prediction is scored one or the other,
  never both.
- **Wrong result entirely** — worth 0 points.

The optional goalscorer bonus, when correctly predicted, is worth
`predictor_scorer_bonus_points` (default **2**) **on top of** whichever
result points were already earned — it is never mutually exclusive with
either of the above. Whether the goalscorer needs to score in the
specifically-predicted fixture, or anywhere in that gameweek, is a
separate per-pot setting (`predictor_scorer_scope`).

A prediction for a postponed or cancelled fixture is left unresolved
(no points either way) until the fixture actually finishes or the
competition is otherwise settled — it is not automatically scored zero.

**Standings.** A leaderboard ranks every non-voided entrant by cumulative
points, highest first; entrants tied on points share a rank, and the next
distinct score skips ahead by however many were tied (the same rule Pick 5's
own leaderboard uses). A voided (unpaid) entry never appears; if it's
later reinstated after a late payment (see below), it reappears
automatically, at its correct, fully-rescored position, the next time
standings are generated — no separate action is needed to "add it back."

**Late Payment Override.** If a player's entry was voided for non-payment
and they pay late, a pot admin can mark the payment paid and then, as a
separate, explicit action, choose to reinstate the entry. This never
happens automatically — same shared rule every mode follows. Reinstatement
re-scores everything the entry missed while voided and refreshes
standings; a gameweek the entry had no chance to pick for during the void
window still counts as a miss, the same as any other missed gameweek.
Reinstatement is refused once the pot's prize has already been paid out.
Full reasoning: [decisions.md § Late Payment Override](./decisions.md#late-payment-override).

**Winner determination.** The competition concludes once the pot's
designated final gameweek has actually kicked off (passed its deadline).
The winner is decided by, in order: highest cumulative points; if tied,
most exact-scoreline predictions; if still tied, most correct-goalscorer
predictions; if still tied after all of that, every remaining entrant
wins jointly and splits the prize equally. A voided entry can never win,
even briefly; a reinstated entry becomes eligible again immediately, with
no separate step needed. This determination doesn't distinguish a
`two_halves` pot from a `single_cycle` one — both are judged purely on
the same hierarchy across the whole season; whether a `two_halves` pot
should *also* have an earlier, mid-season winner at its halfway point is
a separate, still-undecided question (below).

**Prize awarding.** Once a winner (or tied group) is determined, the net
prize pool — entry fees collected minus any configured admin/charity
deductions, the same shared deduction rules every mode uses — is paid
out: the whole amount to a sole winner, or split equally among a tied
group (any leftover fraction of a cent is never paid to anyone). Every
participating entrant's entry is marked settled at this point, not just
the winner's.

**Not yet decided, deliberately not guessed at:** whether predicting the
same scoreline or the same goalscorer more than once across a season is
restricted in any way (`predictor_cycle_mode`'s "two_halves"/"single_cycle"
setting is confirmed to govern some such restriction, but not which
predictions or how); whether a `two_halves` pot pays out once (season end
only) or twice (also at the half-cycle boundary); whether there's any
restriction on when an entrant may join a
Score Predictor pot.

## Admin permissions

Two distinct admin levels exist:

- **Pot admin** (`pot_members.role = 'admin'`) — scoped to a single pot. Can mark
  entries paid/unpaid, add or remove members of that pot, and update that pot's
  details. The pot's creator is automatically its first admin.
- **App admin** (`app_metadata.role = 'app_admin'` in the user's JWT, set outside the
  application — there's no in-app way to grant this role) — a global admin across
  every pot. Can do everything a pot admin can do, in any pot, plus view the
  cross-pot `sync_runs` audit log that regular users and pot admins cannot see.

Ordinary members can only see and act on their own entries within pots they belong
to; there is no concept of a member managing another member's picks.

Implementation: `is_pot_admin()`/`is_app_admin()` RLS helper functions
([database.md § Row Level Security summary](./database.md#row-level-security-summary)),
re-checked manually inside `admin-actions`
([architecture.md § Security model](./architecture.md#security-model)).
**Caveat:** `/admin` (the page that triggers sync/compute/settle jobs) currently has
no role check at all in the UI — see
[current-state.md ISSUE-9](./current-state.md#issue-9--admin-has-no-ui-level-role-gate).
That page's actions aren't pot-scoped admin actions in the sense described above; they
trigger system-wide jobs, and today any signed-in user can reach them.

## Member invitations

**Membership is immediate — there is no pending/invitation state.**
A person becomes a pot member the instant one of the two paths below
succeeds; there is no intermediate "invited but not yet joined" status, no
concept of resending or withdrawing an invitation, and no accept/decline
step for the invited person. This is a deliberate MVP decision (2026-08-09,
see [decisions.md § Member invitations](./decisions.md#member-invitations)),
not an oversight — a richer invitation workflow (pending state, resend,
accept/decline) is a legitimate future enhancement, but it would be a new
feature layered on top of membership, not a fix to how membership itself
works, and is explicitly out of scope until asked for.

Two ways to become a member, both immediate:

- **Invite code or link.** Every pot can have one shareable invite code
  (generated by an organiser on demand). Anyone who has the code — typed
  in directly, or via a link that carries it — becomes a member the
  moment they redeem it, provided they're signed in. Redeeming a code
  you're already a member of is safely rejected, not a duplicate
  membership.
- **Direct add.** A pot organiser (or app admin) may add anyone with an
  existing account to the pot directly, by username, without that person
  taking any action themselves.

**Removal.** An organiser may remove any member of their pot at any time —
this immediately revokes that person's access to the pot's picks,
standings, and payment records. **A member cannot currently remove
themselves ("leave")** — that capability doesn't exist yet; only an
organiser or app admin can end someone's membership.

## Gameweek lifecycle

A gameweek moves through `upcoming` → `live` → `completed` (or `postponed`, off the
normal path). Exactly one gameweek at a time is marked `is_current` (enforced by a
database constraint, not just convention). A gameweek becomes `completed`, and its
entries `settled`, once **every one of its non-postponed/non-cancelled fixtures has
finished** — a single fixture running late holds the whole gameweek open, even if
every other match has finished.

Implementation: `gameweek_status` enum, `is_current` partial unique index
([database.md § gameweeks](./database.md#gameweeks)); the completion check and
leaderboard-snapshot write happen in `settle-gameweek`
([api.md § settle-gameweek](./api.md#post-functionsv1settle-gameweek)).

## Entry eligibility

To submit an entry for a gameweek, a member must:

- **Already be a member of the pot** the entry belongs to.
- **Pick exactly 5 players** — not fewer, not more (duplicates of the same player are
  allowed and counted separately, per [How scoring works](#how-scoring-works) above).
- **Only pick players who are eligible for that gameweek** — on an active squad
  (`player_team_history.is_active = true`) for a team that has a fixture in that
  gameweek which isn't postponed or cancelled.

**Caveat — goalkeeper eligibility is currently inconsistent, not a settled rule.** One
of the app's two pick-building flows (`PotDetail.jsx`'s inline picker) excludes
goalkeepers; the other (`PicksPage`, the flow driven by `hooks/useEntry.js`) does not.
Neither is more "correct" than the other today — this document can't state a single
rule because the app doesn't enforce one. See
[current-state.md ISSUE-7](./current-state.md#issue-7--two-pick-building-flows-enforce-different-eligibility-rules)
and [roadmap.md § P1 item 7](./roadmap.md#p1--close-the-loop-on-features-that-are-half-built)
for the plan to settle this — once it's decided, update this section with the actual
rule.

Implementation: `available_players_by_gameweek` view
([database.md § available_players_by_gameweek](./database.md#available_players_by_gameweek-view)),
RLS policies on `user_entries`/`user_entry_picks`
([database.md § Row Level Security summary](./database.md#row-level-security-summary)).
