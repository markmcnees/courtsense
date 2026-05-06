# Merge Audit Report

Generated: 2026-05-06T12:51:55.432Z
Source: Firebase RTDB `leon-beach-volleyball-default-rtdb` (read-only)

## Database structure observations

- `tally_kotb_pickup/results` does NOT exist as a top-level path. Pickup results live nested at `tally_kotb_pickup/events/{eventId}/results/{resultId}`.
- All result records reference players via per-section `t1`/`t2` arrays of player IDs (NOT names). Name lookup is via the corresponding `players/{pid}/name` field.
- Per-section player ID namespaces: `tally_kotb/kings/players`, `tally_kotb/queens/players`, `tally_kotb_pickup/players`, plus per-event embedded `tally_kotb_pickup/events/{eventId}/players` (event-scoped player IDs).
- Pickup rating record keys are snake_case lowercase of the player display name (e.g. `Mark McNees` -> `mark_mcnees`, `Jasun` -> `jasun`).
- Archive at `tally_kotb/archive/Season 2026/{kings|queens}/results` mirrors the live shape and may contain historical results that reference orphan-named players.

## Pickup events present: 1
- `emofq6goqm43` (Pickup, Apr 26, 2026-04-26) — 4 players, 7 results

## Archive seasons present: Season 2026

## Jasun → Jasun Burdick (MERGE)

### Rating records (`tally_kotb_pickup/ratings/`)
- Orphan key `jasun` EXISTS. Top-level fields: gamesPlayed, history, lastUpdated, name, peakRating, peakRatingDate, rating, rd, volatility
  - rating=1671.2775591458833 rd=171.080136652941 gp=8 wins=? losses=? history_entries=7
- Canonical key `jasun_burdick` EXISTS. Top-level fields: gamesPlayed, history, lastUpdated, name, peakRating, peakRatingDate, rating, rd, volatility
  - rating=1833.4416750954354 rd=145.29989088578503 gp=13 wins=? losses=? history_entries=13

### Player profile records by exact name match
- `tally_kotb/kings/players` — orphan "Jasun": `pmnovf8qc7or`; canonical "Jasun Burdick": none
- `tally_kotb/queens/players` — orphan "Jasun": none; canonical "Jasun Burdick": none
- `tally_kotb_pickup/players` — orphan "Jasun": none; canonical "Jasun Burdick": none
- `tally_kotb_pickup/events/*/players` — orphan "Jasun" in events: none
- `tally_kotb_pickup/events/*/players` — canonical "Jasun Burdick" in events: none

### Game result references (counts by path, matched on player ID)
- `tally_kotb/kings/results` — orphan refs: 20 (e.g. `rmnp8a6zcsf2`, `rmnp8zj85wwj`, `rmnp9jwu72iw`); canonical refs: 0
- `tally_kotb/queens/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb_pickup/events/*/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb/archive/*` — orphan refs: 0; canonical refs: 0
  - `tally_kotb/archive/Season 2026/kings`: orphan players=0 (refs 0); canonical players=1 (refs 0)
  - `tally_kotb/archive/Season 2026/queens`: orphan players=0 (refs 0); canonical players=0 (refs 0)

**Total orphan game refs needing re-pointing: 20**
Total canonical refs (for context): 0

## Jimmy → Jimmy McQuigg (MERGE)

### Rating records (`tally_kotb_pickup/ratings/`)
- Orphan key `jimmy` EXISTS. Top-level fields: gamesPlayed, history, lastUpdated, name, peakRating, peakRatingDate, rating, rd, volatility
  - rating=1863.3782548237639 rd=182.24568603357275 gp=6 wins=? losses=? history_entries=6
- Canonical key `jimmy_mcquigg` EXISTS. Top-level fields: gamesPlayed, history, lastUpdated, name, peakRating, peakRatingDate, rating, rd, volatility
  - rating=1464.945783519476 rd=190.1150237563374 gp=6 wins=? losses=? history_entries=6

### Player profile records by exact name match
- `tally_kotb/kings/players` — orphan "Jimmy": `pmnyyxajkwqs`; canonical "Jimmy McQuigg": none
- `tally_kotb/queens/players` — orphan "Jimmy": none; canonical "Jimmy McQuigg": none
- `tally_kotb_pickup/players` — orphan "Jimmy": none; canonical "Jimmy McQuigg": none
- `tally_kotb_pickup/events/*/players` — orphan "Jimmy" in events: none
- `tally_kotb_pickup/events/*/players` — canonical "Jimmy McQuigg" in events: none

