# CC Brief: Build the 4v4 League App

## Working directory

Start by running:

```
cd C:\Users\mmcnees\Documents\courtsense
```

Do not assume you are already in this directory. Confirm by running `pwd` (or `cd` with no args on Windows) before any file operations.

## Hard guardrails

- No git commits without explicit authorization from Mark.
- No git pushes without explicit authorization from Mark.
- No destructive Firebase operations (no deleting existing namespaces, no touching `tally_kotb/` or `tally_kotb_pickup/` data).
- No build tools, no npm, no frameworks. Vanilla JS plus Firebase SDK from CDN.
- Single-file HTML pattern (everything in `index.html`).
- No em dashes anywhere in code or copy. Use periods, semicolons, commas, or parentheses.
- Ask one question at a time if you need clarification. Default to building based on this brief.
- Save your work brief to `docs/cc-brief-4v4-build.md` in the courtsense repo before starting, so there's an audit trail.

## Goal

Build a single-file HTML app at `courtsense/4v4/index.html`, served at `courtsense.app/4v4/`, that manages two parallel 4v4 beach volleyball leagues (Rec and Competitive) for the City of Tallahassee summer season starting June 8, 2026.

Ship target: May 25 to June 1, 2026.

## What this app does

1. Displays the weekly round-robin schedule for both divisions.
2. Lets an admin enter match scores after each Monday night.
3. Shows W/L standings, with set differential and point differential as extra info.
4. Stores everything in Firebase Realtime Database for live sync.

## What this app does NOT do (v1)

- No player-level rosters. Teams only, plus captain contact info.
- No player accounts, no player login, no player score entry.
- No ratings integration. No `tally_kotb_pickup/players/` linkage.
- No coed gender enforcement (on-site staff handles that).
- No playoffs or brackets (regular season standings decide everything).

## Tech stack

- Single-file HTML at `courtsense/4v4/index.html`
- Vanilla JS, no build tools
- Firebase SDK v10.8.0 compat builds via CDN (match the KotB app)
- Google Fonts: Bebas Neue (headings), Barlow (body)
- Phone-first responsive design

## Firebase configuration

Reuse the existing `leon-beach-volleyball` Firebase project. Namespace under `tally_4v4`:

```javascript
const FB_CFG = {
  apiKey: "AIzaSyC8Ue06XPvGXo1XTloewPvDRBWtK5tDAj8",
  authDomain: "leon-beach-volleyball.firebaseapp.com",
  databaseURL: "https://leon-beach-volleyball-default-rtdb.firebaseio.com",
  projectId: "leon-beach-volleyball",
  storageBucket: "leon-beach-volleyball.firebasestorage.app",
  messagingSenderId: "937804799976",
  appId: "1:937804799976:web:02121e68655b4febeb8e5d"
};

const DB_ROOT = 'tally_4v4';
```

Use fire-and-forget writes (do not await):

```javascript
function fbSet(p,v){ if(db) db.ref(DB_ROOT+'/'+p).set(v); }
function fbDel(p){   if(db) db.ref(DB_ROOT+'/'+p).remove(); }
db.ref(DB_ROOT).on('value', snap => { D = snap.val()||{}; refreshAll(); });
```

This pattern is non-negotiable. Firebase promises do not reliably resolve in this deployment context.

## Data structure

```
tally_4v4/
  rec/
    config/        season settings (startDate, weeks, courts, divisionName)
    teams/         keyed by team ID, each: name, captainName, captainEmail, captainPhone, color (optional)
    schedule/      keyed by week number, each contains matchups[] with teamAId, teamBId, court, timeSlot
    results/       keyed by match ID, each: weekNumber, teamAId, teamBId, sets[{a,b}], winnerId, isForfeit
    archive/       closed seasons keyed by timestamp label
  comp/
    (same structure as rec)
```

Active division tracked in a `DIV` variable (`'rec'` or `'comp'`). All Firebase reads/writes are prefixed `DIV + '/'`.

## Side toggle pattern

Header has a Rec/Comp toggle matching the Kings/Queens pattern from `kotb.html`. Body gets a CSS class (`comp` for example) when Competitive is active, which swaps the primary color scheme. Use:

- Rec: primary `#0891b2` (cyan), dark `#155e75`
- Comp: primary `#dc2626` (red), dark `#991b1b`
- Accent: `#d4a843` (gold), same for both
- Background: `#f5f0e8` (sand)
- Win: `#059669` (green)
- Loss: `#dc2626` (red)

