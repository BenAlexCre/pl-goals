# Schema Review — Milestone 2 (`004_game_engine_shared_platform.sql`, `005_game_engine_shared_platform_rls.sql`)

Last reviewed: 2026-08-03. This is a self-critical architectural review of the two
not-yet-applied migrations described in [game-engine.md](./game-engine.md) Milestone 2,
performed as requested against a **greenfield production standard** — nothing below was
given a pass for matching the retired prototype or the original Pick 5 schema. Findings are
ranked Critical/High/Medium/Low, per `CLAUDE.md`'s code-review convention. Nothing has been
changed — this is the review; [game-engine.md](./game-engine.md) and the migration files
themselves are updated only after you approve which findings to act on.

See also: [game-engine.md](./game-engine.md) (the specification these migrations implement,
cited by `GE-N`), [database.md](./database.md) (the schema this extends), `002_rls_policies.sql`
/ `engineering-principles.md` (the existing conventions this is measured against).

## Executive summary — recommended before Milestone 2 is called done

| # | Finding | Severity | Object(s) |
|---|---|---|---|
| 1 | `pot_prizes` and `game_entries` cascade-delete on their parent FKs, meaning a deleted gameweek/pot/user silently destroys real-money payout records with no trace | **Critical** | `pot_prizes`, `game_entries` |
| 2 | Three different, inconsistent mechanisms represent the same "gameweek-scoped vs. season-scoped" concept across three tables (`prize_scope` enum vs. nullable `gameweek_id` vs. nullable `gameweek_id`) | **High** | `pot_prizes`, `game_entries`, `entry_payments` |
| 3 | `game_entries.settled` (boolean) duplicates `game_entries.status = 'settled'` (enum) — two independently-writable columns for one fact, can drift out of sync | **High** | `game_entries` |
| 4 | Only `game_type` is protected from post-creation edits; `entry_fee`, `end_gameweek_id`, `predictor_cycle_mode`, `predictor_scorer_scope` can all still be changed by a pot admin after members have joined and paid | **High** | `pots`, `trg_pots_game_type_immutable` |
| 5 | `redeem_invite()` never checks `pots.max_members` or `pots.status` — an invite code can over-fill a capped pot or join an archived one | **Medium** | `redeem_invite()` |
| 6 | Missing `check` constraints allow provably-invalid states (`picks_won > picks_total`, negative money, `eliminated_gameweek_id` set while still `alive`, etc.) | **Medium** | `game_entry_pick5`, `game_entry_lms`, `pots`, `pot_prizes`, `game_entries` |
| 7 | `pot_prizes` has no `updated_at`, inconsistent with every other mutable table in the schema | **Medium** | `pot_prizes` |
| 8 | No index supports the Game Engine's actual query shape for locking/scoring ("every entry for gameweek X across all pots"), only pot-first lookups | **Medium** | `game_entries` |
| 9 | RLS lets a user update *any* column on their own pending `game_entries` row or their own `notifications` row, not just the ones that should be user-editable | **Medium** | `game_entries_update_own_pending`, `notifications_update_own` |