### Game result references (counts by path, matched on player ID)
- `tally_kotb/kings/results` — orphan refs: 12 (e.g. `rmnz8cctu8nq`, `rmnz90dkuvvu`, `rmnza0x5uxu6`); canonical refs: 0
- `tally_kotb/queens/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb_pickup/events/*/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb/archive/*` — orphan refs: 0; canonical refs: 0
  - `tally_kotb/archive/Season 2026/kings`: orphan players=0 (refs 0); canonical players=0 (refs 0)
  - `tally_kotb/archive/Season 2026/queens`: orphan players=0 (refs 0); canonical players=0 (refs 0)

**Total orphan game refs needing re-pointing: 12**
Total canonical refs (for context): 0

## Mark → Mark McNees (MERGE)

### Rating records (`tally_kotb_pickup/ratings/`)
- Orphan key `mark` EXISTS. Top-level fields: gamesPlayed, history, lastUpdated, name, peakRating, peakRatingDate, rating, rd, volatility
  - rating=1180.5355032190648 rd=183.40960890174816 gp=7 wins=? losses=? history_entries=6
- Canonical key `mark_mcnees` EXISTS. Top-level fields: gamesPlayed, history, lastUpdated, name, peakRating, peakRatingDate, rating, rd, volatility
  - rating=1657.1990995771412 rd=216.08882575405266 gp=7 wins=? losses=? history_entries=7

### Player profile records by exact name match
- `tally_kotb/kings/players` — orphan "Mark": `pmnovehn1ftd`; canonical "Mark McNees": none
- `tally_kotb/queens/players` — orphan "Mark": none; canonical "Mark McNees": none
- `tally_kotb_pickup/players` — orphan "Mark": none; canonical "Mark McNees": `mark_mcnees`
- `tally_kotb_pickup/events/*/players` — orphan "Mark" in events: `emofq6goqm43` ids: `pmofq6goqea9`
- `tally_kotb_pickup/events/*/players` — canonical "Mark McNees" in events: none

### Game result references (counts by path, matched on player ID)
- `tally_kotb/kings/results` — orphan refs: 24 (e.g. `rmnp8a6zcsf2`, `rmnp8zj85wwj`, `rmnp9jwu72iw`); canonical refs: 0
- `tally_kotb/queens/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb_pickup/events/*/results` — orphan refs: 7; canonical refs: 0
- `tally_kotb/archive/*` — orphan refs: 0; canonical refs: 7
  - `tally_kotb/archive/Season 2026/kings`: orphan players=0 (refs 0); canonical players=1 (refs 7)
  - `tally_kotb/archive/Season 2026/queens`: orphan players=0 (refs 0); canonical players=0 (refs 0)

**Total orphan game refs needing re-pointing: 31**
Total canonical refs (for context): 7

## Jeff → Jeff Rogers (RENAME)

### Rating records (`tally_kotb_pickup/ratings/`)
- Orphan key `jeff` EXISTS. Top-level fields: gamesPlayed, history, lastUpdated, name, peakRating, peakRatingDate, rating, rd, volatility
  - rating=1559.3759112936998 rd=121.73137335523528 gp=18 wins=? losses=? history_entries=18
- Canonical key `jeff_rogers` does NOT exist

### Player profile records by exact name match
- `tally_kotb/kings/players` — orphan "Jeff": `pmnoveqf16qp`; canonical "Jeff Rogers": none
- `tally_kotb/queens/players` — orphan "Jeff": none; canonical "Jeff Rogers": none
- `tally_kotb_pickup/players` — orphan "Jeff": none; canonical "Jeff Rogers": none
- `tally_kotb_pickup/events/*/players` — orphan "Jeff" in events: none
- `tally_kotb_pickup/events/*/players` — canonical "Jeff Rogers" in events: none

### Game result references (counts by path, matched on player ID)
- `tally_kotb/kings/results` — orphan refs: 18 (e.g. `rmnp8a6zcsf2`, `rmnp8zj85wwj`, `rmnp9jwu72iw`); canonical refs: 0
- `tally_kotb/queens/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb_pickup/events/*/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb/archive/*` — orphan refs: 0; canonical refs: 0
  - `tally_kotb/archive/Season 2026/kings`: orphan players=0 (refs 0); canonical players=0 (refs 0)
  - `tally_kotb/archive/Season 2026/queens`: orphan players=0 (refs 0); canonical players=0 (refs 0)

**Total orphan game refs needing re-pointing: 18**
Total canonical refs (for context): 0

## Ian → Ian Coxey (RENAME)

### Rating records (`tally_kotb_pickup/ratings/`)
- Orphan key `ian` EXISTS. Top-level fields: gamesPlayed, history, lastUpdated, name, peakRating, peakRatingDate, rating, rd, volatility
  - rating=879.4946212394574 rd=198.6862488931952 gp=7 wins=? losses=? history_entries=6