## Match rules (per Lucas Williams, league director)

- Best of 3 sets.
- Set 1 and Set 2 to 21, capped at 23 (rally scoring, win by 2 but cap at 23).
- Set 3 to 15, capped at 17.
- Match winner: first team to win 2 sets.
- Forfeit scored as 1-0 in matches won column. No set scores recorded for a forfeit.

App must enforce these caps during score entry. If admin types 24, clamp to 23. If admin types 16 for set 3, clamp to 17.

## Schedule generation

- Once teams are registered, admin generates a round-robin schedule.
- 8-week season, 4 courts available, 2-3 rounds (matches) per Monday night.
- Up to 10 teams per division (per Lucas).
- A full round-robin for 10 teams is 9 weeks, but season is 8 weeks. AI should generate the optimal partial round-robin (every team plays as many opponents as possible, ideally all 9; if not feasible, balance so no team plays the same opponent more than the minimum needed).
- Schedule generation uses the existing Cloudflare Worker at `https://leon-beach-ai.markmcnees-479.workers.dev`. Same JSON-only response pattern as `genNight()` in `kotb.html`.
- `max_tokens: 8000` on the AI call.

### Schedule lock (critical, learned from KotB)

- After schedule is generated, it locks automatically.
- Regeneration requires admin PIN.
- After the first match result is saved for a season, regeneration is doubly locked (PIN plus an explicit "I understand this wipes all results" confirmation).
- This is to prevent the issue from current KotB season where someone accidentally clicked Generate mid-season and overwrote the partner rotation.

## Admin

- PIN: `8675` (same as KotB).
- PIN required once per session for admin actions; subsequent admin actions in the same session do not re-prompt.
- Admin can: add/edit/delete teams, generate schedule, enter scores, edit/delete past results, archive season.

## UI structure

Three tabs (matching the KotB three-tab pattern):

### Tab 1: Schedule

- Week selector (dropdown or pills).
- For selected week, shows all matchups grouped by round and court.
- Each matchup card shows: Team A vs Team B, court number, time slot, and result if entered (e.g. "2-1, Team A wins" or "Forfeit, Team B wins").
- Captains can see who they play, when, and on which court.

### Tab 2: Standings

- Table columns: Rank, Team, W, L, Sets W, Sets L, Set Diff, Pts For, Pts Against, Pt Diff.
- Sorted by W descending, then Set Diff descending, then Pt Diff descending.
- Lucas confirmed standings rank "just wins and losses" but extra columns are shown for player interest per Mark's preference.
- Gold/silver/bronze color the top 3 rank cells.
- Tap any team row to open a Team Detail modal showing every match they played with result.

### Tab 3: Admin (PIN-gated)

- **Teams card**: add team (name, captain name, captain email, captain phone), edit, delete.
- **Schedule card**: generate schedule button (with lock checks), view generated schedule, regenerate (PIN + confirm).
- **Score entry card**: select week, select match, enter set scores (with cap enforcement), one-tap "Record Forfeit" button per team, save.
- **Edit/Delete past results**: select past match, edit set scores or delete.
- **Archive Season** (PIN + confirm): saves current division data to `tally_4v4/{div}/archive/{timestamp}/` and resets teams/schedule/results.

## Captain contact storage

Each team record includes:

```javascript
{
  id: "team_abc123",
  name: "Sand Vipers",
  captainName: "Jane Doe",
  captainEmail: "jane@example.com",
  captainPhone: "850-555-1234",
  color: "#1a3a6b"  // optional, for visual identification on schedule cards
}
```

Both email and phone are captured per Mark's decision. Either can be blank but the captain name is required.

## Routing

Folder-with-index pattern. File location: `courtsense/4v4/index.html`. Served at `courtsense.app/4v4/`.

No CNAME or DNS changes needed (already in place for courtsense.app).

## Copy style

- No em dashes anywhere. Use periods, semicolons, commas, or parentheses.
- Warm and direct tone.
- League names exactly: "Recreational 4v4" and "Competitive 4v4" (or "Rec" and "Comp" abbreviated in UI chrome).
- Forfeit label: "Forfeit" (not "Default" or "FF").

## File deliverables

1. `courtsense/4v4/index.html` (the app)
2. `docs/cc-brief-4v4-build.md` (this brief, copied into the repo for audit trail)
3. `docs/4v4-data-model.md` (a short doc describing the Firebase data shape, for future reference)

## What to do first

