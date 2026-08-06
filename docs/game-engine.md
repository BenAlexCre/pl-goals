# Game Engine — Architectural Specification

Last reviewed: 2026-08-05. Status: **authoritative.** This document is now the blueprint
every migration, Edge Function, frontend page, RLS policy, and test is measured against.
Milestone 1 (this specification) and Milestone 2 (shared schema) are complete and have
passed a full architectural review — see [schema-review.md](./schema-review.md) for the
review itself and `session-log.md` for what was applied versus deliberately deferred.
Milestone 3 (the Game Engine framework — folder structure, interfaces, dispatcher, shared
types, dependency injection) is complete. Milestone 4 (Pick 5) is in progress: Slice 1
(entry creation), Slice 2 (pick submission), Slice 3 (locking, wired into
`compute-deadlines`), Slice 4 (scoring, wired into `compute-scores`), Slice 5
(settlement — including the payment-verification-void rule, wired into
`settle-gameweek`), Slice 6 (standings, resolving `ISSUE-15`/`ISSUE-17`, called
internally from `settle()` per GE-8.4), Slice 7 (`determineWinner()`, implemented
standalone), Slice 8 (`awardPrize()`, gross/net prize pool deductions, wired into
`settle()` alongside `determineWinner()` — see GE-9), and Slice 9 (`notifyUsers()`,
domain-event notifications, wired into `awardPrize()`) are done — all eight
`GameEngine` contract methods are now implemented for Pick 5. **Milestone 4 is now
complete end-to-end, including the frontend**: as of 2026-08-05's frontend cutover,
`PicksPage.jsx`/`PotDetail.jsx`/`GameweekPage.jsx` all read/write `game_entries`/
`pick5_picks`/`pot_standings_snapshots` via `get-or-create-pick5-entry`/
`submit-pick5-picks`, not the retired `user_entries`/`user_entry_picks`/
`leaderboard_snapshots` — verified live through the real UI, not just the Edge
Functions directly. See [GE-12](#ge-12-milestone-plan) for exact status per
milestone.

It supersedes the undocumented, `supabase_admin`-owned LMS/Predictor prototype objects
described in [current-state.md](./current-state.md) — those objects communicated *business
intent*, which this document captures and formalizes; their *implementation* was not carried
forward (see [GE-15](#ge-15-explicitly-deferred--not-carried-forward)).

**Every `GE-N`-cited anchor is a stable, permanent reference** — never renumbered, never
reused, same rule as `ISSUE-N` in `current-state.md`. Cite it in commit messages, migration
headers, Edge Function doc-comments, and test descriptions. See
[GE-14](#ge-14-traceability-convention).

See also: [architecture.md](./architecture.md) (the current, live system this extends),
[database.md](./database.md) (schema reference — pending an update to describe the Game
Engine tables directly, tracked for Milestone 4), [schema-review.md](./schema-review.md)
(the Milestone 2 review and its outcomes, cited throughout this revision),
[business-rules.md](./business-rules.md), [decisions.md](./decisions.md).

---

## GE-0. Purpose and status

A specification, not a status report. What's "confirmed working" lives in
[current-state.md](./current-state.md); what's *intended* lives here. Drift between this
document and reality is tracked the normal way: `/drift` before every release, `ISSUE-N`
entries for anything that ships differently than specified, and an update to this document
itself if the specification was simply wrong.

## GE-1. Product vision

Three game modes launch together, all production-quality, none an "extra":

| Mode | One-line rule |
|---|---|
| **Pick 5** | Pick 5 players before the gameweek deadline; a pick wins if the player's goals meet the pick's threshold. |
| **Last Man Standing** | Pick one team to win each gameweek; a loss or draw eliminates you; a team may never be picked twice across the whole competition (no cycles — decided 2026-08-05, see [GE-5.2](#ge-52-last-man-standing)); last survivor(s) split the pot. |
| **Score Predictor** | Predict one fixture per gameweek — exact score, winner, goalscorer; cumulative points across the season; top scorer(s) split the pot at season end. |

## GE-2. Pot model

- Every pot has exactly one `game_type` (`pick5` | `last_man_standing` | `score_predictor`),
  set at creation and immutable thereafter — enforced by `trg_pots_contract_immutable`
  (`004_game_engine_shared_platform.sql`), not just convention.
- No hybrid pots, ever — structurally impossible, not merely disallowed by policy: every
  `game_entries` row belongs to exactly one `pot_id`, and a pot has exactly one `game_type`.
- **As of the Milestone 2 review, immutability extends beyond `game_type` alone.**
  `entry_fee`, `end_gameweek_id`, `predictor_cycle_mode`, and `predictor_scorer_scope` are
  also locked — but only once the pot has at least one `game_entries` row, so a genuine
  pre-launch admin correction is still possible. See
  [schema-review.md #4](./schema-review.md#pots-extended) for the reasoning: these are all
  terms of the competition's "contract," and changing any of them after money/picks are
  committed is a fairness problem, not just a `game_type`-specific one.

## GE-3. Platform vs. game-mode boundary

| Shared (one implementation, every mode) | Mode-specific (one implementation per mode) |
|---|---|
| Auth, users, profiles | Pick selection UI and validation rules |
| Pots, pot members, invitations | Scoring calculation |
| Payment Verification | Elimination/points/standing computation |
| Fixtures, teams, players, live data sync | Win-condition and payout-split logic |
| Notifications | — |
| Admin tooling | — |
| Leaderboard/standings infrastructure | — |
| Cron scheduling, Edge Function framework | — |
| RLS helper functions and pattern | — |

If a change to LMS ever requires touching `pots`, `pot_members`, `entry_payments`, or the
auth/RLS helpers, that's a signal this boundary has been violated, not a normal occurrence.

## GE-4. Shared entities

Reflects the schema as it exists after the Milestone 2 architectural review — see
[schema-review.md](./schema-review.md) for the full before/after reasoning on every point
below marked "post-review."

### GE-4.1 `pots` (extended)

`game_type`, `entry_fee` (`check >= 0`), `end_gameweek_id`, `predictor_cycle_mode`,
`predictor_scorer_scope` — all `not null`. Protected by `trg_pots_contract_immutable`
(broadened post-review from a `game_type`-only trigger — see [GE-2](#ge-2-pot-model)).

**Decided 2026-08-05, applied** (`010_prize_pool_deductions.sql`, applied ahead of
Milestone 4 Slice 8) — two independent, optional prize-pool deductions:
`admin_fee_type`/`admin_fee_amount`/`admin_fee_percentage` and
`charity_fee_type`/`charity_fee_amount`/`charity_fee_percentage` (shared `fee_type`
enum: `none`/`fixed`/`percentage`, never both an amount and a percentage at once —
enforced by CHECK, not convention). Configuration only, shared across every mode per
GE-3 — the calculated per-instance outcome lives on `pot_prizes` (GE-4.4). Joins
`entry_fee` in `trg_pots_contract_immutable`'s guarded set once the pot has entries.
Full reasoning: [decisions.md § Prize pool deductions](./decisions.md#prize-pool-deductions-admin-fee-and-charity-fee).

**Applied 2026-08-05** (`013_lms_wipeout_and_rollover.sql`, ahead of
Milestone 5 Slice 2; supersedes an earlier same-purpose draft whose
payment-model assumption was overturned — see
[decisions.md § LMS: Wipeout Resolution, automatic rollover, and a fixed per-competition entry fee](./decisions.md#lms-wipeout-resolution-automatic-rollover-and-a-fixed-per-competition-entry-fee)
and [decisions.md § LMS: multi-generation rollover review](./decisions.md#lms-multi-generation-rollover-review-found-a-real-gap-added-rollover_generation))
— five LMS-specific additions: `wipeout_resolution` (`lms_wipeout_resolution`:
`split_prize` | `roll_prize`, required for LMS pots, applies only when every
remaining player is eliminated in the same gameweek), `season_end_tie_rule`
(`lms_season_end_tie_rule`: `split_prize` | `final_prediction`, independent
of `wipeout_resolution` — applies when multiple players are still alive at
the season's actual final gameweek), `start_gameweek_id` (the gameweek this
competition's picks begin — the explicit, never-inferred-from-dates basis
for a normal pot's one-time entry-window cutoff, or an organiser's explicit
choice for a rollover pot's draft phase), and `rollover_source_pot_id` +
`carry_over_amount` + `rollover_generation` (set only by the Game Engine
itself, automatically, when a wipeout resolves as `roll_prize` — never by an
organiser; unconditionally immutable, like `game_type`, rather than only
"once the pot has entries"; also excluded entirely from `authenticated`'s
`pots` INSERT column privileges, so a client-authored pot-creation request
can never set them regardless of RLS — see the multi-generation review for
why this was necessary, not just defensive).

### GE-4.2 `pot_members`

Unchanged — fully mode-agnostic.

### GE-4.3 `entry_payments` (generalized) — Payment Verification, not payment processing

**Canonical design, decided 2026-08-05** — see
[decisions.md § Payment Verification, not payment processing](./decisions.md#payment-verification-not-payment-processing).
This table (and every mode's settlement logic that reads it) records **whether an
admin has verified an entry as paid**, off-platform — never a payment the application
collected. No mode's `settle()` may ever depend on a payment gateway, Stripe/PayPal/
Revolut API, or any external payment status; `entry_payments.is_paid` is the only
signal, and the application controls it entirely (manual single-entry admin action,
or bulk CSV import — see
[business-rules.md § Payment verification rules](./business-rules.md#payment-verification-rules)
for the CSV format and requirements; not yet implemented, tracked as `ISSUE-6`).

`gameweek_id` nullable, paired **(post-review)** with an explicit `scope pot_scope not
null` column and a check constraint tying the two together, rather than relying on
nullability alone to signal which payment-verification shape a row represents.
Non-null `gameweek_id` + `scope = 'gameweek'` keeps today's Pick 5 behavior exactly
as-is; `gameweek_id null` + `scope = 'season'` is a single whole-pot verification for
LMS/Predictor.

**Confirmed, decided 2026-08-05** — the LMS payment model is one flat entry
fee per competition, never a recurring weekly charge (see
[decisions.md § LMS: Wipeout Resolution, automatic rollover, and a fixed per-competition entry fee](./decisions.md#lms-wipeout-resolution-automatic-rollover-and-a-fixed-per-competition-entry-fee)
for the full reasoning, including a same-session design that briefly assumed
otherwise and was corrected before it was ever applied or shipped). `scope =
'season'` — one `entry_payments` row per `(pot_id, user_id)`, exactly as this
paragraph originally specified — is therefore the correct, final shape for
LMS. **No Payment Verification code changes of any kind are needed for
LMS** — `admin-actions`, `AdminPayments.jsx`, and `bulkPayments.ts` already
handle `scope = 'season'` rows (this is the same mechanism a future
Predictor payment model would also use, per GE-5.3, though that's still
undecided).

### GE-4.4 `pot_prizes`

Replaces the retired prototype's `gameweek_pots` (which turned out to be Pick 5's own
unbuilt weekly-jackpot feature, not an LMS/Predictor concern). `scope pot_scope`
discriminates a per-gameweek jackpot (Pick 5) from a season-long pot (LMS, Predictor).
**Post-review:** both FKs (`pot_id`, `gameweek_id`) are `on delete restrict`, not `cascade`
— a row holding real money must never be silently deletable as a side effect of deleting
something else. Has `updated_at`/trigger, matching every other mutable table in the schema
(a gap in the original draft).

**Row lifecycle, decided 2026-08-05** (design investigation ahead of Milestone 4
Slice 8) — see
[decisions.md § pot_prizes row creation is lazy, inside awardPrize()](./decisions.md#pot_prizes-row-creation-is-lazy-inside-awardprize--never-pre-created)
for the full comparison of alternatives considered. A row is created **lazily,
inside `awardPrize()`**, at the moment a mode's engine decides a specific
competition instance (a gameweek, for Pick 5) has concluded — never pre-created at
pot creation, gameweek open, first entry, or first payment verification, since
`gross_amount` can only be authoritative once verification and settlement have
finished for that instance. No schema/RLS change needed for this — `awardPrize()`
writes via the service-role client like every other Game Engine method, matching
the existing zero-client-write-policy pattern on this table. Confirmed live: no
migration was required *for the lifecycle itself*.

**Gross/net prize pool, decided 2026-08-05, applied** (`010_prize_pool_deductions.sql`)
— see
[decisions.md § Prize pool deductions](./decisions.md#prize-pool-deductions-admin-fee-and-charity-fee).
`total_amount` renamed to **`gross_amount`** (zero live rows existed, confirmed
before drafting the rename). Two new columns, `admin_fee_amount`/`charity_fee_amount`,
record the *calculated* euro amount actually deducted for this instance — never the
pot's configuration (GE-4.1), which can in principle differ across instances. A
generated `net_amount` column (`gross_amount − admin_fee_amount − charity_fee_amount`,
`check >= 0`) is the only amount the Game Engine ever distributes — `awardPrize()`
must never split `gross_amount`. `Pick5Engine.awardPrize()` implements this as of
Slice 8.

**Applied 2026-08-05** (`013_lms_wipeout_and_rollover.sql`)
— a `rollover boolean not null default false` column. True only for a settled
LMS `pot_prizes` row where `pots.wipeout_resolution = roll_prize` produced no
winner (every remaining player eliminated in the same gameweek); `net_amount`
on that row is the amount the Game Engine copies onto a new pot's
`carry_over_amount`, **creating that new pot automatically** — no organiser
action creates or links it (a reversal from an earlier same-session draft,
which had this manual — see
[decisions.md § LMS: Wipeout Resolution, automatic rollover, and a fixed per-competition entry fee](./decisions.md#lms-wipeout-resolution-automatic-rollover-and-a-fixed-per-competition-entry-fee)).
Explicit, not inferred from "no `game_entries` row in this pot has
`payout_amount > 0`" — same GE-13 reasoning already applied to
`pot_scope`/`entry_scope`. False for every ordinary settled row.

### GE-4.5 `game_entries` — the shared parent

`id`, `pot_id`, `user_id`, `gameweek_id` (nullable), `entry_scope pot_scope not null`
**(post-review — same reasoning as GE-4.3: an explicit column, not an inference from
nullability)**, `status` (`entry_status`, the single source of truth for administrative
lifecycle including settlement), `payout_amount` (`check >= 0`), `settled_at`,
`created_at`, `updated_at`.

**Post-review:** the original draft also had a separate `settled boolean` column — removed.
It duplicated `status = 'settled'` with no independent meaning, and two independently
writable columns for one fact is a drift risk once real settlement code writes to them
(Milestones 4–6). `status` + `settled_at` is sufficient: `status` for "is this resolved,"
`settled_at` for "when."

**Post-review:** `pot_id`/`user_id`/`gameweek_id` FKs are `on delete restrict`, not
`cascade` — this table carries `payout_amount`.

Three thin extension tables, 1:1 via `game_entry_id`:

```
game_entries
  ├── game_entry_pick5      (game_entry_id, picks_won, picks_total)
  ├── game_entry_lms        (game_entry_id, competitive_status, eliminated_gameweek_id)
  └── game_entry_predictor  (game_entry_id, total_points, exact_score_count, correct_scorer_count)
```

**`game_entry_lms.current_cycle` removed, 2026-08-05** (`014_lms_remove_cycle.sql`)
— planned-but-never-implemented scaffolding for an LMS cycle mode the product
never actually got; nothing read or wrote it. See
[decisions.md § LMS: no cycles](./decisions.md#lms-no-cycles-current_cycle-removed-slice-2-implemented)
for the full removal (also drops the corresponding `lms_tiebreak_picks`-adjacent
cycle language from GE-1's vision table, above).

**Milestone 4, Slice 2** added `pick5_picks` (`007_pick5_picks.sql`): one row per
`(game_entry_id, pick_position)`, `player_id`, `goal_threshold`/`goals_scored`/`result`
— mirrors the retired prototype's `user_entry_picks` shape exactly (that part of the
prototype was correct; see [GE-15](#ge-15-explicitly-deferred--not-carried-forward)).
Unlike `game_entries` (which has client-reachable `insert`/`update` policies, even if
the current Edge Function doesn't use them), `pick5_picks` has **no client-insert
policy at all**, same as `game_entry_pick5` — every write goes through
`submit-pick5-picks`, which calls `Pick5Engine.validateEntry()` first. See
[GE-8.1](#ge-81-submission-flow)'s revised text for why.

**Milestone 5, Slice 2** added `lms_team_picks` (`015_lms_picks.sql`, applied
2026-08-05): one row per `(game_entry_id, gameweek_id)`, `team_id`, `result`
(reuses the existing `pick_result` enum rather than inventing a parallel
one). **Named `lms_team_picks`, not the more obvious `lms_picks`** — that
name collides with the retired prototype's own `supabase_admin`-owned
`lms_picks` table (`ISSUE-20`'s "isolate, don't delete yet" list), confirmed
live the moment this migration was first attempted, not theoretical. Same
`unique (game_entry_id, team_id)` constraint (no gameweek/cycle scoping at
all) enforces "no cycles, a team is used at most once, ever" at the database
level, not just in `LmsEngine.validateEntry()`. No client-insert policy,
same reasoning as `pick5_picks`.

Each carries a `check` constraint guarding against a provably-invalid state discovered
during the review (`picks_won <= picks_total`; `competitive_status =
'eliminated'` iff `eliminated_gameweek_id is not null`; every count `>= 0`).

### GE-4.6 `pot_standings_snapshots`

Replaces the Pick-5-only `leaderboard_snapshots`, resolving `ISSUE-15` (an overall
leaderboard was never populated) as a side effect. `meta jsonb` is deliberately restricted
to display-only metadata, never queried or joined on — see
[GE-20](#ge-20-architectural-invariants) for the platform-wide JSON policy this is the one
sanctioned instance of.

**Milestone 4 Slice 6**: `Pick5Engine.generateStandings()` is the first real writer of
this table, resolving `ISSUE-15` in practice (not just structurally) — it writes both a
per-gameweek row and a `gameweek_id: null` overall row per user, upserted (idempotent) on
every `settle()` call. Ranking uses standard competition ranking with ties sharing a rank
and no further tiebreak, resolving `ISSUE-17` — confirmed with the repo owner rather than
inferred, since real money is involved. **Implementation note**: this table's two unique
indexes are both partial (`WHERE gameweek_id IS NOT NULL` / `WHERE gameweek_id IS NULL`),
which PostgREST's `upsert(onConflict: ...)` cannot target directly — confirmed live
("no unique or exclusion constraint matching the ON CONFLICT specification"). Worked
around in `Pick5Engine` by looking up existing rows by their natural key first, then
upserting only by `id` (the real, non-partial primary key). Any future mode writing to
this table needs the same pattern, not a direct `upsert(onConflict: 'pot_id,gameweek_id,user_id')`.

### GE-4.7 Invitations

`pots.invite_code` (existing) + `redeem_invite(invite_code)`, a `security definer` RPC that
creates the `pot_members` row. Deliberately **does not yet** enforce `pots.max_members` or
`pots.status` — a real gap identified in the review, deferred on purpose to Milestone 7
(when this function gets an actual UI caller) rather than fixed blind now. See
[GE-15](#ge-15-explicitly-deferred--not-carried-forward).

### GE-4.8 Notifications

`notifications` table (`user_id`, `pot_id` nullable, `type`, `payload` jsonb — display
metadata only, `read_at`, `created_at`), written to by every Game Engine implementation's
`notifyUsers()`. Delivery beyond in-app (email/push) is out of scope for this specification.
**`Pick5Engine.notifyUsers()` implemented as of Milestone 4 Slice 9** — see
[decisions.md § Notifications: domain events, not delivery](./decisions.md#notifications-domain-events-not-delivery)
for the full design (why it's a pure event emitter, why a notification failure never
affects settlement, why delivery is deliberately deferred). One event type exists today:
`pick5.prize_awarded`, fired from within `awardPrize()`.

### GE-4.9 RLS helper functions

Unchanged: `is_pot_member(pot_id)`, `is_pot_admin(pot_id)`, `is_app_admin()`. Every table
above reuses these — no new authorization primitive anywhere in this design.

## GE-5. Game-mode-specific entities

### GE-5.1 Pick 5

Rules unchanged (canonical in `business-rules.md`). Re-platforms onto `game_entries`
(gameweek-scoped) + `game_entry_pick5` + `pick5_picks` (Milestone 4). Gains, as part of that
work, its own previously-undocumented business model pieces surfaced by this whole exercise:
the weekly jackpot via `pot_prizes`, and a real tie-break rule (`ISSUE-17`).

### GE-5.2 Last Man Standing

`game_entry_lms.competitive_status` is **two values only** — `alive` | `eliminated`. A
winner is represented as "still `alive`, `payout_amount > 0`, `status = 'settled'`" on the
parent `game_entries` row — no third status value, deliberately (the retired prototype's
actual bug was trying to set a `'winner'` value that was never added to its enum; this
design doesn't need that state to exist at all).

**No cycles, decided 2026-08-05 — `current_cycle` removed.** An LMS
competition is one continuous sequence from its opening gameweek until it
ends; a team may never be picked twice within that competition, full stop —
no resets, no half-season cycles, no configurable cycle mode. A rollover is
a **new competition** (a new pot, [GE-5.2](#ge-52-last-man-standing) below),
so every player's available-team pool resets naturally as a side effect of
being a different pot with different entries, not because any cycle
mechanism reset it. `game_entry_lms.current_cycle` was planned-but-never-
implemented scaffolding for a cycle mode LMS never actually got — nothing
in the codebase read or wrote it (confirmed by grep before removal), unlike
`predictor_cycle_mode`, which Score Predictor genuinely uses and this
change doesn't touch. Dropped via `014_lms_remove_cycle.sql`. Full
reasoning: [decisions.md § LMS: no cycles](./decisions.md#lms-no-cycles-current_cycle-removed-slice-2-implemented).

**`lms_tiebreak_picks` — decided 2026-08-05: will not be built.** The prototype
referenced it but never created it; this specification originally left the door
open to "properly design it as part of Milestone 5." That door is now closed —
tie resolution is handled by two independent pot-level settings instead (below),
never by a player-facing tiebreak pick during the competition itself. (A
season-end tie can involve a one-off *prediction* — `final_prediction`, below —
but that's a settlement-time resolution mechanism, not a recurring pick
players make throughout the competition the way the prototype's table implied.)

**Wipeout Resolution — revised 2026-08-05** (renamed from an earlier
same-session draft's "Tie Outcome"; schema applied in
`013_lms_wipeout_and_rollover.sql`; full reasoning in
[decisions.md § LMS: Wipeout Resolution, automatic rollover, and a fixed per-competition entry fee](./decisions.md#lms-wipeout-resolution-automatic-rollover-and-a-fixed-per-competition-entry-fee)):
a **wipeout** is when every currently-`alive` entry in a pot is eliminated by
the same gameweek's results, going from N > 1 alive to 0 alive in one step —
distinct from the ordinary case of elimination continuing until exactly one
entry remains `alive` (that lone survivor is simply the winner,
`wipeout_resolution` never consulted) and distinct from a **season-end tie**
(below — multiple survivors remain when the season's actual final gameweek
finishes, not a wipeout at all). `determineWinner()` must detect a wipeout
specifically — "went from N>1 alive to 0 alive this gameweek" is not the same
check as "0 entries are alive." On a wipeout:
- `wipeout_resolution = split_prize` — every entry eliminated in that final
  gameweek is a joint winner; `awardPrize()` splits `net_amount` equally
  among them via the existing multi-winner path (same mechanism Pick 5
  already uses for a standings tie, GE-4.6). The competition ends there.
- `wipeout_resolution = roll_prize` — nobody wins. This pot's `pot_prizes`
  row for the instance is written with `rollover = true` — this old pot is
  now an **immutable historical record**; it never holds or tracks the
  carry-over amount itself, only the fact that it rolled over. **The Game
  Engine then automatically creates a new LMS pot** — copying the
  configurable LMS settings (`entry_fee`, `wipeout_resolution`,
  `season_end_tie_rule`, `admin_fee_*`/`charity_fee_*`) from the old pot as
  starting defaults (still organiser-editable pre-launch, via the existing
  "immutable only once entries exist" rule — no special-casing needed,
  `name` included, since it was never in any immutable set), setting
  `rollover_source_pot_id` to the old pot's id and `carry_over_amount`
  (belongs to the *new* pot alone) to the old pot's unclaimed `net_amount`,
  a generated default `name` derived from the old pot's (e.g. "Premier
  League LMS (Rollover)"), `status = 'draft'` (reusing `pot_status`'s
  existing, previously-unused `'draft'` value — no enum change), and
  inserting exactly one `pot_members` row: the old pot's organiser, as
  admin. **No other participant is carried over** — everyone else must
  explicitly rejoin. The organiser then, before activating it (still
  `status = 'draft'`, and nothing about it starts on its own): may rename
  it, invites players (existing `invite_code`/`redeem_invite()`, `ISSUE-8`),
  verifies payments as they come in (unchanged Payment Verification, per
  the GE-4.3 confirmation above), and chooses `start_gameweek_id` — the
  next gameweek, any future gameweek, or the following season's first,
  letting them wait out a nearly-finished season rather than force an
  awkward immediate restart. Activating the pot (`status` leaving `'draft'`)
  and generating the default name are both not-yet-designed Game Engine
  work — flagged, not built.
- Required for LMS pots (`pots.wipeout_resolution`, not-null with a default —
  enforcing "required" is an application/API-layer concern at pot creation,
  same pattern `predictor_cycle_mode`/`predictor_scorer_scope` already use
  despite also being mode-specific with a default). Immutable once the pot has
  entries (GE-2); `rollover_source_pot_id`/`carry_over_amount` are
  unconditionally immutable instead, since the Game Engine sets both exactly
  once, atomically, at creation.

**Season-end tie — new, decided 2026-08-05, a separate rule from Wipeout
Resolution.** If multiple entries are still `alive` when the season's actual
final gameweek finishes (not a wipeout — nobody was eliminated this
gameweek, they simply ran out of season), `pots.season_end_tie_rule` decides
the payout: `split_prize` splits `net_amount` equally, same mechanism as
above; `final_prediction` has each remaining entry submit one prediction
(winning team, first goalscorer, minute of first goal) for a designated
fixture, resolved in that priority order (correct winner, then correct
scorer, then closest minute, then an equal split if still tied). This needs
its own pick table (a `lms_final_predictions`-shaped table, not yet
designed) and is only ever reached at the very end of a competition — real
Slice 7/8-adjacent work, deliberately not designed further now to avoid
building schema for a case several slices away.

**Entry window and late entry — revised 2026-08-05, now simpler than an
earlier same-session draft** (which proposed cumulative per-gameweek
backfill billing — overturned; see the ADR linked above for why): a normal
pot's entry window closes forever once `start_gameweek_id`'s first fixture
kicks off (`gameweeks.earliest_kickoff_utc`) — no late entry after that,
ever. The **only** exception is a Game-Engine-created rollover pot, and even
there there's no cumulative billing or catch-up payment of any kind: a
player may join **while the pot is still `status = 'draft'`** (the
organiser's pre-launch workflow, above); once activated, normal LMS entry
rules apply — the same one-time, `start_gameweek_id`-anchored cutoff as any
other pot. Every joiner, at any point during the draft phase, pays exactly
the new competition's one flat `entry_fee` — never a backfilled multiple of
it. **Enforced, 2026-08-05** — `get-or-create-lms-entry` (GE-9) now checks
this before checking pot membership, via a pure `checkEntryWindow()`
function (`validate.ts`) fed the pot's `rollover_source_pot_id`/`status`/
`start_gameweek_id` and its start gameweek's `earliest_kickoff_utc`. Closes
`ISSUE-32` (Milestone 5 Slice 1 shipped before any entry-window rule
existed and had no such check at all) — see
[current-state.md § Resolved issues](./current-state.md#resolved-issues)
for verification detail. Full user-facing rule text:
[business-rules.md § Last Man Standing](./business-rules.md#last-man-standing).

**Locking — implemented, Milestone 5 Slice 3, 2026-08-05.** Each gameweek's
pick locks independently, at that gameweek's own deadline — not the whole
entry. `LmsEngine.lockEntries(ctx, gameweekId)` sets
`lms_team_picks.locked_at` for every not-yet-locked pick belonging to that
gameweek; `LmsEngine.validateEntry()` separately checks the target
gameweek's `deadline_utc` **live**, not via a stored status flag the way
Pick 5's does — the only way to gate "is this specific gameweek still
open" when the entry itself must stay `pending` across the whole
competition (see [GE-8.2](#ge-82-locking-flow) for the full contrast with
Pick 5). An entry with no pick at all for a gameweek that's now locked has
no row to lock — **what happens to a non-picker is a genuinely open
product question, not answered here** (flagged, not guessed at; see
[decisions.md § LMS locking](./decisions.md#lms-locking)).

**Scoring and elimination — implemented, Milestone 5 Slice 4, 2026-08-06,
answering the question above.** Decided by the repo owner: a missed pick
is treated exactly the same as a losing pick — immediate elimination, no
grace period, no automatic pick, no admin intervention, and this applies
even if every remaining entry misses the same gameweek (`wipeout_resolution`
still decides the outcome, unchanged — [GE-5.2](#ge-52-last-man-standing)
above). `LmsEngine.calculateScore()` implements this per gameweek, gated on
that gameweek's `deadline_utc` having passed (no consequential action
before then, same live-check pattern `validateEntry()` established):
resolves each existing pick against its team's own fixture (`'winning'`/
`'losing'` while that one fixture is still live — a non-consequential
label, mirroring Pick 5's own interim labeling — finalized to `'won'`/
`'lost'` once finished; `pick_result` has no `'drew'` value, and a draw
eliminates identically to a loss, so `'lost'` is reused for both, accurately,
for the one thing that value is ever checked against), then separately
eliminates every still-alive entry in an eligible pot with no pick row at
all for that gameweek — never fabricating one. "Eligible pot" excludes any
LMS pot whose `start_gameweek_id` is still in the future relative to this
gameweek (a draft rollover pot, for instance) — those entries must never be
touched by a gameweek their competition hasn't reached yet.

**Settlement — implemented, Milestone 5 Slice 5, 2026-08-06, deliberately
small.** Per the repo owner's explicit instruction not to duplicate
`calculateScore()`'s work, `LmsEngine.settle()` does exactly one thing: the
payment-void rule (docs/business-rules.md § Payment verification rules),
reading `entry_payments` with `scope = 'season'` (LMS's one flat
per-competition fee, not `'gameweek'`) — voiding an entry voids **all** of
its picks, across every gameweek, since a whole competition's participation
is what's unpaid, not one week's. Two things Pick 5's `settle()` does are
deliberately absent: it never transitions `game_entries.status` to
`'settled'` (must stay `'pending'` across the whole competition, same
reasoning as `lockEntries()`), and it never calls
`generateStandings()`/`determineWinner()`/`awardPrize()` — those conclude a
*competition*, not a gameweek, for LMS, and calling them every ordinary
gameweek would be structurally wrong, not just premature. Detecting "has
this competition just concluded" (wipeout detection) remains real,
unstarted design work for a later slice — see
[decisions.md § LMS settlement](./decisions.md#lms-settlement).

### GE-5.3 Score Predictor

One fixture predicted per gameweek (`unique(game_entry_id, gameweek_id)` on `predictor_picks`,
Milestone 6). Scoring: 5 points exact score, *or* 3 for correct winner (mutually exclusive),
plus a scorer bonus whose scope (`fixture_only` vs. `gameweek_wide`) is a per-pot setting
(`pots.predictor_scorer_scope`) rather than a hard-coded rule — mirrors how
`predictor_cycle_mode` already lets a pot choose `two_halves` vs. `single_cycle` reuse
restriction.

## GE-6. The Game Engine contract

**Implemented as of Milestone 3** — `supabase/functions/_shared/game-engine/contracts.ts`.
Every game mode implements the same eight-method lifecycle; the interface itself contains no
mode-specific logic and should never need to change when a mode is added.

| Method | Called when | Responsibility |
|---|---|---|
| `validateEntry(ctx, entry, picks)` | On submission, before persisting | Enforce the mode's pick-shape rules |
| `lockEntries(ctx, gameweekId)` | Deadline-lock cron tick | Transition eligible `game_entries` from `pending` to `locked` |
| `calculateScore(ctx, gameweekId)` | Scoring cron tick, gameweek live/finished | Resolve picks against real fixture data |
| `settle(ctx, gameweekId)` | Once a gameweek's fixtures are all finished | Finalize this gameweek's outcome for the mode |
| `generateStandings(ctx, potId)` | After `settle()`, and on-demand | Write `pot_standings_snapshots` rows |
| `determineWinner(ctx, potId)` | Only meaningful at competition end | Identify the winner(s) |
| `awardPrize(ctx, potId)` | Immediately after `determineWinner()` | Split the relevant `pot_prizes` row, write `payout_amount`/`status` |
| `notifyUsers(ctx, event)` | After any user-visible outcome | Write to `notifications` |

Every method takes a `GameEngineContext` (`{ supabase, now }`) as its first argument — see
[GE-17](#ge-17-folder-structure) and [GE-18](#ge-18-dependency-boundaries) for why this is
the dependency-injection boundary rather than each implementation constructing its own
Supabase client.

## GE-7. Dispatcher

**Implemented as of Milestone 3** — `supabase/functions/_shared/game-engine/dispatcher.ts`.
A single registry, keyed by `GameType`, resolved via `resolveEngine(gameType)`. Edge
functions never branch on `game_type` directly. **As of Milestone 4 Slice 2**, `pick5` is
registered — any Edge Function importing
`_shared/game-engine/pick5/index.ts` triggers `registerEngine('pick5', new Pick5Engine())`
as a side effect before that function's handler runs. `resolveEngine('last_man_standing')`
and `resolveEngine('score_predictor')` still throw `UnknownGameTypeError`, correctly, since
neither mode exists yet (Milestones 5/6). Registration is a one-line side-effecting import
each mode's own module performs when it lands — the dispatcher has zero import-time
knowledge of any mode, in either direction (see [GE-18](#ge-18-dependency-boundaries)).

## GE-8. Flows (narrative — see [GE-19](#ge-19-sequence-diagrams) for the diagrams)

### GE-8.1 Submission flow
**Revised in Milestone 4, Slice 2** (`submit-pick5-picks`) to match GE-6/GE-10 exactly
— the original text below described a SQL trigger calling `validateEntry()`, which
can't be true (`validateEntry()` is a TypeScript method per GE-6, and GE-10 forbids
business logic in SQL). Actual flow: Browser → Edge Function (`submit-pick5-picks`)
→ `Pick5Engine.validateEntry()` (server-side, authoritative) → on success, a
service-role write to the mode's pick table. The pick table itself has **no
client-insert RLS policy** (`007_pick5_picks.sql`) — the Edge Function is the only
write path, so there's no separate trigger-based enforcement layer to keep in sync
with the TypeScript rule. Client-side `validateEntry()`-equivalent checks are a UX
nicety only, same as before, never the enforcement mechanism.

### GE-8.2 Locking flow
`pg_cron` → Edge Function (`compute-deadlines`) → dispatcher → every *registered*
mode's `lockEntries()`, unconditionally. **Revised, Milestone 5 Slice 3**: this used
to pre-filter which modes to call by querying `game_entries` for rows matching the
gameweek's own id — which only ever matched Pick 5, since that filter silently
assumed every mode's entries are gameweek-scoped. LMS's aren't (GE-4.5). Now
`compute-deadlines` simply calls every mode `isRegistered()` reports true for
`resolveEngine(gameType).lockEntries(ctx, gw.id)` on every due gameweek, and trusts
each mode's own implementation to no-op efficiently when it has nothing to do —
genuinely mode-agnostic, not merely `game_type`-branch-free. What "locked" means is
**not** shared across modes: Pick 5's `lockEntries()` still transitions
`game_entries.status = 'pending' → 'locked'` (the entry itself, since it's
gameweek-scoped and has no life beyond that one gameweek); LMS's transitions
`lms_team_picks.locked_at` from `null` to a timestamp instead (the individual
gameweek's pick, since `game_entries` is season-scoped and must stay `pending` for
the whole competition — see [GE-5.2](#ge-52-last-man-standing)).

### GE-8.3 Scoring flow
`pg_cron` (`compute-scores` cadence) → Edge Function → dispatcher → every registered
mode's `calculateScore()`, for every live/in-progress gameweek. **Revised, Milestone 5
Slice 4**: same fix as [GE-8.2](#ge-82-locking-flow) — `compute-scores` had the identical
`game_entries.gameweek_id`-based discovery bug, which could never have found LMS's
season-scoped entries either. What `calculateScore()` *does* also diverges by mode:
Pick 5's stays purely a scoring step (defers every consequential status change to
`settle()`, GE-8.4); LMS's eliminates entries directly, since a wipeout-triggering
elimination only ever depends on one fixture being finished, not the whole gameweek —
see [GE-5.2](#ge-52-last-man-standing).

### GE-8.4 Settlement flow
`pg_cron` (`settle-gameweek` cadence) → Edge Function → dispatcher → `settle()` →
`generateStandings()` → (only at competition end) `determineWinner()` → `awardPrize()` →
`notifyUsers()`. **As implemented (Slice 8/9):** `determineWinner()` and `notifyUsers()`
are both called from *within* `awardPrize()` itself, not as separate self-calls from
`settle()` — `awardPrize()` is the one method that already resolves the
idempotent-no-op-vs-real-award question, so it's the natural single call site for both.
See [decisions.md § Notifications](./decisions.md#notifications-domain-events-not-delivery)
for why this doesn't contradict the diagram below. **As hardened (production
readiness sprint, 2026-08-05):** `settle()`'s per-pot loop and
`settle-gameweek/index.ts`'s per-gameweek loop each isolate failures in their
own try/catch, so one pot's or one gameweek's failure (e.g.
`Pick5PrizePoolExceededError`) can no longer block unrelated pots/gameweeks in
the same batch — see [decisions.md § Failure isolation](./decisions.md#failure-isolation-one-pots-gameweeks-error-must-never-block-anothers).

**Revised, Milestone 5 Slice 5**: same discovery fix as [GE-8.2](#ge-82-locking-flow)/
[GE-8.3](#ge-83-scoring-flow) — `settle-gameweek` had the identical broken pre-filter.
What `settle()` *does* also diverges sharply by mode. Pick 5's `settle()` calls
`generateStandings()`/`awardPrize()` every gameweek, because a new payable instance
concludes weekly. **LMS's `settle()` does the payment-void check only** — it never
calls `generateStandings()`/`determineWinner()`/`awardPrize()` at all, and never
transitions `game_entries.status` to `'settled'`, since neither makes sense on an
ordinary gameweek for a competition that only concludes once (a wipeout, or one
survivor). See [GE-5.2](#ge-52-last-man-standing) and
[decisions.md § LMS settlement](./decisions.md#lms-settlement).

### GE-8.5 Payment Verification flow
Shared `admin-actions` (`mark_paid`/`mark_unpaid`), unchanged in shape, now writing to the
generalized `entry_payments` — no mode-specific code in `admin-actions` itself. Two
admin-driven paths write the same table: single-entry manual verification, and bulk
verification via CSV import (identifier = email or phone, validated/previewed before
any write — see [business-rules.md § Payment verification rules](./business-rules.md#payment-verification-rules)).
Neither exists yet (`ISSUE-6`). No payment gateway is ever a participant in this flow.

### GE-8.6 Leaderboard flow
`generateStandings()` writes `pot_standings_snapshots`; the frontend reads that one table
regardless of `game_type`.

### GE-8.7 Notification flow
Any Game Engine step producing a user-facing outcome calls `notifyUsers()`, which writes to
`notifications`. Delivery beyond in-app display is out of scope here. **Implemented as of
Slice 9:** `notifyUsers()` is a pure domain-event emitter (insert one row, return) — see
[decisions.md § Notifications](./decisions.md#notifications-domain-events-not-delivery). A
notification write failure is caught at its call site and never propagates to abort or
reverse the user-facing outcome (e.g. a prize award) that triggered it.

## GE-9. Edge Function inventory

| Function | Change |
|---|---|
| `sync-fixtures`, `sync-live-events` (per `ISSUE-4`) | Unchanged — feeds all three modes identically |
| `compute-deadlines` | **Milestone 4 Slice 3**: now drives locking via the dispatcher. Deadline computation itself is unchanged. Now also writes a `sync_runs` row per invocation (previously didn't). **Revised, Milestone 5 Slice 3**: once a gameweek's `deadline_utc` has passed, calls `lockEntries()` for every mode `isRegistered()` reports true, unconditionally — replaces the original "discover game types via a `game_entries.gameweek_id` query" step, which only ever matched Pick 5 (see [GE-8.2](#ge-82-locking-flow)). Now imports `lms/index.ts` alongside `pick5/index.ts` |
| `compute-scores` | **Milestone 4 Slice 4**: now drives scoring via the dispatcher. Old logic (reading/writing `user_entries`/`user_entry_picks`) is unchanged. Response body reports `gameEngineDispatches` alongside the pre-existing `processed` count. **Revised, Milestone 5 Slice 4**: replaced the same broken `game_entries.gameweek_id` discovery pre-filter `compute-deadlines` had (never matched LMS) with an unconditional "call every registered mode" loop — see [GE-8.3](#ge-83-scoring-flow). Now imports `lms/index.ts` alongside `pick5/index.ts` |
| `settle-gameweek` | **Milestone 4 Slice 5**: now drives `settle()` via the dispatcher, once its existing "all fixtures finished" check passes. Old logic (`user_entries`/`leaderboard_snapshots`) is unchanged. No `sync_runs` write added — GE-19's Settlement diagram doesn't call for one, unlike Locking. **Milestone 4 Slice 8**: `settle()` now also calls `awardPrize()` (which internally calls `determineWinner()`) for every distinct pot settled, so a single `settle-gameweek` invocation now settles, ranks, and pays out in one pass. **Milestone 4 Slice 9**: `awardPrize()` now also calls `notifyUsers()` per winner, so the same invocation now also writes the user-facing `notifications` row — no `settle-gameweek` code change was needed for either Slice 8 or Slice 9, since both are internal to the Game Engine. **Revised, Milestone 5 Slice 5**: replaced the same broken `game_entries.gameweek_id` discovery pre-filter with an unconditional "call every registered mode" loop — see [GE-8.4](#ge-84-settlement-flow). Now imports `lms/index.ts` alongside `pick5/index.ts` |
| `admin-actions` | Unchanged in shape; operates on the now-generalized shared tables |
| `get-or-create-pick5-entry` (new, Milestone 4 Slice 1) | Not one of the eight Game Engine lifecycle methods — creating the `game_entries`/`game_entry_pick5` row pair is persistence orchestration, not scoring/validation/settlement/payout logic, so it's a plain Edge Function rather than a dispatcher call. If LMS/Predictor need equivalent creation logic in Milestones 5/6, revisit whether this should generalize into shared, mode-branching logic |
| `submit-pick5-picks` (new, Milestone 4 Slice 2) | First Edge Function to call a real dispatcher-resolved Game Engine method — `resolveEngine('pick5').validateEntry(ctx, entry, picks)`. Writes `pick5_picks` via upsert on `(game_entry_id, pick_position)` only after validation passes |
| `get-or-create-lms-entry` (new, Milestone 5 Slice 1) | Same reasoning as `get-or-create-pick5-entry` — not a dispatcher call. **Corrected 2026-08-05** (`ISSUE-32`, resolved): now checks the pot's entry window (normal pot: one-time cutoff at `start_gameweek_id`'s kickoff; rollover pot: `status = 'draft'`) before checking membership |
| `submit-lms-pick` (new, Milestone 5 Slice 2) | First Edge Function to call `LmsEngine` for real — `resolveEngine('last_man_standing').validateEntry(ctx, entry, { gameweekId, teamId })`. A season-scoped entry has no `gameweek_id` of its own (GE-4.5), so `gameweek_id` is a request parameter here, unlike `submit-pick5-picks`. Writes `lms_team_picks` via upsert on `(game_entry_id, gameweek_id)` only after validation passes |
| Prototype SQL functions (`settle_gameweek`, `settle_lms_gameweek`, `settle_predictor_gameweek`, `settle_predictor_season`, `compute_live_scores`) | Retired, not ported |

**Milestone 3 note:** the framework module exists standalone and is not yet imported by any
of the above — wiring it in is explicitly Milestone 4+ work, not part of building the
framework itself.

## GE-10. Database vs. Engine responsibilities

| Database | Game Engine |
|---|---|
| Persistence | Validation |
| Constraints (FKs, uniques, enums, checks) | Scoring |
| Indexes | Settlement |
| RLS | Payouts |
| — | Standings generation |

No scoring formula, elimination rule, or payout split lives in a SQL function. SQL functions
that remain (`set_updated_at`, `create_entry_payment`, `handle_new_user`,
`prevent_pot_contract_change`) are all in the proven category: deriving/defaulting/guarding
a column value, never orchestrating a multi-step business process.

## GE-11. RLS strategy

Every table: `select` gated on `is_pot_member`, `insert` gated on `user_id = auth.uid() and
is_pot_member(...)`, no client-reachable write on any Game-Engine-derived column. **Post-
review:** row-level policies alone don't stop a user writing an unintended column in the
same statement as a legitimate one, so `game_entries` and `notifications`' `update` policies
are paired with a column-level `revoke`/`grant` narrowing exactly which columns "update" is
allowed to touch (`updated_at` only on `game_entries` today — a deliberately-recorded no-op
until Milestone 4+ adds a real user-editable column; `read_at` only on `notifications`).

## GE-12. Milestone plan

| Milestone | Scope | Status |
|---|---|---|
| 1 | Architecture finalized, specification produced and approved | **Done** |
| 2 | Shared schema, RLS, payments, entries — reviewed against greenfield standard, Critical/Required findings applied | **Done** — see [schema-review.md](./schema-review.md) |
| 3 | Shared Game Engine framework: folder structure, interfaces, dispatcher, shared types, DI, contracts. No mode logic, no scoring, no settlement | **Done** |
| 4 | Pick 5 implementation | **In progress** — Slice 1 (entry creation), Slice 2 (pick submission), Slice 3 (locking), Slice 4 (scoring), Slice 5 (settlement), Slice 6 (standings, resolving `ISSUE-15`/`ISSUE-17`), Slice 7 (`determineWinner()`, standalone), Slice 8 (`awardPrize()`, gross/net prize pool deductions, wired into `settle()`), and Slice 9 (`notifyUsers()`, domain-event notifications, wired into `awardPrize()`) done — all eight `GameEngine` contract methods now implemented for Pick 5 |
| 5 | Last Man Standing implementation | **In progress** — Slice 1 (entry creation, `get-or-create-lms-entry`) done and committed. Architecture revised three times 2026-08-05 for the Wipeout Resolution/rollover/late-entry product decisions; `013_lms_wipeout_and_rollover.sql` applied. `ISSUE-32` (entry-window gate) fixed and verified live. **Slice 2 (pick submission, `submit-lms-pick` + `lms_team_picks` + `LmsEngine.validateEntry()`) done and committed** — unblocked by the repo owner's decision to remove LMS cycles entirely (`current_cycle` dropped, `014_lms_remove_cycle.sql`); a team may never be picked twice across the whole competition, enforced by a real unique constraint, not just application logic. **Slice 3 (locking) done and committed** — `LmsEngine.lockEntries()` implemented (`lms_team_picks.locked_at`, not `game_entries.status` — a genuine, necessary divergence from Pick 5, see [GE-5.2](#ge-52-last-man-standing)); found and fixed a real gap in the shared `compute-deadlines` function, which had silently never been able to discover LMS's season-scoped entries as needing locking at all. **Slice 4 (scoring) done and committed** — `LmsEngine.calculateScore()` implemented, answering the repo owner's product decision that a missed pick eliminates identically to a losing pick; also fixed the identical discovery bug in `compute-scores`. No schema change — reused `game_entry_lms.competitive_status`/`eliminated_gameweek_id`, `lms_team_picks.result`, and `pots.start_gameweek_id`, all already existing. **Slice 5 (settlement) done, 2026-08-06, deliberately small** — `LmsEngine.settle()` implements the payment-void rule only (`entry_payments.scope = 'season'`), per the explicit instruction not to duplicate `calculateScore()`'s already-done elimination work; never transitions `game_entries.status` to `'settled'` and never calls `generateStandings()`/`determineWinner()`/`awardPrize()` (those conclude a competition, not a gameweek, for LMS). Also fixed the identical discovery bug in `settle-gameweek`. No schema change. Four of eight `GameEngine` methods still throw `GameEngineNotImplementedError` (`generateStandings`/`determineWinner`/`awardPrize`/`notifyUsers`) — wipeout detection (`determineWinner()`) remains unstarted design work. Not committed — awaiting review |
| 6 | Score Predictor implementation | Not started |
| 7 | Shared dashboards, admin, notification delivery design, `redeem_invite()`'s deferred checks | Not started |
| 8 | End-to-end testing, performance review, security review | Not started |
| 9 | Launch readiness review | Not started |

## GE-13. Rationale index

| Decision | Chosen | Rejected alternative | Why |
|---|---|---|---|
| Entry architecture | Shared `game_entries` parent + thin per-mode children | Three fully independent entry systems | Three real, simultaneously-launching modes genuinely share the entry concept |
| Pick storage | Fully separate typed tables per mode | One polymorphic JSON picks table | Different modes reference genuinely different FKs — JSON can't be FK-constrained |
| Settlement logic location | Edge Functions only | SQL functions (the prototype's approach) | Testable, matches existing architecture, avoids the class of bug the prototype's SQL functions actually had |
| LMS win representation | `alive` + `payout_amount > 0` | A third `winner` enum value | The prototype's actual bug was trying to set a value never added to the enum |
| Predictor scorer-bonus scope | Per-pot config | Hard-coded rule | Mirrors the established `predictor_cycle_mode` pattern |
| Money pot model | One `pot_prizes` table, `scope` discriminator | Per-mode pot tables | `gameweek_pots` was misfiled as LMS/Predictor scope when it was actually Pick 5's own feature |
| **(post-review)** FK delete behavior on money tables | `restrict` | `cascade` | A deleted parent row must never silently destroy a payout record |
| **(post-review)** Scope representation | Explicit `pot_scope` enum column, reused across `pot_prizes`/`game_entries`/`entry_payments` | Inferring scope from `gameweek_id` nullability alone | One consistent, checkable pattern instead of three ad hoc conventions for the same concept |
| **(post-review)** `game_entries.settled` | Removed | Kept alongside `status` | Two independently-writable columns for one fact is a drift risk with no offsetting benefit |
| **(post-review)** Pot-contract immutability | Broadened to `entry_fee`/`end_gameweek_id`/predictor settings, gated on "has entries yet" | `game_type`-only | These are equally fairness-critical once money/picks are committed |

## GE-14. Traceability convention

Cite the `GE-N` id directly in commit messages, migration file headers, Edge Function
doc-comments, and test descriptions — e.g. "implements GE-6 (dispatcher)". Never renumbered,
never reused.

## GE-15. Explicitly deferred / not carried forward

- **`half_cycle` boundary computation** ([GE-5.3](#ge-53-score-predictor)) — needs resolving
  before Milestone 6.
- **Milestone 6's pick table will hit the same prototype-name collision `lms_team_picks`
  did.** The retired prototype's `predictor_picks` table (`supabase_admin`-owned,
  `ISSUE-20`) occupies the obvious name, exactly like `lms_picks` did for
  Milestone 5 Slice 2 — confirmed live, not theoretical, when
  `015_lms_picks.sql` first failed with "relation lms_picks already
  exists." Plan the real name (e.g. `predictor_fixture_picks`) before
  drafting that migration, not after hitting the same error again.
- **Notification delivery mechanism** — in-app only vs. email/push; needs its own addendum
  before Milestone 7.
- **`redeem_invite()`'s `max_members`/`status` checks** — identified in
  [schema-review.md #5](./schema-review.md), deliberately deferred to Milestone 7 (when this
  function gets a real UI caller) rather than fixed without one to verify against.
- **Two smaller Recommended/Optional findings from the Milestone 2 review, deliberately not
  applied:** the extra performance indexes (`game_entries` gameweek+status,
  `notifications` unread) and removing `pots.game_type`'s default value. Both are cheap and
  available on request; neither was classified Critical or Required-before-launch, so
  neither was applied automatically — see `session-log.md` for the full classification.
- **The prototype SQL functions' logic was not ported line-for-line** — two confirmed bugs
  (missing `lms_tiebreak_picks`, an invalid `'winner'` enum value) and one mis-scoped table
  (`gameweek_pots` belonging to Pick 5, not LMS) meant the prototype was never a working
  reference implementation, only a signal of intent.
- **Milestone 3 does not wire the dispatcher into any existing Edge Function** — the
  framework exists standalone; integration is Milestone 4+ work.

## GE-16. Shared services

Naming the logical groupings behind [GE-3](#ge-3-platform-vs-game-mode-boundary)'s table, so
"shared platform" isn't just an adjective:

| Service | Owns | Backed by |
|---|---|---|
| **Identity** | Sign-up/sign-in, session, profile | Supabase Auth, `profiles` |
| **Pot Service** | Pot lifecycle, membership, invitations | `pots`, `pot_members`, `redeem_invite()` |
| **Payment Verification Service** | Who's verified as paid (off-platform), how much is in a pot | `entry_payments`, `pot_prizes`, `admin-actions` — never a payment gateway |
| **Fixture Data Service** | Leagues, teams, players, fixtures, live events | `sync-fixtures`, `sync-live-events` (per `ISSUE-4`), the reference-data tables |
| **Standings Service** | Rankings, historical snapshots | `pot_standings_snapshots`, `generateStandings()` |
| **Notification Service** | User-facing event log | `notifications`, `notifyUsers()` |
| **Admin Service** | Cross-pot and pot-scoped privileged actions | `admin-actions`, `sync_runs` |
| **Game Engine** | Orchestration of mode-specific lifecycle | [GE-6](#ge-6-the-game-engine-contract), [GE-7](#ge-7-dispatcher) |

Every service above is implemented once. A game mode never re-implements a service — it
*calls* one (e.g., a mode's `awardPrize()` reads/writes `pot_prizes` via the Payment
Verification Service's tables, it doesn't invent its own money-tracking mechanism —
and never integrates a payment gateway directly, per
[decisions.md § Payment Verification, not payment processing](./decisions.md#payment-verification-not-payment-processing)).

## GE-17. Folder structure

```
supabase/functions/
  _shared/
    cors.ts                        existing — shared CORS headers
    game-engine/                   NEW — Milestone 3
      types.ts                     GameType, GameEntry, Pot, StandingsRow, NotificationEvent
      contracts.ts                 GameEngine interface, GameEngineContext (the DI boundary)
      errors.ts                    UnknownGameTypeError, GameEngineNotImplementedError
      dispatcher.ts                registerEngine(), resolveEngine()
      dispatcher.test.ts           dispatcher registry mechanics, tested in isolation
      framework-verification.test.ts  full-contract + dependency-injection proof, via __fixtures__
      __fixtures__/
        test-game-engine.ts        FRAMEWORK VERIFICATION ONLY — never imported by production code
      index.ts                     barrel export
      pick5/                       Milestone 4 — validateEntry (Slice 2), lockEntries
                                    (Slice 3), calculateScore (Slice 4), settle
                                    (Slice 5), generateStandings (Slice 6),
                                    determineWinner (Slice 7), awardPrize
                                    (Slice 8), and notifyUsers (Slice 9) implemented.
                                    All eight GameEngine contract methods done.
      lms/                         Milestone 5 — validateEntry (Slice 2), lockEntries
                                    (Slice 3), calculateScore (Slice 4), settle
                                    (Slice 5) implemented; generateStandings/
                                    determineWinner/awardPrize/notifyUsers not yet
                                    (throw GameEngineNotImplementedError)
      predictor/                   Milestone 6 — empty until then
  compute-scores/                  Milestone 4 Slice 4 — imports _shared/game-engine, drives calculateScore()
  compute-deadlines/                Milestone 4 Slice 3 — imports _shared/game-engine, drives lockEntries()
  settle-gameweek/                 Milestone 4 Slice 5 — imports _shared/game-engine, drives settle()
  admin-actions/                   existing — unchanged
  sync-fixtures/                   existing — unchanged
  get-or-create-pick5-entry/       NEW — Milestone 4 Slice 1 (not a dispatcher call, see GE-9)
  submit-pick5-picks/              NEW — Milestone 4 Slice 2, first real dispatcher call
                                    (resolveEngine('pick5').validateEntry())
  get-or-create-lms-entry/         NEW — Milestone 5 Slice 1, mirrors get-or-create-pick5-entry
                                    exactly (not a dispatcher call); the one structural
                                    difference is a season-scoped entry (no gameweek_id in
                                    the request), per GE-4.5
  submit-lms-pick/                 NEW — Milestone 5 Slice 2, first real LMS dispatcher call
                                    (resolveEngine('last_man_standing').validateEntry())
```

Each mode's future subdirectory (`pick5/`, `lms/`, `predictor/`) will contain exactly one
`GameEngine` implementation plus that mode's own private helpers — nothing outside
`_shared/game-engine/<mode>/` should ever need to know those helpers exist.

## GE-18. Dependency boundaries

```mermaid
graph LR
  EdgeFn["Edge Functions<br/>(compute-scores, settle-gameweek, compute-deadlines)"]
  Dispatcher["dispatcher.ts"]
  Contracts["contracts.ts + types.ts"]
  Pick5["pick5/ (Milestone 4)"]
  Lms["lms/ (Milestone 5)"]
  Predictor["predictor/ (Milestone 6)"]

  EdgeFn -->|"resolveEngine(gameType)"| Dispatcher
  Dispatcher -->|"typed by"| Contracts
  Pick5 -->|"implements"| Contracts
  Lms -->|"implements"| Contracts
  Predictor -->|"implements"| Contracts
  Pick5 -->|"registerEngine() at import time"| Dispatcher
  Lms -->|"registerEngine() at import time"| Dispatcher
  Predictor -->|"registerEngine() at import time"| Dispatcher
```

Rules, enforced by convention today and worth a lint rule once more than one mode exists:

- `contracts.ts` and `types.ts` import nothing from any mode's subdirectory, ever — the
  contract must stay implementation-agnostic.
- `dispatcher.ts` imports nothing from any mode's subdirectory either — it only knows about
  `GameType`/`GameEngine`, never `Pick5Engine` or similar by name. Modes register
  themselves; the dispatcher never reaches out to find them.
- A mode's subdirectory may import `contracts.ts`/`types.ts`/`errors.ts`, and may import
  another *service's* shared code (e.g., the future Payment Verification Service
  helpers), but **never**
  another mode's subdirectory. `pick5/` must never import from `lms/`.
- Edge Functions import `dispatcher.ts` (and, once written, the mode registration
  side-effect imports) — they never import a mode's implementation directly.

This is what makes "add a fourth mode later" (not currently planned, per
[GE-1](#ge-1-product-vision)) a one-directory, zero-shared-file change if it ever happens.

## GE-19. Sequence diagrams

### Entry submission

```mermaid
sequenceDiagram
  participant U as Browser (authenticated)
  participant DB as Postgres (RLS)
  participant T as before-insert/update trigger

  U->>DB: insert/update pick row
  DB->>DB: RLS check: is_pot_member(pot_id) AND game_entries.status = 'pending'
  DB->>T: validateEntry() (mode-specific, server-side)
  T-->>DB: raise exception, or allow
  DB-->>U: 201 / 4xx
  Note over U,DB: Client-side validateEntry() runs first for UX only — never the enforcement mechanism (GE-8.1)
```

### Locking

```mermaid
sequenceDiagram
  participant Cron as pg_cron
  participant EF as Edge Function (compute-deadlines)
  participant D as dispatcher
  participant GE as Mode's GameEngine

  Cron->>EF: scheduled tick
  EF->>D: for each mode with due entries, resolveEngine(gameType)
  D-->>EF: GameEngine instance
  EF->>GE: lockEntries(ctx, gameweekId)
  GE->>GE: update game_entries set status = 'locked' where deadline passed
  GE-->>EF: count locked
  EF->>EF: write sync_runs row
```

### Scoring

```mermaid
sequenceDiagram
  participant Cron as pg_cron
  participant EF as Edge Function (compute-scores)
  participant D as dispatcher
  participant GE as Mode's GameEngine
  participant Fx as fixtures / fixture_events

  Cron->>EF: scheduled tick
  EF->>D: resolveEngine(gameType) per pot
  D-->>EF: GameEngine instance
  EF->>GE: calculateScore(ctx, gameweekId)
  GE->>Fx: read live/finished fixture data
  GE->>GE: write pick results, game_entry_<mode> aggregates
  GE-->>EF: done
  EF->>EF: write sync_runs row
```

### Settlement

```mermaid
sequenceDiagram
  participant Cron as pg_cron
  participant EF as Edge Function (settle-gameweek)
  participant D as dispatcher
  participant GE as Mode's GameEngine
  participant Pz as pot_prizes

  Cron->>EF: scheduled tick
  EF->>D: resolveEngine(gameType) per pot with a finished gameweek
  D-->>EF: GameEngine instance
  EF->>GE: settle(ctx, gameweekId)
  GE->>GE: generateStandings(ctx, potId) -> pot_standings_snapshots
  GE->>GE: awardPrize(ctx, potId)
  Note over GE,Pz: awardPrize() internally calls determineWinner(), then (unless already<br/>is_settled — idempotent no-op) writes Pz and calls notifyUsers() per winner
  GE->>Pz: pot_prizes.is_settled, payout_amount
  GE-->>EF: done
```

### Notifications

```mermaid
sequenceDiagram
  participant GE as Any GameEngine step
  participant N as notifications table
  participant U as Browser (authenticated)

  GE->>N: insert notification row (notifyUsers)
  U->>N: select where user_id = auth.uid() (RLS)
  U->>N: update read_at only (column-grant restricted)
  Note over N: Delivery beyond in-app display is out of scope (GE-15)
```

## GE-20. Architectural invariants

These must remain true through every future milestone. A change that breaks one of these is
a `GE-N` amendment, not a normal code change — it needs the same scrutiny this document
itself got.

1. **One game mode per pot, immutable after creation.** No hybrid pots, structurally
   enforced via `game_entries.pot_id` + `pots.game_type`, not just by policy.
2. **`game_entries` is the only entry table.** No mode ever creates a parallel entries
   table — it gets a thin extension table instead.
3. **Picks are fully typed and mode-specific — never polymorphic JSON.** A pick always
   FK-references the real domain object it's about (`player_id`, `team_id`, `fixture_id`).
4. **No business logic in SQL functions.** Scoring, elimination, settlement, and payouts
   live in the Game Engine (TypeScript, Edge Functions) exclusively. SQL functions derive or
   guard column values only.
5. **Every settlement/scoring code path is service-role-only.** No client role ever has
   `EXECUTE` on anything that determines a payout or writes a derived score.
6. **RLS default-denies.** A new table with no explicit policy for a role grants that role
   nothing — this has been true since the Phase 1 security remediation and must stay true.
7. **Money-holding tables never cascade-delete.** `pot_prizes` and `game_entries`'s FKs are
   `restrict`; a parent row with financial data attached cannot be deleted as a side effect.
8. **The dispatcher never imports a mode; a mode always imports the dispatcher.** See
   [GE-18](#ge-18-dependency-boundaries).
9. **JSON columns are display-only.** `pot_standings_snapshots.meta` and
   `notifications.payload` are the only sanctioned jsonb columns in this design, and neither
   is ever queried, filtered, or joined on — if a future need requires querying inside a
   JSON blob, that's a signal a typed column or table was needed instead, not a reason to
   add more JSON.
10. **Every migration, Edge Function, RLS policy, and test cites a `GE-N`.** If it can't be
    traced back to a paragraph in this document, either the code is out of scope or this
    document is out of date — and if the latter, this document gets amended, not silently
    outpaced.