Everything else below is either a smaller/situational finding, a deliberately-considered
and rejected alternative (recorded so it isn't re-litigated later), or an explicit
confirmation that something is sound as designed.

---

## Enums

| Type | Justification | Findings |
|---|---|---|
| `game_type` | Closed, stable, 3-value set matching the product vision exactly (GE-2). Enum is correct over text+check, per `engineering-principles.md`'s SQL conventions. | None. |
| `prize_scope` (`gameweek`/`season`) | Distinguishes Pick 5's weekly jackpot from LMS/Predictor's season pot (GE-4.4). | **Should not exist as its own concept** — see Finding #2. Recommend generalizing to one shared scope enum, reused (not redefined) across every table that needs this distinction. |
| `lms_competitive_status` (`alive`/`eliminated`) | Deliberately renamed away from the prototype's `lms_status` to avoid any lingering coupling to a doomed, differently-owned object, per the greenfield mandate. Two values only, matching the GE-13 decision to represent "winner" as `payout_amount > 0` + `settled`, not a third enum value. | None — this is one of the cleaner pieces of the design; confirmed sound. |
| `predictor_cycle_mode`, `predictor_scorer_scope` | Both configurable per-pot rules (GE-5.3), mirroring each other's shape (two options each). | See Finding #4 (mutability) below. Naming/shape themselves are fine. |

**Future migration risk, informational, no action needed now:** Postgres cannot remove an
enum value once added (only add or rename), so any future need to drop a value from any of
these — e.g. deciding `single_cycle` was a mistake — requires a full type recreation. Low
probability given the product vision explicitly commits to a small, stable rule set; noting
it so it isn't a surprise later, not recommending any change today.

## `pots` (extended)

**Justification:** the one row-per-competition config table, correctly kept singular rather
than split into per-mode settings tables — see the considered-and-rejected alternative below.

**Findings:**

- **`game_type not null default 'pick5'`** (Medium, new — not in the executive summary table
  above because it's a smaller version of the same mutability theme): a default on an
  immutable, identity-defining column is a footgun. If pot-creation code ever forgets to
  pass `game_type` explicitly — a stale code path, a copy-pasted insert — it silently
  produces a Pick 5 pot instead of failing loudly. Recommend dropping the default entirely
  (`not null`, no default), forcing every creation path to choose explicitly.
- **Finding #4 (High):** `trg_pots_game_type_immutable` only protects `game_type`. Once a
  pot has any entries or payments, changing `entry_fee` (fairness — people already paid a
  specific amount), `end_gameweek_id` (LMS eliminations already happened under a different
  end-date assumption), `predictor_cycle_mode`, or `predictor_scorer_scope` (retroactively
  changes the picking rules mid-competition) is a real integrity problem, not just a
  `game_type`-specific one. Recommend broadening the trigger to block changes to this whole
  "competition contract" column set — but only *once the pot has at least one `game_entries`
  row* (or at least one payment), so an admin can still fix a typo before anyone's joined.
  This is a better rule than blanket-immutable-from-creation: it protects real commitments
  without blocking legitimate pre-launch corrections.
- **Missing constraint (Medium):** `entry_fee` has no `check (entry_fee >= 0)`. A negative
  fee would corrupt every downstream `pot_prizes.total_amount = entry_fee × count` calc.
- **`predictor_cycle_mode`/`predictor_scorer_scope` nullable (Low):** both have sensible
  defaults but aren't `not null`. Costs nothing to tighten — makes "unset" and "using the
  default" the same state instead of two states application code has to handle identically
  anyway.
- **Missing cross-table integrity (Low, informational):** nothing ties `end_gameweek_id`'s
  season/league back to `pots.season_id`/`league_id` — a pot could reference a gameweek from
  an unrelated season. Not enforceable with a plain `check` (single-table only); would need
  a trigger. Flagging as a known gap, not fixing in this milestone — low real-world
  likelihood given `end_gameweek_id` is admin-set, not user-facing.

**Considered and rejected: splitting `predictor_cycle_mode`/`predictor_scorer_scope` into a
`pot_settings_predictor` side table**, mirroring the `game_entry_*` thin-table pattern. The
`game_entries` split earned its keep because that table has *many* rows per pot (one per
member) and would otherwise carry a lot of always-null columns at scale. `pots` has exactly
one row per pot; two nullable enum columns there cost nothing and a separate 1:1 table for
them would be complexity without a matching benefit. Kept on `pots` deliberately — this is a
judgment call worth recording so it isn't silently revisited later without the reasoning
that produced it.

## `entry_payments` (generalized)

**Justification:** reuses one payment table across gameweek-scoped and season-scoped modes
instead of building a second table for the same underlying fact ("has this person paid").

**Findings:**

- **Finding #2 (High, shared with `pot_prizes`/`game_entries`):** the nullable-`gameweek_id`
  pattern here is the same underlying "which scope does this row belong to" question
  `pot_prizes` answers with an explicit `scope` enum instead. Recommend the same fix here:
  introduce one shared scope enum (see Finding #2's resolution below) and use it
  consistently, rather than three different conventions for the same concept across three
  tables.
- **No direct FK to `game_entries` (Low, informational):** payment rows and entry rows are
  correlated only by matching `(pot_id, user_id, gameweek_id)` tuples, never by a real
  foreign key to a specific `game_entries.id`. This was already true of the original
  `entry_payments`/`user_entries` relationship, so it isn't a regression — but a direct FK
  would be strictly more robust (no possibility of the tuple match silently pointing at
  nothing). Not recommending the change now: it would touch the existing,
  currently-working `create_entry_payment()` trigger and its RLS policies for a
  normalization improvement with no known live bug behind it. Worth a future ticket, not a
  Milestone 2 blocker.

## `pot_prizes`

**Justification:** correctly unifies Pick 5's weekly jackpot and LMS/Predictor's season pot
into one table with a scope discriminator — the single best structural call in this
migration (see [game-engine.md § GE-13](./game-engine.md#ge-13-rationale-index) for why this
was chosen over three separate money-pot mechanisms).

**Findings:**

- **Finding #1 (Critical):** `gameweek_id` and `pot_id` both `references ... on delete
  cascade`. This table exists specifically to record real money. If a gameweek row is ever
  deleted (a bad sync cleanup, an admin action, a future data-fix script), its `pot_prizes`
  row — including `total_amount` and `is_settled` — disappears with it, silently, with
  nothing in `sync_runs` or any audit trail to show it happened. Recommend `on delete
  restrict` (block the delete instead of cascading) for both FKs on this table. If a
  gameweek or pot genuinely needs to go away, that should be a deliberate, visible action
  that fails loudly if money is attached, not a side effect.
- **Finding #7 (Medium):** no `updated_at`/trigger, despite `total_amount`, `is_settled`,
  and `settled_at` all being expected to change after row creation — every other mutable
  table in the schema (including the original migration's) has this. Recommend adding
  `updated_at timestamptz not null default now()` + reusing `set_updated_at()`.
- **Missing constraint (Medium):** no `check (total_amount >= 0)`.
- **Confirmed sound:** the two partial unique indexes correctly enforce "one row per
  gameweek pot" and "one row per season pot" in a way that's consistent with the `check`
  constraint tying `scope` to `gameweek_id`'s nullability — no gap between the constraint
  and the indexes.

## `game_entries`

**Justification:** the core reuse decision from [game-engine.md § GE-4.5](./game-engine.md#ge-45-game_entries-the-shared-parent) — one entries concept for all three modes. Structurally sound; the specific issues below are about column-level discipline, not the overall shape.

**Findings:**

- **Finding #1 (Critical, shared with `pot_prizes`):** same cascade-on-money problem —
  `pot_id`/`user_id`/`gameweek_id` all cascade, and `payout_amount` lives on this table.
  Deleting a `profiles` row (account deletion) or a `gameweeks` row would silently destroy
  payout history. Recommend `on delete restrict` for all three FKs, or at minimum for the
  case where `payout_amount > 0` — a straight `restrict` is simpler and safer than a
  conditional rule.
- **Finding #2 (High):** `gameweek_id` nullable is being used to mean two different things
  depending on which mode's pot it belongs to (a recurring weekly entry vs. a single
  season-long entry) — an implicit convention a schema reader has to already know, and
  nothing stops a bug from inserting a stray `gameweek_id` into what should be a
  season-scoped LMS/Predictor entry, or vice versa. Recommend adding an explicit
  `entry_scope` column (reusing the same shared scope enum proposed for `pot_prizes`), so
  the scope is a checkable fact rather than an inference from nullability. Cheapest to do
  now, before Milestone 4 puts real rows in this table.
- **Finding #3 (High):** `settled boolean` duplicates `status = 'settled'`. Two
  independently-writable columns for one fact means they can disagree (`status='settled'`
  with `settled=false`, or the reverse) with nothing catching it. Recommend dropping the
  `settled` column entirely — `status` already carries this, and `settled_at` alone (set
  when `status` transitions to `'settled'`) is enough to know *when*.
- **Missing constraint (Medium):** no `check (payout_amount >= 0)`.
- **Finding #8 (Medium):** every index has `pot_id` or `user_id` as the leading column.
  The Game Engine's own documented lifecycle ([GE-8.2](./game-engine.md#ge-82-locking-flow),
  [GE-8.3](./game-engine.md#ge-83-scoring-flow)) runs per-*gameweek*, across every pot at
  once ("lock every due entry for gameweek X"), not per-pot. There is currently no index
  with `gameweek_id` as a usable leading column for that access pattern — the partial
  unique index that includes `gameweek_id` has `pot_id` first, which doesn't help a
  gameweek-first scan. Recommend `create index idx_game_entries_gameweek_status on
  game_entries (gameweek_id, status) where gameweek_id is not null;`.
- **Finding #9 (Medium):** `game_entries_update_own_pending` (mirroring the existing,
  already-live `user_entries_update_own_pending` faithfully) has no column-level
  restriction — a user could, in principle, `UPDATE` their own pending row and set
  `payout_amount` in the same statement as whatever legitimate field they meant to change.
  Recommend a column-level `revoke update (payout_amount, settled_at) from authenticated;`
  (and, once Finding #3 removes `settled`, that's one fewer column to protect) alongside the
  existing row-level policy — belt-and-braces, cheap, standard Postgres.

## `game_entry_pick5` / `game_entry_lms` / `game_entry_predictor`

**Justification:** thin, single-purpose extension tables — each one is small enough to
audit in full at a glance, matching the same standard `engineering-principles.md` already
holds `security definer` functions to.

**Findings (Finding #6, Medium, applies across all three):**

- `game_entry_pick5`: no `check (picks_won >= 0 and picks_won <= picks_total)` — nothing
  stops a scoring bug from writing `picks_won = 7`.
- `game_entry_lms`: no `check (current_cycle >= 1)`; and no consistency check tying
  `competitive_status` to `eliminated_gameweek_id` — an entry could be `'eliminated'` with a
  null `eliminated_gameweek_id`, or `'alive'` with a stray one set. Recommend `check
  ((competitive_status = 'eliminated') = (eliminated_gameweek_id is not null))`.
- `game_entry_predictor`: no `check (total_points >= 0 and exact_score_count >= 0 and
  correct_scorer_count >= 0)`.

**Confirmed sound:** no extra indexes needed beyond the primary key — every access to these
tables is a 1:1 lookup by `game_entry_id`, which the PK already serves.

## `pot_standings_snapshots`

**Justification:** replaces three modes' worth of bespoke leaderboard logic with one table,
directly resolving `ISSUE-15` (Pick 5's overall leaderboard was never populated) as a side
effect rather than a separate fix.

**Findings:**

- **Genuine design tension, not a defect (informational):** forcing every mode's standing
  into one numeric `score` column is a slightly imperfect fit for LMS, which doesn't have a
  natural single score — "still alive" is closer to boolean than numeric. Workable (a
  synthetic value, e.g. gameweeks-survived, or `1`/`0` for alive/eliminated), but worth
  naming honestly as a compromise rather than presenting the unification as a perfect
  fit for all three modes.
- **Missing constraint (Low):** no `check (rank >= 1)`.
- **Confirmed sound:** `meta jsonb` is correctly scoped per
  [GE-4.6](./game-engine.md#ge-46-pot_standings_snapshots)'s own stated rule — display-only,
  never queried or joined on. This is the one place in the whole migration where jsonb is
  used, and it's used for exactly the case the platform's stated JSON policy allows.
- **Performance, no action needed now:** a leaderboard query (`where pot_id = X and
  gameweek_id = Y order by rank`) isn't covered by an index for the `order by`, only the
  filter. At current and expected scale (small private pots, a handful of members) this is
  irrelevant — sorting a dozen rows costs nothing. Flagging so it isn't forgotten if a pot
  ever gets large, not recommending a change now (would be premature optimization against
  `CLAUDE.md`'s own guidance).

## `notifications`

**Justification:** establishes the seam every Game Engine's `notifyUsers()` needs, without
committing to a delivery mechanism prematurely (per [GE-15](./game-engine.md#ge-15-explicitly-deferred--not-carried-forward)).

**Findings:**

- **Missing index (Medium, folded into Finding #6's spirit but distinct):** the single most
  frequent query against this table will be "how many unread notifications does this user
  have" (an unread-count badge, checked on essentially every page load). `idx_notifications_user`
  alone means that query scans every notification a user has ever received. Recommend
  `create index idx_notifications_unread on notifications (user_id) where read_at is
  null;` — cheap, directly targets the actual access pattern.
- **Finding #9 (Medium, same pattern as `game_entries`):** `notifications_update_own` has no
  column restriction — a user can rewrite `type`/`payload`/`pot_id` on their own
  notification, not just mark it read. Low real risk (it's their own row, only they ever
  see it), but still an unintended edit surface. Recommend `revoke update (type, payload,
  pot_id, user_id, created_at) from authenticated; grant update (read_at) to authenticated;`
  — the row-level policy stays, this just narrows what "update" is allowed to mean.
- **Confirmed sound, explicit no-action items:**
  - No `updated_at`/trigger needed — `read_at` is the only column this table ever mutates,
    and it already records exactly that transition; a generic `updated_at` would be
    redundant.
  - `type text`, free-text rather than an enum, is the right call — notification types are
    expected to grow as features ship, matching the same deliberate-open-value-space
    reasoning `database.md` already documents for `fixture_events.event_type`.
  - No cascade-delete concern here (unlike `pot_prizes`/`game_entries`) — a notification
    about a deleted pot or user has no reason to survive, and no money is attached to this
    table.

## `redeem_invite()`

**Justification:** the missing half of `ISSUE-8` — the column existed, nothing redeemed it.

**Findings:**

- **Finding #5 (Medium):** never checks `pots.max_members` (a capped pot can be over-filled)
  or `pots.status` (an archived/draft pot can still be joined). Both are real, existing
  columns this function should be consulting and currently ignores entirely. Recommend
  adding both checks before the `insert`.
- **Minor (Low):** the explicit "already a member" check and the actual `insert` aren't in
  the same atomic operation, so a genuine race (two simultaneous redemption calls) would
  have the *second* one fail on the underlying `pot_members` unique-constraint violation
  rather than the friendlier explicit exception — a raw constraint-violation error reaching
  the client instead of a clean message. Not a correctness bug (the unique constraint
  already prevents the duplicate row either way), just a rough edge on the error message.
  Worth a `begin/exception when unique_violation` wrapper when this function is next
  touched; not blocking.
- **Confirmed sound:** `security definer` with `search_path` pinned, matching the existing
  `get_or_create_entry`/`save_entry_picks` pattern exactly. `EXECUTE` correctly scoped to
  `authenticated` only (not `anon`, not left at the Postgres default of `public`) —
  consistent with the Phase 1 security remediation already applied elsewhere.

## RLS (005) — cross-cutting check

Run against the same checklist the `/rls` command uses:

- **Circular/recursive policy risk: none found.** `game_entry_pick5`/`lms`/`predictor`'s
  policies query `game_entries`, and `game_entries`'s own policy calls `is_pot_member`
  directly rather than querying back into any of the three child tables — one-directional,
  no recursion.
- **`using (true)` where inappropriate: none found** — nothing in `005` uses an unscoped
  `true` qualifier; every policy is gated on `is_pot_member`/`auth.uid()`.
- **Missing `with check` on insert: none found** — both insert policies (`game_entries`,
  implicitly `redeem_invite` via its own internal checks) specify one.
- **The two genuine weaknesses are Finding #9** (column-scope on the two `update` policies),
  already covered above — not repeating here.

## Recommended change set (for approval, not yet applied)

In priority order, matching the executive summary:

1. Change `pot_prizes`/`game_entries`'s FKs from `on delete cascade` to `on delete restrict`.
2. Introduce one shared scope enum (e.g. `pot_scope: 'gameweek' | 'season'`), replacing
   `prize_scope` and adding an explicit `entry_scope` column to `game_entries` (and
   optionally a `scope` column to `entry_payments`, for full consistency) instead of relying
   on `gameweek_id`'s nullability alone.
3. Drop `game_entries.settled`; keep `status` + `settled_at` only.
4. Broaden `trg_pots_game_type_immutable` (rename it to reflect its wider scope) to also
   lock `entry_fee`, `end_gameweek_id`, `predictor_cycle_mode`, `predictor_scorer_scope`
   once the pot has at least one `game_entries` row.
5. Add the `max_members`/`status` checks to `redeem_invite()`.
6. Add the missing `check` constraints listed under each table above.
7. Add `pot_prizes.updated_at` + trigger.
8. Add `idx_game_entries_gameweek_status` and `idx_notifications_unread`. **`idx_game_entries_gameweek_status`
   applied 2026-08-04** (`009_game_entries_gameweek_status_index.sql`, Milestone 4 Slice 3) once
   `Pick5Engine.lockEntries()` became the first real consumer of exactly this query shape.
   `idx_notifications_unread` remains unapplied — still nothing reads `notifications` by read
   status yet.
9. Column-level `revoke`/`grant` narrowing on `game_entries_update_own_pending` and
   `notifications_update_own`.
10. Remove the default from `pots.game_type`.

Everything under "Considered and rejected" or "Confirmed sound" above is a deliberate
no-change decision, recorded so it isn't silently revisited without the reasoning that
produced it.

Waiting for your approval on which of the above to apply before I touch `004`/`005`.
