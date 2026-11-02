# PROPOSAL — Score Predictor two-halves prize structure (40 / 40 / 20)

**Status: PENDING OWNER APPROVAL. Not a business rule. Not implemented.** Payout logic
is unchanged until the owner approves the final rules; once approved, the agreed
rules move into [business-rules.md](../business-rules.md) and this file is marked
superseded (kept for history).

Raised: 2026-11-02 · Requested by: owner · Context:
[finalisation-status.md § 10](../finalisation-status.md#10-product-decisions).
**Deadline:** an H1 payout on time needs this decided, built and deployed before
the gameweek 19 deadline; otherwise H1 can be paid retrospectively once built.

Each rule below is marked **[proposed]** (a recommendation the owner can accept as
written) or **[decide]** (a genuine choice with options, no default assumed).

---

## 1. Today's behaviour (verified in code, 2026-11-02)

- `predictor_cycle_mode = 'two_halves'` (the default for every new Score Predictor pot)
  and `single_cycle` pay **identically**: one season-end prize.
- One cumulative standings table across the whole competition.
- `PredictorEngine.awardPrize()`: gross = `entry_fee` × non-void entries; admin and
  charity fees (fixed or % of gross) deducted to give net; net ÷ winners, each share
  floored to the cent (leftover cents are not allocated); one `pot_prizes` row
  (`scope = 'season'`, `is_settled = true`); idempotent; `predictor.prize_awarded`
  notification per winner.
- Ties: points → exact scores → correct goalscorers → equal split.
- Unpaid entries are voided at settlement; an admin can reinstate (Late Payment Override).

## 2. Proposed structure

| Prize | Share of net pool | Won by |
|---|---|---|
| **H1** — first half | **40 %** | Most points from H1 gameweeks |
| **H2** — second half | **40 %** | Most points from H2 gameweeks |
| **Overall** — season | **20 %** | Most points across the whole competition |

One player can win more than one prize (e.g. H1 and Overall).

## 3. Gameweek boundaries

- **[proposed]** H1 = Premier League gameweeks **1–19**; H2 = gameweeks **20–38**,
  by `gameweeks.number` within the pot's league and season. Overall = every
  gameweek from the pot's start to its end gameweek.
- **[proposed]** A fixture counts toward the half of **its own gameweek**, even if it
  is played (rescheduled) on a date inside the other half.
- **[decide] Pots starting in H2** (start gameweek ≥ 20): there is no H1 competition.
  Options: (a) H1's 40 % goes to the H2 winner (0 / 80 / 20); (b) it goes to Overall
  (0 / 40 / 60); (c) such pots cannot use two-halves mode (force `single_cycle`).
  Recommendation: **(c)** — simplest to explain; the create-pot form already knows
  the start gameweek.
- **[decide] Pots ending before GW38** (`end_gameweek_id` earlier than 38): H2 runs
  from GW20 to the end gameweek. Confirm, or disallow custom ends for two-halves pots.

## 4. Eligibility

- **[proposed]** An entry is eligible for a prize if it is **not void** at the moment
  that prize is finalised. This is exactly today's settlement rule, applied per prize.
- **[proposed]** Season payment (`entry_payments.scope = 'season'`) covers all three
  prizes; no separate H2 fee.
- **[proposed]** An entry voided for non-payment and later reinstated (Late Payment
  Override) is eligible for any prize **not yet finalised** at reinstatement. Prizes
  already finalised stand (no retroactive re-award).
- **[proposed]** Points are counted only from gameweeks the entry was eligible for
  (existing rule: picks for a void entry are not scored).

## 5. Tie-breaking

- **[proposed]** Within each prize, use the **existing** hierarchy, computed over that
  prize's gameweeks only: total points → exact-score count → correct-goalscorer
  count → equal split between those still tied.
- **[proposed]** No extra tiebreak (e.g. head-to-head, earliest entry). Equal split is
  already the platform's final tiebreak in all three modes.

## 6. Prize calculations

Definitions (unchanged formulas from `awardPrize()`): **gross** = entry fee ×
non-void entries; **net** = gross − admin fee − charity fee.

- **[proposed] H1 prize** = 40 % × net, where net is computed **when H1 is finalised**.
- **[proposed] Season-end prizes** use the final net, minus what H1 already paid:
  `remaining = final net − H1 paid`; **H2 = ⅔ × remaining**, **Overall = ⅓ × remaining**.
  If the pool never changes, this is exactly 40 / 40 / 20. If late joiners grow the
  pool after H1, the growth goes to H2 and Overall in the same 2 : 1 ratio, and H1 is
  never clawed back.
- **[proposed]** Fees are never taken twice: because the season-end prizes are
  `final net − H1 paid`, total payouts always equal the final net, i.e. exactly what a
  single-payout pot pays after its fees.
- **[decide]** Whether H1's 40 % is calculated **before or after fixed fees**.
  (a) After: H1 = 40 % × (gross − all fees at H1). Simple, but a fixed fee is borne
  mostly by H1 early in the season. (b) Before: H1 = 40 % × (gross − percentage fees
  only); fixed fees come out of the season-end remainder. Recommendation: **(b)** —
  H1 isn't penalised by a fixed fee meant for the whole season. (The worked example
  below uses a percentage fee, so both options give the same numbers.)
