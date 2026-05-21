# 4v4 Data Model

Documents the Firebase Realtime Database shape used by `courtsense/4v4/index.html`. Source of truth for future maintenance, schema migrations, and integrations.

## Top-level path

All 4v4 data is namespaced under `tally_4v4/` in the existing `leon-beach-volleyball` Firebase project (the same project that hosts `tally_kotb/` and `tally_kotb_pickup/`).

Reusing the project keeps Firebase billing consolidated and the Cloudflare AI Worker (`leon-beach-ai.markmcnees-479.workers.dev`) the same.

## Division isolation

The 4v4 product runs two parallel leagues (Recreational and Competitive) under one app. Each division is fully isolated under its own subtree:

```
tally_4v4/
  rec/
    config/
    teams/
    schedule/
    scheduleMeta/
    results/
    archive/
  comp/
    config/
    teams/
    schedule/
    scheduleMeta/
    results/
    archive/
```

The app tracks the active division in a `DIV` variable (`'rec'` or `'comp'`). All reads and writes are prefixed `DIV + '/'`. Side-effect of this isolation: deleting all Rec data has zero impact on Comp, and the schedule lock state, team roster, results, and standings are per-division.

The Rec/Comp header toggle just flips the `DIV` variable and re-renders. The `body.comp` CSS class swaps the primary color theme from cyan to red.

## Subtrees

### `tally_4v4/{div}/config/`

Reserved for future per-division configuration (e.g., division display name, custom rules). Currently unused; the schedule meta block below holds the only configuration that actually drives behavior.

### `tally_4v4/{div}/teams/{teamId}`

One record per team. The teamId format is `team_{slugified-name}_{6-char-random}`, e.g., `team_sand-vipers_a3f9k2`. Slug is lowercase, alphanumerics + hyphens only, capped at 32 chars.

```json
{
  "id": "team_sand-vipers_a3f9k2",
  "name": "Sand Vipers",
  "captainName": "Jane Doe",
  "captainEmail": "jane@example.com",
  "captainPhone": "850-555-1234",
  "color": "#1a3a6b"
}
```

`name` and `captainName` are required. `captainEmail`, `captainPhone`, `color` may be empty strings. `color` is an optional hex code chosen from a 9-color preset palette.

### `tally_4v4/{div}/schedule/{weekNumber}`

One record per week, keyed by the week number as a string (`"1"`, `"2"`, ... `"8"`). Each week has an array of matchups.

```json
{
  "week": 1,
  "date": "2026-06-08",
  "matchups": [
    {
      "id": "m_w1_r1_c1",
      "teamAId": "team_sand-vipers_a3f9k2",
      "teamBId": "team_beach-bums_b7e1m4",
      "court": 1,
      "round": 1
    },
    ...
  ]
}
```

`date` is the league night date in ISO format. The schedule generator computes it as `startDate + (week - 1) * 7 days`. Weekly Monday cadence; no holiday skip support in v1.

### Matchup ID format

`m_w{week}_r{round}_c{court}`

Examples: `m_w1_r1_c1`, `m_w3_r2_c4`.

This ID is synthesized at schedule-generation time and again on any per-matchup swap. It serves as the key into `results/` once a score is recorded. Important properties:

- Stable within a season as long as week, round, and court don't change.
- Unique within a week (the schedule generator and the swap modal both enforce uniqueness).
- If a swap changes the court or round, the matchup ID changes. The swap modal hard-blocks the swap if a result already exists for the old ID, preventing orphan results.

### `tally_4v4/{div}/scheduleMeta/`

A single object holding schedule-level metadata.

```json
{
  "generatedAt": 1717852800000,
  "locked": true,
  "weekCount": 8,
  "courtCount": 4,
  "matchesPerCourt": 2,
  "startDate": "2026-06-08"
}
```

`locked: true` indicates a schedule exists and the UI should treat it as authoritative. The admin "Regenerate Schedule" button shows a destructive confirm; if any results exist, a second confirm warns about wiping them.

The presence of `scheduleMeta.locked === true` also drives the Admin tab card reorder: Score Entry rises to the top of the Admin tab once the schedule is locked, because Score Entry becomes the daily-use card during the season.

### `tally_4v4/{div}/results/{matchupId}`

One record per recorded result. Keyed by the matchup ID from the schedule.