- Canonical key `ian_coxey` does NOT exist

### Player profile records by exact name match
- `tally_kotb/kings/players` — orphan "Ian": `pmot5gvxya7o`; canonical "Ian Coxey": none
- `tally_kotb/queens/players` — orphan "Ian": none; canonical "Ian Coxey": none
- `tally_kotb_pickup/players` — orphan "Ian": none; canonical "Ian Coxey": none
- `tally_kotb_pickup/events/*/players` — orphan "Ian" in events: none
- `tally_kotb_pickup/events/*/players` — canonical "Ian Coxey" in events: none

### Game result references (counts by path, matched on player ID)
- `tally_kotb/kings/results` — orphan refs: 6 (e.g. `rmot7z7c6ljj`, `rmot8hc84asy`, `rmot950cprzo`); canonical refs: 0
- `tally_kotb/queens/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb_pickup/events/*/results` — orphan refs: 0; canonical refs: 0
- `tally_kotb/archive/*` — orphan refs: 0; canonical refs: 0
  - `tally_kotb/archive/Season 2026/kings`: orphan players=0 (refs 0); canonical players=0 (refs 0)
  - `tally_kotb/archive/Season 2026/queens`: orphan players=0 (refs 0); canonical players=0 (refs 0)

**Total orphan game refs needing re-pointing: 6**
Total canonical refs (for context): 0

## Anomalies & cross-checks

### All pickup rating keys
```
amanda_haire
bruna_olivera
chris_nguyen
connor_mosley
courtney_young
elka_mykolaishyn
gabrielle_isgar
ian
jack_rouch
jasun
jasun_burdick
jeff
jennifer_bendfelt
jesse_rouse
jessica_stewart
jimmy
jimmy_mcquigg
juliet_wainwright
kate_erickson
kendra_briggs
lauren_nable
lia_ekendahl
marina_petrandis
mark
mark_mcnees
mia_ledford
naomi_granger
quinn_mccaffrey
robbie_stewart
samantha_kempner
savannah_bailey
stanislav_kuzub
yonnie_sanford
zahaida_smith
```

### Orphan-canonical co-occurrence in same pickup event
- "Jasun" / "Jasun Burdick" never co-occur in same event — consistent with same-person duplicate.
- "Jimmy" / "Jimmy McQuigg" never co-occur in same event — consistent with same-person duplicate.
- "Mark" / "Mark McNees" never co-occur in same event — consistent with same-person duplicate.
- "Jeff" / "Jeff Rogers" never co-occur in same event — consistent with same-person duplicate.
- "Ian" / "Ian Coxey" never co-occur in same event — consistent with same-person duplicate.

## Critical findings the brief did not anticipate

These warrant explicit decisions before the migration script is written.

### 1. Rating histories store names, not IDs

Inspected `tally_kotb_pickup/ratings/mark` and `mark_mcnees`. Each `history/{gameId}` entry contains:

```
{ opponent1, opponent2?, partner?, opponentScore, score, ratingBefore, ratingAfter,
  ratingChange, rdBefore, rdAfter, source, timestamp, won }
```

`opponent1`, `opponent2`, and `partner` are **display name strings** (e.g. `"Jasun"`, `"Ian"`, `"Jesse Rouse"`, `"Jimmy"`). They are NOT player IDs. Implication: after merging Mark → Mark McNees, every OTHER player's rating history still contains opponent/partner strings like `"Mark"` referring to the same person. To present clean history downstream, the migration may also need to rewrite opponent/partner name strings in every rating record's history. This was not in the brief — please decide:

- (a) Leave other players' opponent/partner names alone (history stays "as it was logged"), or
- (b) Rewrite opponent/partner display names across all rating histories so historical entries also show the canonical name.

### 2. Pickup ratings are the unified rating system, fed by `league_kings`

Every history entry has `"source": "league_kings"`. There is only one events node (`emofq6goqm43`) and zero `tally_kotb_pickup/results` data, so essentially all ratings today were derived from kings dual results. The "pickup" name on `tally_kotb_pickup/ratings` is misleading — it functions as the global rating store across kings/queens/pickup. Confirms why a single rating recomputation per merged player is the right approach.

### 3. Orphan/canonical name split is historical, not parallel

Mark McNees's canonical rating contains 7 entries with timestamps `1774997031362..` (~Mar 2026). The orphan `mark` rating contains 7 entries with timestamps `1778021322417..` (~Apr 2026). They are sequential, not interleaved — at some point the kings player record's `name` was changed from `"Mark McNees"` to `"Mark"` (or the player ID was replaced) and subsequent games started bucketing under the short name. Same pattern for Jasun and Jimmy.

### 4. GP totals vs. result reference counts