- **[proposed]** Rounding as today: each winner's share is floored to the cent;
  leftover cents stay unallocated (recorded, never silently paid out).
- **[proposed]** If a prize has no eligible entries (e.g. everyone void), that prize
  is not paid and its amount carries to the **next** prize to be finalised
  (H1 → season-end remainder; H2/Overall → recorded as unallocated).

**Worked example:** 10 paid entries × €20 = €200 gross; 10 % admin fee = €20; net
€180. H1 = €72. Two players tie for H2 → €36 each. Overall winner €36.
(€180 − €72 = €108; H2 = €72 split two ways, Overall = €36.)

## 7. Players joining late

Depends on the separate **entry-window decision** (finalisation-status.md § 10,
item 4), which is still open.

- **[proposed] If mid-season joining stays allowed:** a late joiner scores only from
  gameweeks after joining (no retroactive picks), is eligible for every prize not yet
  finalised, and pays the **full** season fee (no pro-rata).
- **[proposed] If an entry window is introduced:** joining closes at the deadline of
  the pot's start gameweek (matching Last Man Standing), and this section no longer
  applies.
- **[decide]** Full fee vs pro-rata for late joiners. Recommendation: full fee, since
  the app never handles money and pro-rata would be an off-platform arrangement anyway.

## 8. Withdrawals

There is no self-withdrawal feature today; only a pot admin can remove a member
(`admin-actions` `remove_member`).

- **[proposed]** A removed or withdrawn player is ineligible for every prize not yet
  finalised. Prizes they already won stand.
- **[proposed]** Their entry still counts toward gross (their fee was collected), unless
  their entry is voided. Refunds are off-platform and the app does not model them.
- **[decide]** Should removal void the entry (shrinking the pool) or keep it in the
  pool? Recommendation: keep it in the pool — the organiser decides any refund outside
  the app, and the pool shown to players doesn't shrink unexpectedly.

## 9. Incomplete competitions

- **[proposed] Postponed fixtures:** a half is not finalised while any of its fixtures
  is postponed. **[decide]** A cut-off after which a still-unplayed fixture is ignored
  for that half (recommendation: the deadline of gameweek 21 for H1; the season's
  final day for H2), so one postponement can't block H1 indefinitely.
- **[proposed] Cancelled fixtures** are excluded (no points), as today.
- **[proposed] Season curtailed / abandoned:** an admin can trigger season-end
  finalisation on the gameweeks played so far; H2 and Overall are then judged on those.
  Needs an explicit admin action (none exists today). **[decide]** whether to build it
  now or handle such a case manually.

## 10. Finalisation of results

- **[proposed] H1 is finalised** by `settle-gameweek` once the gameweek-19 deadline has
  passed **and** every H1 fixture is finished or cancelled (or past the postponement
  cut-off). This is the same readiness gate settlement uses today.
- **[proposed] Season-end prizes** are finalised exactly as today (end gameweek
  complete), together.
- **[proposed]** Each prize writes its own settled `pot_prizes` row (new scope values,
  e.g. `half_1`, `half_2`, `season`), idempotent like today: a settled prize is never
  re-awarded by later runs.
- **[proposed]** Each winner gets a `predictor.prize_awarded` notification with the
  prize name (`half_1` / `half_2` / `overall`) in the payload.
- **[proposed]** Standings show the current half's table and the overall table; after
  H1 is finalised, its winners and amounts are shown permanently on the pot page.
- **[proposed] Corrections** after finalisation (e.g. a scoring error found later) are
  admin-only and audited, using the same pattern as Late Payment Override; no automatic
  re-award.

## 11. Engineering implications (for estimating — nothing started)

- Half-scoped standings (a `half` dimension on `pot_standings_snapshots`, or computed).
- `pot_prizes` scope values for halves (migration) and the H1/season split calculation.
- An extra finalisation call at the H1 boundary in `PredictorEngine.settle()`.
- UI: current-half table, H1 result banner, create-pot form handling for pots that
  start in H2.
- Tests: unit tests for the split and rounding (incl. the worked example), H1
  finalisation gate, reinstatement and late-joiner cases; live verification on the
  local stack.
- Does **not** affect Pick 5 or Last Man Standing.

## 12. Owner decisions required (summary)

1. Approve the 40 / 40 / 20 split (or choose another).
2. Pots starting in H2 (§3).
3. Pots ending before GW38 (§3).
4. H1 calculated before or after fixed fees (§6).
5. Late joiners: full fee or pro-rata (§7) — and the entry-window decision itself.
6. Removal: keep the entry in the pool or void it (§8).
7. Postponement cut-off for finalising a half (§9).
8. Curtailed-season admin action: build now or handle manually (§9).
