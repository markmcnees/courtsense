# Data hygiene followups

A running list of non-blocking data hygiene items in the CourtSense Firebase namespaces (`tally_kotb` and `tally_kotb_pickup`). Items here are tracked but not urgent. The canonical task tracker is the `Bugs & Issues` tab of `docs/courtsense_project_plan.xlsx`; this doc captures the items that benefit from prose context (rationale, dependencies, scope) which a spreadsheet row cannot carry well.

When picking up an item, link the eventual fix-script PR back here from the entry. When an item is resolved, leave the entry with a `**Resolved:**` note and the date so the historical context survives.

---

## Open

### Email backfill on pickup/players records

**Status:** open as of 2026-05-07
**Path:** `tally_kotb_pickup/players/`

Two adjacent gaps to close before the per-player auth rollout (D.40, password generated at admin approval and delivered via the email worker) can ship to the full active roster:

1. **Existing pickup/players records lack the `email` field.** Records like `bruna_olivera`, `amanda_haire`, and others were created before the welcome-email path required email-on-file. They render fine in the pickup app today but cannot receive a generated password through the worker until an email is on file.

2. **Roughly 25 active players in `tally_kotb/kings/players` and `tally_kotb/queens/players` have no record in `tally_kotb_pickup/players/` at all.** The pickup roster is sparse by design (it is populated when a player joins a pickup event or registers via the join form), but the auth rollout treats `tally_kotb_pickup/players/{snake_case_key}` as the canonical home for `email`, `passwordHash`, `notificationsEnabled`, and `updatedAt`. Players who only exist in the league rosters need a pickup-side record before they can be onboarded into the auth flow.

**When to act:** once email collection is further along (waiting on a profile editor that lets players supply their own email rather than relying on admin entry) and the courtsense-email-worker is deployed (gated on the three steps in `docs/state.md` § courtsense-email-worker).

**Pattern to follow:** `scripts/add-player-emails.ts` (the 2026-05-07 five-player bootstrap) is the template. Same dry-run-first, plan-then-execute, pre-flight-check shape. For the league-rosters-to-pickup gap, the script will need a name-based join from `tally_kotb/{kings,queens}/players` into snake_case keys via the `ratingKey()` helper from `scripts/merge-players.ts`, with a defensive collision check before any PUT.

**Out of scope for the current bootstrap:** the 2026-05-07 run only addressed five named players (`mia_ledford`, `courtney_young`, `jeff_rodgers`, `jesse_rouse`, `jasun_burdick`) who needed password bootstrap immediately. The broader backfill is deliberately deferred until the prerequisites above are met.

---

## Resolved

(none yet)