```json
{
  "weekNumber": 3,
  "teamAId": "team_sand-vipers_a3f9k2",
  "teamBId": "team_beach-bums_b7e1m4",
  "sets": [
    { "a": 21, "b": 18 },
    { "a": 19, "b": 21 },
    { "a": 15, "b": 12 }
  ],
  "winnerId": "team_sand-vipers_a3f9k2",
  "isForfeit": false,
  "recordedAt": 1717939200000
}
```

Best-of-3 match:
- Set 1 and Set 2 score to 21, capped at 23 (rally scoring, win by 2, hard cap at 23). The UI clamps inputs on blur.
- Set 3 scores to 15, capped at 17.
- Match winner is the first team to win 2 sets.

`sets` always has 2 or 3 entries for a non-forfeit result. For a forfeit, `sets` is an empty array, `isForfeit` is true, and `winnerId` records which team was awarded the win.

`recordedAt` is the millisecond timestamp at which the result was saved. Useful for sorting in the Team Detail modal when multiple matches share a week number.

### `tally_4v4/{div}/archive/{label}/`

Reserved for end-of-season archival. The current build does not yet wire an "Archive Season" admin action; this subtree is allocated for the future season-rollover feature. Expected shape on archive will mirror the live subtree under a timestamp or label key.

## Cross-cutting behavior

### Standings calculation

Per-team stats are computed in memory from `results/`:

- Non-forfeit match: winner +1 W, loser +1 L. Per-set point totals roll into `ptsFor` / `ptsAgainst`. Per-set wins roll into `setsW` / `setsL`.
- Forfeit: winner +1 W, loser +1 L. Zero impact on sets and points.
- Sort: W desc, then Set Diff (setsW minus setsL) desc, then Pt Diff (ptsFor minus ptsAgainst) desc, then team name asc.

Top three ranks render in gold, silver, bronze.

### Schedule generation prompt

The schedule generator POSTs to the Cloudflare Worker with `model: claude-sonnet-4-20250514`, `max_tokens: 8000`. The prompt assigns short team IDs (T1, T2, ...) to keep the payload compact and the model output clean. The response is a JSON array of weeks; the parser strips markdown fences, slices first `[` to last `]`, and JSON.parses. Short IDs are mapped back to real team IDs on the client. Bad matchups (invalid ID, A equals B, missing court or round) are dropped with a toast warning.

### Per-matchup swap

Admin can reassign Team A, Team B, court, or round on any single matchup via a pencil icon in the Admin Schedule preview. Hard-blocked if a result already exists for that matchup ID. Soft-warned (JS confirm) if either reassigned team is already booked in the same round on a different court that week.

### Admin session

Admin actions are PIN-gated (PIN `8675`). After successful entry, a 60-minute session is granted via the `_pinAdminUntil` timestamp. The admin tab shows a lock screen if the session has expired, with an "Enter PIN" button that re-prompts. All write paths additionally check the session via `requireAdmin()` and re-prompt if expired.

### Client-side data sync

A single `db.ref(DB_ROOT).on('value', ...)` listener pulls the entire `tally_4v4/` subtree on any change. The client mirrors both divisions in an in-memory `D` object and re-renders the active tab on every snapshot. Writes are fire-and-forget (no awaits) via small `fbSet` / `fbDel` wrappers; this pattern is required for reliable behavior given that Firebase promises do not reliably resolve in this deployment environment.

### In-progress score entry persistence

Score entry drafts persist in `sessionStorage` under three key shapes:

- `4v4_se_week_{div}`: which week pill is selected, per division.
- `4v4_se_open_{div}`: which matchup id has an open score form, per division.
- `4v4_se_{div}_{matchupId}`: the in-progress set values for that matchup.

Drafts survive division toggles, page reloads, and Firebase listener re-fires. They are cleared on Save, Forfeit, Delete, or Cancel. The hydration priority on form render is draft, then saved result, then blank.

## Things deliberately NOT in the data model (v1)

- Player-level rosters. Teams only; the on-site staff handles individual sign-ins.
- Player accounts. No auth beyond the admin PIN.
- Ratings integration. No linkage to `tally_kotb_pickup/players/`.
- Coed gender enforcement.
- Playoffs or brackets. Regular-season standings decide everything.
- Time slots. Matchups have round and court, no clock time. Round 1 implies the first match of the night, Round 2 the second.

These are all candidates for future iterations.
