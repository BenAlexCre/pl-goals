# SPECIFICATION (RECOMMENDED) — Score Predictor two-halves prizes (40 / 40 / 20)

**Status: PENDING OWNER APPROVAL. Not a business rule. Not implemented.** Payout logic
is unchanged until the owner approves. On approval, the agreed rules move into
[business-rules.md](../business-rules.md) and this file is marked superseded (kept for
history).

Version 2 — 2026-11-02 (v1 was the initial proposal earlier the same day). Each rule
is labelled:

- **[RULE]** — follows from the 40 / 40 / 20 structure the owner chose, or from
  existing platform rules. Recommended as written.
- **[OWNER DECISION n]** — a genuine choice. A recommendation is given, but **nothing
  is assumed** until the owner decides.

---

## 0. Deadline (from production's fixture schedule, read 2026-11-02)

| Milestone | Date (UTC) |
|---|---|
| GW17 / GW18 (holiday fixtures) | 26 Dec / 29 Dec 2026 |
| **GW19 picks deadline** | **Fri 1 Jan 2027, 19:45** |
| GW19 last kickoff (H1 could finalise ~2 h later) | Sun 3 Jan 2027, 16:30 |
| GW20 deadline (H2 starts) | Tue 5 Jan 2027, 19:15 |

- **Hard deadline:** the H1 finalisation code must be in production before GW19's last
  match finishes (3 Jan 2027, ~18:30 UTC) to pay H1 on time.
- **Recommended deploy-by date: Monday 21 December 2026** — after a full local test
  cycle and one live gameweek (GW16, 19–21 Dec) for verification, before the holiday
  fixture congestion, and without deploying during a gameweek.
- **Decisions needed by: ~30 November 2026** to leave about three weeks to build and
  test (estimate: 3–5 working days of engineering plus verification).
- If missed, H1 can be finalised retrospectively once deployed (the rules below don't
  depend on running exactly at the boundary).

## 1. Today's behaviour (verified in code)

- `predictor_cycle_mode = 'two_halves'` (the default for every new Score Predictor pot)
  and `single_cycle` pay **identically**: one season-end prize.
- One cumulative standings table; ties broken by points → exact scores → correct
  goalscorers → equal split.
- `awardPrize()`: gross = `entry_fee` × non-void entries; admin and charity fees (fixed
  or % of gross) give net; net ÷ winners, each share floored to the cent; leftover cents
  unallocated; one settled `pot_prizes` row; idempotent; one notification per winner.
- Unpaid entries in pots with a fee are voided at settlement (free pots: ISSUE-86); an
  admin can reinstate.
- **Production today:** no real player has a Score Predictor pot (all three are test
  pots), so these rules affect future competitions only.

## 2. The three prizes

| Prize | Share | Won by | Scored over |
|---|---|---|---|
| **First-half winner (H1)** | 40 % | Highest H1 points | Gameweeks 1–19 |
| **Second-half winner (H2)** | 40 % | Highest H2 points | Gameweeks 20–38 |
| **Overall winner** | 20 % | Highest total points | The whole competition |

- **[RULE]** Points per prediction are exactly as today (per-pot configurable
  exact-score / correct-result / goalscorer points). H1 and H2 points are the same
  points, counted by the gameweek the fixture belongs to; Overall = H1 + H2.
- **[RULE]** One player may win any combination (e.g. H1 and Overall).
- **[RULE]** The overall table shown today becomes the Overall table; two half tables
  are added. No points are reset or lost — H2 simply starts its own count.

## 3. Gameweek boundaries

- **[RULE]** H1 = Premier League gameweeks **1–19**, H2 = **20–38**, by
  `gameweeks.number` in the pot's league and season.
- **[RULE]** A fixture counts toward the half of **its own gameweek**, even if it is
  played on a date inside the other half (rescheduling never moves a fixture between
  halves).