1. Confirm working directory is `C:\Users\mmcnees\Documents\courtsense`.
2. Read the current `kotb/index.html` to understand the patterns being reused (Firebase init, fbSet/fbDel, side toggle, PIN gate, tab structure, CSS variables).
3. Create the `4v4/` folder and stub `index.html` with the basic page structure, Firebase init, and Rec/Comp toggle.
4. Stop and show Mark the stub so he can sanity-check the styling and structure before you build out the three tabs.

Do not attempt to build the entire app in one pass. Build it in stages: scaffold, then Admin tab (so teams can be added), then Schedule tab with AI generation, then Standings tab with score entry. Pause between stages so Mark can review.

## Open questions to flag if they come up

If during the build you discover an ambiguity not covered here, stop and ask Mark in plain English. Examples:
- Time slot format (HH:MM AM/PM versus just round number)
- Whether to display captain contact publicly on Schedule tab or only in Admin tab
- How to handle a team that drops mid-season

Do not guess on these.

---

End of brief.

---

## Build Summary

Built by Claude Code over six staged passes. All work landed in `courtsense/4v4/index.html` as a single-file HTML app (CSS and JS inlined). Final size: ~1620 lines. No external JS dependency beyond the Firebase compat SDK and Google Fonts.

**Stage 1: Scaffold.** Page structure, Firebase init pointed at `tally_4v4`, header with Rec/Comp toggle, three tab shells (Schedule, Standings, Admin), PIN modal, toast, body theming via CSS variables that swap with `body.comp`.

**Stage 2: Teams card.** Add/edit/delete teams. Team color picker with 9 presets. Inline edit (no modal). PIN-gated via the 60-min session.

**Stage 3: Schedule generation.** Cloudflare AI Worker call with `claude-sonnet-4-20250514`, `max_tokens: 8000`. Short-ID mapping (T1..Tn) for compact prompts. Round-robin generation prompt with all six scheduling rules. Lock guard with two-step confirm when results exist. Schedule preview banner with "Looks Right" dismiss. Public Schedule tab with week pills defaulting to current week from start date.

**Stage 4: Score entry, standings, swap.** Score entry with 23/17 cap clamping, two forfeit buttons per matchup, Save / Cancel / Edit / Delete. Per-matchup pencil-icon swap with hard-block on existing results. Standings with W, L, sets W/L, set diff, pts for/against, pt diff. Forfeits affect W/L only. Sort by W → set diff → pt diff. Gold/silver/bronze top three. Team Detail modal showing played + upcoming matches.

**Stage 5: Critical UX hardening.**
- Admin tab card reorder based on `scheduleMeta.locked` (Score Entry moves to top once schedule is locked).
- Cross-court conflict warning on swap (soft confirm if a reassigned team is also booked in the same round on a different court).
- In-progress score entry persistence via `sessionStorage`, keyed per division. Survives division toggles, page reloads, and Firebase listener re-fires. Focus and cursor position preserved across listener-fire re-renders.
- Swap modal: division stored in `_swapCtx`, save aborts if division changed mid-edit.

**Stage 6: Admin isolation.**
- Fixed a CSS specificity bug where `#pane-admin{display:flex}` was overriding `.pane{display:none}`, causing the admin pane to leak into the public Schedule and Standings tabs. Scoped the rule to `#pane-admin.on`.
- Added an admin lock card that replaces the four real admin cards (Teams, Roster, Schedule Generation, Score Entry) when `_pinAdminUntil <= Date.now()`. Driven by a `body.admin-locked` class toggled by `applyAdminLock()` from `refreshAll`, `refreshTab('admin')`, `pinTap` success, and the boot path.

**Final cleanup:** Dead-code removal (`playedIds`, `window._pendingReauth`). Syntax check passes. No em or en dashes. File ends with a newline.

**Companion docs:** `docs/4v4-data-model.md` documents the Firebase shape, matchup ID format, results schema, division isolation behavior, and what is deliberately out of scope for v1.

**Not built (deferred):**
- "Archive Season" admin action. The `tally_4v4/{div}/archive/` subtree is allocated in the data model but no UI flow writes to it yet.
- Holiday skip / makeup-week support.
- Time slots on matchups.
- Player-level rosters or ratings integration.
- Public-facing captain contact display (captains are stored, but only the Admin tab surfaces them).

**Guardrails honored throughout:** No commits, no pushes, no destructive Firebase ops. Single-file HTML. Vanilla JS. No em dashes anywhere. Each stage paused for Mark's review before proceeding.