| Player | Rating GP (orphan + canonical) | Result-path refs |
|---|---|---|
| Jasun | 8 + 13 = 21 | 20 (kings only) |
| Jimmy | 6 + 6 = 12 | 12 (kings only) |
| Mark | 7 + 7 = 14 | 31 (kings 24 + pickup event 7) |
| Jeff | 18 | 18 (kings only) |
| Ian | 7 | 6 (kings only) |

Mark's huge discrepancy (14 GP vs 31 result refs) is suspicious. Possible causes: (a) the orphan `mark` player ID `pmnovehn1ftd` in kings is shared with another person's games that were never rated, (b) some kings results predate rating tracking, or (c) some games were excluded as exhibition (court 6+, per CLAUDE.md). Worth confirming before recompute.

Jasun (21 vs 20) and Ian (7 vs 6) also have minor mismatches — likely same cause.

### 5. Stale `mark_mcnees` profile in `tally_kotb_pickup/players`

`tally_kotb_pickup/players` contains a record keyed `mark_mcnees` whose `name` is `"Mark McNees"`. This is the only canonical-named record in any player profile path. It does not appear in any pickup event's `players` map (events use ephemeral per-event IDs), so it has zero result references. It will likely just remain after the merge. Worth confirming whether to keep, delete, or update.

### 6. Recompute strategy — reuse stored history vs. re-derive from raw

Two options for the Glicko-2 recomputation:

- (a) **Concatenate** the two `history` maps from `mark` and `mark_mcnees`, sort by `timestamp`, and replay using only those entries. Faithful to what was rated, fastest to implement.
- (b) **Re-derive** by walking `tally_kotb/kings/results` and `tally_kotb_pickup/events/*/results` for the canonical's player IDs, building the game list from scratch, looking up opponent names via current player tables, and replaying. This corrects any historical inconsistencies but means writing a bigger replay engine that mirrors the live one in `app.js`.

Brief language ("recompute Glicko-2 from consolidated game history, replayed in chronological order") matches (a). Please confirm.

### 7. `tally_kotb_pickup/results` does not exist

The brief lists this path. It is not present. Pickup results are nested under `tally_kotb_pickup/events/{eventId}/results/{resultId}`. The script will need to walk events instead.

### 8. Live kings player records use short names; archive Season 2026 has the canonical

`tally_kotb/archive/Season 2026/kings/players` has one record with name `"Mark McNees"` (id-unknown, refs 0). The live `tally_kotb/kings/players` has `"Mark"` (id `pmnovehn1ftd`, refs 24). The archive snapshot represents an earlier name state. Recommend: leave archive untouched (it is a historical snapshot — overwriting it would corrupt the record of "what was true at season end") — but flagging in case you want to canonicalize archive too.

## Decisions locked (post-review)

- Finding 1: rewrite opponent/partner display names across all rating histories so historical entries show the canonical name.
- Finding 4: concatenate the two stored history maps for each merged player, sort by `timestamp`, replay through Glicko-2.
- Finding 5: delete the stale `mark_mcnees` record from `tally_kotb_pickup/players`.
- Finding 6: leave archive Season 2026 untouched.
- Finding 7: pickup results live at `tally_kotb_pickup/events/{eventId}/results/{resultId}` — script walks events.

## Follow-ups deferred (out of scope for this migration)

- **League rating gap for weeks 1–3 (April 7–22, 2026)** — kings results from those weeks have no rating history entries. Affects all players, not just merge candidates. Defer until after current cleanup ships.
- **Pre-existing rating history entries for canonical Mark McNees reference game IDs absent from live results** (7 entries dated Feb 27, 2026). Replay uses self-contained history. Do not attempt to validate against source results.
- **Live rating `gamesPlayed` counter is off by 1 in some records.** Observed during dry-run consolidation: Jasun's record claimed `gamesPlayed=8` but had only 7 history entries; Mark's record claimed `gamesPlayed=7` but had only 6 history entries. The migration uses `Object.keys(history).length` (the source-of-truth entry count) for the consolidated `gamesPlayed`. Investigate the rating system's `gamesPlayed` increment logic in `courtsense/ratings.js` after the current cleanup ships.

## Rank changes resulting from the migration (player communication)

The merge-and-replay outcome shifts three ratings noticeably. Worth a heads-up to affected players before they spot it in standings:

| Player | Before (canonical) | After | Direction |
|---|---|---|---|
| Jasun Burdick | 1833 | 1671 | down |
| Jimmy McQuigg | 1465 | 1863 | up |
| Mark McNees | 1657 | 1181 | down |

The two renames (Jeff → Jeff Rogers, Ian → Ian Coxey) keep the same rating numbers; only the displayed name changes.