- **[OWNER DECISION 1] Pots that start in the second half** (start gameweek ≥ 20).
  (a) H1's 40 % goes to the H2 winner (0 / 80 / 20). (b) It goes to Overall (0 / 40 / 60).
  (c) Such pots can't be created as two-halves (they become single-cycle).
  **Recommendation: (c)** — simplest to explain; the create-pot form already knows the
  start gameweek.
- **[OWNER DECISION 2] Pots that end before GW38** (custom `end_gameweek_id`).
  (a) H2 runs from GW20 to the end gameweek. (b) Two-halves pots must end at GW38.
  **Recommendation: (b)** — a "half" shorter than the other is confusing. (A pot ending
  before GW20 would have no H2 at all.)

## 4. Prize allocation

Definitions are unchanged from today: **gross** = entry fee × non-void entries;
**net** = gross − admin fee − charity fee.

- **[RULE] H1 prize** = 40 % of the net pool **at the moment H1 is finalised**.
- **[RULE] Season-end prizes** use the final pool minus what H1 already paid:
  `remaining = final net − H1 paid`; **H2 = ⅔ × remaining**, **Overall = ⅓ × remaining**.
  With an unchanged pool this is exactly 40 / 40 / 20. If the pool grows after H1 (late
  joiners), the growth is shared by H2 and Overall in the same 2 : 1 ratio. H1 is never
  clawed back.
- **[RULE]** Fees are never taken twice: total payouts always equal the final net — the
  same total a single-payout pot pays.
- **[OWNER DECISION 3] Is H1 calculated before or after fixed fees?**
  (a) After all fees at H1 time — simple, but a fixed fee then comes mostly out of H1.
  (b) Before fixed fees: H1 = 40 % × (gross − percentage fees only); fixed fees come out
  of the season-end remainder.
  **Recommendation: (b)** — a fixed fee meant for the whole season shouldn't fall
  mostly on H1.
- **[RULE]** Ties within a prize split that prize equally; each share is floored to the
  cent; leftover cents stay unallocated and are recorded (as today).
- **[RULE]** A prize with no eligible winner (e.g. every entry void) isn't paid; its
  amount carries forward (H1 → season-end remainder; season-end → recorded unallocated).
- **[RULE]** Free pots (€0): all prizes are €0 and are still recorded, so winners are
  shown and notified.

