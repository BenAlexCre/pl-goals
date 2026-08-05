# Business Rules

Last reviewed: 2026-08-03.

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

## Payment rules

Every entry starts **unpaid** by default (`entry_payments.is_paid = false`), created
automatically the moment a member submits an entry for a gameweek — payment status is
tracked separately from pick submission, so a member can lock in their picks before
paying. A pot admin (or app admin) marks an entry paid or unpaid; there is currently
no in-app payment processor, so this presumably reflects an off-platform payment
(cash, bank transfer) being recorded, not collected, by the app.

**An entry that is not marked paid by the time scoring runs is automatically voided**
— all of its picks are marked `void` and it's excluded from the leaderboard entirely,
regardless of how well its picks would have scored. There is currently no UI for a pot
admin to actually mark an entry paid (see
[current-state.md ISSUE-6](./current-state.md#issue-6--payments-ui-isnt-wired-up-compute-scores-will-void-every-entry)),
so in practice every entry is being voided right now — this is a rule the system
enforces correctly and consistently, it just currently has no way to be satisfied.

Implementation: `entry_payments` table, `create_entry_payment()` trigger,
`admin-actions`' `mark_paid`/`mark_unpaid` actions
([api.md § admin-actions](./api.md#post-functionsv1admin-actions)), and the
payment check inside `compute-scores`.

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
