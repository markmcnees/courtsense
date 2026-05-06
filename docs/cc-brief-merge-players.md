# CC Brief: Player record merge + rename cleanup

## Context

The CourtSense ratings standings at courtsense.app/kotb/ show duplicate player records where the same person was entered under both a first-name-only record and a full-name record. Each duplicate has split game history between the two records, so neither Glicko rating reflects the full set of games played.

Three duplicate pairs need to be merged. Two single-name records need to be renamed (to keep them from duplicating in the future). All ratings should be recomputed from the consolidated game history.

## Scope

This session: data cleanup only. One-time migration. Save script as scripts/merge-players.ts for audit trail. Do NOT modify kotb/index.html or other app source files. The normalization helper from the original brief is deferred to a separate PR.

## Merge pairs (lower-GP folds INTO higher-GP record)

| Orphan name (delete) | Canonical name (keep) |
|---|---|
| Jasun | Jasun Burdick |
| Jimmy | Jimmy McQuigg |
| Mark | Mark McNees |

## Renames (keep the record, just update the name)

| Current name | New name |
|---|---|
| Jeff | Jeff Rogers |
| Ian | Ian Coxey |

## Where the data lives

- Ratings: tally_kotb_pickup/ratings/{playerName}/
- Game results: tally_kotb/kings/results/, tally_kotb/queens/results/, tally_kotb_pickup/results/
- Player profiles: tally_kotb/kings/players/, tally_kotb/queens/players/, tally_kotb_pickup/players/

## What the migration script must do

For each merge pair:
1. Find every game result that references the orphan name across all results paths.
2. Update those results to reference the canonical name. Preserve all other fields.
3. Delete the orphan rating record at tally_kotb_pickup/ratings/{orphan_name}/.
4. Delete the orphan player profile record at all three player roster paths if it exists.
5. Recompute the canonical player's Glicko-2 rating from consolidated game history (replayed in chronological order).

For each rename:
1. Update every game result that references the old name to use the new name.
2. Update the rating record key from old name to new name.
3. Update the player profile record key in all three roster paths.
4. No rating recomputation needed.

## Acceptance criteria

After execution:
- Jasun, Jimmy, Mark no longer appear as orphan names in standings
- Jasun Burdick, Jimmy McQuigg, Mark McNees show combined GP and recomputed ratings
- Jeff is now Jeff Rogers; Ian is now Ian Coxey (same GP, same rating)
- All historical game results display correctly with consolidated names

## Out of scope

- Don't modify kotb/index.html or any other app source
- Don't add player IDs (separate refactor for another day)
- Don't ship the normalization helper this session
- Don't fix unrelated bugs (e.g., stuck modal in Planner Step 6)