**Worked example.** 10 entries × €20 = €200 gross; 10 % admin fee (a percentage fee, so
decision 3 doesn't change the numbers) → net €180.
H1 = 40 % × €180 = **€72**. At season end: remaining = €180 − €72 = €108; H2 = €72
(two tied winners → **€36 each**); Overall = **€36**. Total paid €180.

## 5. Tiebreakers

- **[RULE]** Within each prize, the **existing** hierarchy, computed over that prize's
  gameweeks only: total points → number of exact scores → number of correct
  goalscorers → equal split between those still tied.
- **[RULE]** No new tiebreak (no head-to-head, no earliest-entry). Equal split is
  already the final tiebreak in all three game modes.

## 6. Eligibility

- **[RULE]** An entry is eligible for a prize if it is **not void when that prize is
  finalised** — today's settlement rule, applied per prize.
- **[RULE]** One season entry (and, in pots with a fee, one season payment) covers all
  three prizes.
- **[RULE]** An entry reinstated after being voided (Late Payment Override) is eligible
  for prizes **not yet finalised**; prizes already finalised stand.
- **[RULE]** Picks of a void entry earn no points (existing rule).

## 7. Late entrants

Tied to the separate, still-open **entry-window** decision
([finalisation-status.md § 10](../finalisation-status.md#10-product-decisions), item 4).

- **[OWNER DECISION 4] Can players join mid-season?**
  (a) Yes, as today: a late joiner scores only from gameweeks after joining (no
  retroactive predictions) and is eligible for every prize not yet finalised.
  (b) No: joining closes at the deadline of the pot's start gameweek (as in Last Man
  Standing).
  **Recommendation: (a) with a cut-off at the GW19 deadline** — joiners after that can't
  compete for H1 in any meaningful way and would only dilute H1 money they can't win.
- **[OWNER DECISION 5] Fee for late joiners** (pots with a fee).
  (a) Full season fee. (b) Pro-rata.
  **Recommendation: (a) full fee** — the app never handles money; pro-rata would be an
  off-platform arrangement the app can't verify.

## 8. Withdrawals

There is no self-withdrawal today; only a pot admin can remove a member.

- **[RULE]** A removed or withdrawn player is ineligible for every prize not yet
  finalised. Prizes they already won stand.
- **[OWNER DECISION 6] Does a removed player's entry stay in the prize pool?**
  (a) Keep it in gross (their fee was collected; any refund is off-platform).
  (b) Void it (shrinks the pool).
  **Recommendation: (a)** — the pool players were shown doesn't shrink unexpectedly;
  refunds are the organiser's call outside the app.
- **[OWNER DECISION 7] Self-withdrawal** — should players be able to leave a
  competition themselves (a new feature)? **Recommendation:** not for this release.

## 9. Incomplete seasons

- **[RULE] Postponed fixtures** belong to their original gameweek and half (§3). A half
  isn't finalised while one of its fixtures is postponed — subject to decision 8.
- **[OWNER DECISION 8] Postponement cut-off** for finalising a half.
  (a) Wait indefinitely. (b) After a cut-off, ignore still-unplayed fixtures for that
  half's prize.
  **Recommendation: (b)** — cut-off = the GW21 deadline for H1 (16 Jan 2027 14:45 UTC
  this season), the season's final day for H2 — so one postponement can't hold H1 open
  for months.
- **[RULE] Cancelled / awarded fixtures** earn no points (as today).
- **[RULE] Season curtailed or abandoned:** H2 and Overall are finalised on the
  gameweeks completed by an admin-confirmed end date. This needs an admin action that
  doesn't exist yet; until it's built, such a case is handled manually and documented.

## 10. Finalisation

- **[RULE] H1** is finalised by `settle-gameweek` once the GW19 deadline has passed and
  every H1 fixture is finished, cancelled or past the decision-8 cut-off.
- **[RULE] H2 and Overall** are finalised together at season end, exactly as today's
  single prize.
- **[RULE]** Each prize writes its own settled `pot_prizes` row (new scopes, e.g.
  `half_1`, `half_2`, `season`), idempotently: a finalised prize is never re-awarded by
  a later run. Each winner gets a `predictor.prize_awarded` notification naming the
  prize.
- **[RULE]** After H1 is finalised, its winners and amounts are shown permanently on the
  pot page; the H2 and Overall tables are live.
- **[RULE]** Corrections after finalisation are admin-only and audited (same pattern as
  Late Payment Override); never automatic.

## 11. Engineering outline (for estimating — not started)

Schema: `pot_prizes.scope` values for halves (migration). Engine: half-scoped standings,
an H1 finalisation in `PredictorEngine.settle()`, the §4 split and rounding, decision-8
cut-off. UI: half tables, H1 result banner, create-pot validation for decisions 1–2.
Tests: the worked example, rounding, ties, reinstatement, late joiners, postponement
cut-off. **Acceptance tests are already written and skipped** in
`supabase/functions/_shared/game-engine/predictor/twoHalves.acceptance.test.ts`; they are
enabled when the rules are approved and the calculation exists. Pick 5 and Last Man
Standing are not affected.

## 12. Owner decisions required (summary)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Pots starting in H2 | Not allowed as two-halves |
| 2 | Pots ending before GW38 | Two-halves pots must end at GW38 |
| 3 | H1 before or after fixed fees | Before fixed fees |
| 4 | Mid-season joining | Allowed until the GW19 deadline |
| 5 | Late-joiner fee | Full fee |
| 6 | Removed player's entry in the pool | Keep it in the pool |
| 7 | Self-withdrawal feature | Not this release |
| 8 | Postponement cut-off | GW21 deadline for H1; season end for H2 |

Plus approval of the [RULE] items as written.
