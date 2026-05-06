#!/usr/bin/env node
//
// scripts/merge-players.ts
//
// One-shot data migration to clean up duplicate KotB rating records.
// See docs/cc-brief-merge-players.md and docs/merge-audit-report.md for
// the full context, audit findings, and locked-in decisions.
//
// Operations performed:
//
//   1. For each merge pair (Jasun→Jasun Burdick, Jimmy→Jimmy McQuigg,
//      Mark→Mark McNees):
//      - Rename the orphan player record's `name` field to the canonical
//        name in every section it appears (kings/players, queens/players,
//        pickup/players if present, and every event's embedded players
//        map). Player IDs are preserved; result records (t1/t2 arrays)
//        are NOT touched.
//      - Concatenate the orphan and canonical history maps from
//        tally_kotb_pickup/ratings, sort entries by timestamp, and write
//        the consolidated record under the canonical snake_case key.
//        Delete the orphan rating key.
//
//   2. For each rename pair (Jeff→Jeff Rogers, Ian→Ian Coxey):
//      - Rename the player record's `name` field everywhere it appears.
//      - Move the rating record from the old snake_case key to the new
//        one and update the record's `name` field.
//
//   3. Rewrite opponent1/opponent2/partner display strings across every
//      rating record's history so any reference to "Jasun"/"Jimmy"/"Mark"/
//      "Jeff"/"Ian" is updated to the canonical name.
//
//   4. Delete the stale `tally_kotb_pickup/players/mark_mcnees` profile
//      (audit Finding 5).
//
// Notes on "replay through Glicko-2":
//
//   The locked decision (audit Finding 4, option (a)) is to consolidate
//   stored history entries — NOT to run a fresh mathematical replay
//   through the Glicko-2 algorithm. A true replay would require knowing
//   every opponent's rating + RD at each game's timestamp, which is not
//   stored in the per-entry records (entries hold only the player's own
//   ratingBefore/After, plus opponent display names and the score).
//
//   What "replay" means here is consolidate-not-recompute: each
//   individual history entry was correctly computed at the time it was
//   recorded, and the merge simply unifies them under one record.
//   Concretely:
//     - rating          = last entry's `ratingAfter` (chronologically)
//     - rd              = last entry's `rdAfter`
//     - gamesPlayed     = number of merged history entries
//     - peakRating      = max `ratingAfter` across merged entries
//     - peakRatingDate  = timestamp of the peak entry
//     - lastUpdated     = max timestamp
//     - volatility      = volatility from whichever pre-merge record was
//                         most recently updated
//
//   The chronology may show an apparent discontinuity for a player whose
//   orphan record was created fresh (default 1500) after the canonical
//   record had already accumulated games. For example, Mark McNees's
//   canonical record peaked around 1916 in Feb and his orphan record
//   started fresh at 1500 in May; the consolidated post-merge rating
//   reflects the latter chain, ending around 1181. This is preserved
//   as-is.
//
// Usage:
//   node scripts/merge-players.ts            # dry-run (default)
//   node scripts/merge-players.ts --execute  # apply writes
//
// Database is publicly readable; rules permit anonymous writes per the
// existing app deploy. No auth setup required for this script.
//

import process from 'node:process';

// === Configuration ===

const DB = 'https://leon-beach-volleyball-default-rtdb.firebaseio.com';
const DRY_RUN = !process.argv.includes('--execute');

interface Merge { orphan: string; canonical: string; }
interface Rename { from: string; to: string; }

const MERGES: Merge[] = [
  { orphan: 'Jasun', canonical: 'Jasun Burdick' },
  { orphan: 'Jimmy', canonical: 'Jimmy McQuigg' },
  { orphan: 'Mark',  canonical: 'Mark McNees' },
];

const RENAMES: Rename[] = [
  { from: 'Jeff', to: 'Jeff Rogers' },
  { from: 'Ian',  to: 'Ian Coxey' },
];

const STALE_PROFILES_TO_DELETE: { path: string; reason: string }[] = [
  { path: '/tally_kotb_pickup/players/mark_mcnees',
    reason: 'Audit Finding 5: stale orphan record at canonical key' },
];

// === Types ===

interface HistoryEntry {
  timestamp?: number;
  source?: string;
  partner?: string | null;
  opponent1?: string | null;
  opponent2?: string | null;
  score?: number;
  opponentScore?: number;
  ratingBefore?: number;
  ratingAfter?: number;
  ratingChange?: number;
  rdBefore?: number;
  rdAfter?: number;
  won?: boolean;
}

interface RatingRecord {
  name?: string;
  rating?: number;
  rd?: number;
  volatility?: number;
  gamesPlayed?: number;
  peakRating?: number;
  peakRatingDate?: number | null;
  lastUpdated?: number | null;
  history?: Record<string, HistoryEntry>;
}

interface PlayerRec { name?: string; [k: string]: unknown; }

interface Write {
  method: 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  description: string;
}

// === Helpers ===

// Mirrors ratings.js#nameKey exactly so consolidated keys match what the
// live rating system uses for new games.
const ratingKey = (name: string): string =>
  String(name || '').toLowerCase().trim()
    .replace(/[.#$/[\]]/g, '')
    .replace(/\s+/g, '_');

async function fbGet(p: string): Promise<unknown> {
  const res = await fetch(`${DB}${p}.json`);
  if (!res.ok) throw new Error(`GET ${p} -> HTTP ${res.status}`);
  return res.json();
}

async function fbPut(p: string, body: unknown): Promise<void> {
  const res = await fetch(`${DB}${p}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? null),
  });
  if (!res.ok) throw new Error(`PUT ${p} -> HTTP ${res.status}: ${await res.text()}`);
}

async function fbPatch(p: string, body: unknown): Promise<void> {
  const res = await fetch(`${DB}${p}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${p} -> HTTP ${res.status}: ${await res.text()}`);
}

async function fbDelete(p: string): Promise<void> {
  const res = await fetch(`${DB}${p}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${p} -> HTTP ${res.status}: ${await res.text()}`);
}

function findPlayerIds(table: Record<string, PlayerRec> | undefined | null, name: string): string[] {
  if (!table || typeof table !== 'object') return [];
  return Object.entries(table)
    .filter(([, p]) => p && typeof p === 'object' && (p as PlayerRec).name === name)
    .map(([id]) => id);
}

// Consolidate two rating records into one. See header docstring for the
// "replay = consolidate-not-recompute" rationale.
function consolidate(
  orphan: RatingRecord | null | undefined,
  canonical: RatingRecord | null | undefined,
  canonicalName: string,
): RatingRecord | null {
  const orphanHist = orphan?.history ?? {};
  const canonHist = canonical?.history ?? {};
  // Game IDs are unique per result; no realistic conflict between the two
  // history maps. If one ever did exist, prefer orphan (more recent).
  const merged: Record<string, HistoryEntry> = { ...canonHist, ...orphanHist };
  const entries = Object.values(merged);
  if (entries.length === 0) return null;

  const sorted = entries.slice().sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const last = sorted[sorted.length - 1];
  let peak = sorted[0];
  for (const e of sorted) {
    if ((e.ratingAfter ?? 0) > (peak.ratingAfter ?? 0)) peak = e;
  }

  const orphanLast = orphan?.lastUpdated ?? 0;
  const canonLast = canonical?.lastUpdated ?? 0;
  const volatility = orphanLast >= canonLast
    ? (orphan?.volatility ?? canonical?.volatility ?? 0.06)
    : (canonical?.volatility ?? orphan?.volatility ?? 0.06);

  return {
    name: canonicalName,
    rating: last.ratingAfter ?? 1500,
    rd: last.rdAfter ?? 350,
    volatility,
    gamesPlayed: entries.length,
    peakRating: peak.ratingAfter ?? 1500,
    peakRatingDate: peak.timestamp ?? null,
    lastUpdated: last.timestamp ?? null,
    history: merged,
  };
}

// In-place opponent/partner name rewrite across one rating record's
// history. Mutates the record. Returns the number of field replacements.
function rewriteHistoryNames(rec: RatingRecord, nameMap: Map<string, string>): number {
  if (!rec?.history) return 0;
  let count = 0;
  for (const entry of Object.values(rec.history)) {
    for (const field of ['opponent1', 'opponent2', 'partner'] as const) {
      const cur = entry[field];
      if (typeof cur === 'string' && nameMap.has(cur)) {
        entry[field] = nameMap.get(cur)!;
        count++;
      }
    }
  }
  return count;
}

// === Main ===

async function main(): Promise<void> {
  console.log('Fetching Firebase data...');
  const [kingsPlayers, queensPlayers, pickupPlayers, pickupRatings, pickupEvents] = await Promise.all([
    fbGet('/tally_kotb/kings/players'),
    fbGet('/tally_kotb/queens/players'),
    fbGet('/tally_kotb_pickup/players'),
    fbGet('/tally_kotb_pickup/ratings'),
    fbGet('/tally_kotb_pickup/events'),
  ]) as [
    Record<string, PlayerRec> | null,
    Record<string, PlayerRec> | null,
    Record<string, PlayerRec> | null,
    Record<string, RatingRecord> | null,
    Record<string, { players?: Record<string, PlayerRec> }> | null,
  ];

  // Pre-flight idempotency check: if no orphans found anywhere, the
  // migration has likely already been applied. Warn and continue (the
  // plan will simply be empty).
  const allOrphanNames = [...MERGES.map(m => m.orphan), ...RENAMES.map(r => r.from)];
  const anyOrphanFound = allOrphanNames.some((n) =>
    findPlayerIds(kingsPlayers, n).length > 0 ||
    findPlayerIds(queensPlayers, n).length > 0 ||
    findPlayerIds(pickupPlayers, n).length > 0 ||
    Object.values(pickupEvents ?? {}).some((ev) => findPlayerIds(ev?.players ?? null, n).length > 0) ||
    !!(pickupRatings && pickupRatings[ratingKey(n)])
  );
  if (!anyOrphanFound) {
    console.warn('WARNING: no orphan player records or orphan rating keys found. Migration may have already been applied.');
  }

  const writes: Write[] = [];

  // 1. Player profile name updates (merges + renames)
  const allTransforms: Array<{ from: string; to: string; kind: 'merge' | 'rename' }> = [
    ...MERGES.map((m) => ({ from: m.orphan, to: m.canonical, kind: 'merge' as const })),
    ...RENAMES.map((r) => ({ from: r.from, to: r.to, kind: 'rename' as const })),
  ];

  for (const { from, to, kind } of allTransforms) {
    for (const id of findPlayerIds(kingsPlayers, from)) {
      writes.push({
        method: 'PATCH',
        path: `/tally_kotb/kings/players/${id}`,
        body: { name: to },
        description: `kings player ${id}: name "${from}" -> "${to}" (${kind})`,
      });
    }
    for (const id of findPlayerIds(queensPlayers, from)) {
      writes.push({
        method: 'PATCH',
        path: `/tally_kotb/queens/players/${id}`,
        body: { name: to },
        description: `queens player ${id}: name "${from}" -> "${to}" (${kind})`,
      });
    }
    for (const id of findPlayerIds(pickupPlayers, from)) {
      writes.push({
        method: 'PATCH',
        path: `/tally_kotb_pickup/players/${id}`,
        body: { name: to },
        description: `pickup player ${id}: name "${from}" -> "${to}" (${kind})`,
      });
    }
    for (const [eid, ev] of Object.entries(pickupEvents ?? {})) {
      for (const id of findPlayerIds(ev?.players ?? null, from)) {
        writes.push({
          method: 'PATCH',
          path: `/tally_kotb_pickup/events/${eid}/players/${id}`,
          body: { name: to },
          description: `event ${eid} player ${id}: name "${from}" -> "${to}" (${kind})`,
        });
      }
    }
  }

  // 2. Build planned ratings state in-memory.
  const plannedRatings: Record<string, RatingRecord> = JSON.parse(JSON.stringify(pickupRatings ?? {}));
  const consolidationSummaries: Array<{ orphan: string; canonical: string; before: { orphanRating?: number; orphanGp?: number; canonRating?: number; canonGp?: number }; after?: RatingRecord }> = [];

  // 2a. Apply merges in-memory.
  for (const { orphan, canonical } of MERGES) {
    const oKey = ratingKey(orphan);
    const cKey = ratingKey(canonical);
    const orphanRec = plannedRatings[oKey] ?? null;
    const canonicalRec = plannedRatings[cKey] ?? null;
    const consolidated = consolidate(orphanRec, canonicalRec, canonical);
    consolidationSummaries.push({
      orphan,
      canonical,
      before: {
        orphanRating: orphanRec?.rating,
        orphanGp: orphanRec?.gamesPlayed,
        canonRating: canonicalRec?.rating,
        canonGp: canonicalRec?.gamesPlayed,
      },
      after: consolidated ?? undefined,
    });
    if (consolidated) plannedRatings[cKey] = consolidated;
    if (oKey in plannedRatings) delete plannedRatings[oKey];
  }

  // 2b. Apply renames in-memory.
  for (const { from, to } of RENAMES) {
    const oKey = ratingKey(from);
    const nKey = ratingKey(to);
    if (oKey in plannedRatings) {
      const rec = plannedRatings[oKey];
      rec.name = to;
      plannedRatings[nKey] = rec;
      delete plannedRatings[oKey];
    }
  }

  // 2c. Rewrite opp/partner names in every (post-transform) rating record.
  const nameMap = new Map<string, string>(allTransforms.map((t) => [t.from, t.to]));
  let totalRewriteCount = 0;
  const rewrittenKeys = new Set<string>();
  for (const [key, rec] of Object.entries(plannedRatings)) {
    const count = rewriteHistoryNames(rec, nameMap);
    if (count > 0) {
      rewrittenKeys.add(key);
      totalRewriteCount += count;
    }
  }

  // 3. Diff original vs. planned ratings, generate writes.
  const origKeys = new Set(Object.keys(pickupRatings ?? {}));
  const newKeys = new Set(Object.keys(plannedRatings));

  for (const k of origKeys) {
    if (!newKeys.has(k)) {
      writes.push({
        method: 'DELETE',
        path: `/tally_kotb_pickup/ratings/${k}`,
        description: `delete rating record "${k}" (consolidated/renamed away)`,
      });
    }
  }
  for (const k of newKeys) {
    const orig = (pickupRatings ?? {})[k];
    const planned = plannedRatings[k];
    if (JSON.stringify(orig) !== JSON.stringify(planned)) {
      const reason = origKeys.has(k)
        ? `update rating record "${k}"`
        : `create rating record "${k}" (consolidation/rename target)`;
      writes.push({
        method: 'PUT',
        path: `/tally_kotb_pickup/ratings/${k}`,
        body: planned,
        description: reason,
      });
    }
  }

  // 4. Stale profile deletions.
  for (const { path, reason } of STALE_PROFILES_TO_DELETE) {
    writes.push({ method: 'DELETE', path, description: reason });
  }

  // === Plan output ===

  console.log('');
  console.log('================================================================');
  console.log(`KotB player record migration — ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}`);
  console.log('================================================================');
  console.log('');

  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no Firebase writes)' : 'EXECUTE (Firebase writes will be applied)'}`);
  console.log(`Total planned operations: ${writes.length}`);
  console.log('');

  const sections: Record<string, Write[]> = {
    'Player profile name updates': writes.filter((w) => w.path.includes('/players/') && !STALE_PROFILES_TO_DELETE.some((s) => s.path === w.path)),
    'Rating record changes':       writes.filter((w) => w.path.includes('/ratings/')),
    'Stale profile deletions':     writes.filter((w) => STALE_PROFILES_TO_DELETE.some((s) => s.path === w.path)),
  };
  for (const [name, ws] of Object.entries(sections)) {
    console.log(`### ${name} (${ws.length})`);
    for (const w of ws) {
      console.log(`  ${w.method.padEnd(6)} ${w.path}`);
      console.log(`         ${w.description}`);
    }
    console.log('');
  }

  console.log('### Consolidated rating summaries');
  for (const s of consolidationSummaries) {
    const beforeOR = s.before.orphanRating !== undefined ? s.before.orphanRating.toFixed(1) : 'n/a';
    const beforeOGp = s.before.orphanGp ?? 0;
    const beforeCR = s.before.canonRating !== undefined ? s.before.canonRating.toFixed(1) : 'n/a';
    const beforeCGp = s.before.canonGp ?? 0;
    const after = s.after;
    const afterRating = after?.rating !== undefined ? after.rating.toFixed(1) : 'n/a';
    const afterRd = after?.rd !== undefined ? after.rd.toFixed(1) : 'n/a';
    const afterPeak = after?.peakRating !== undefined ? after.peakRating.toFixed(1) : 'n/a';
    const afterGp = after?.gamesPlayed ?? 0;
    const afterHist = after?.history ? Object.keys(after.history).length : 0;
    console.log(`  ${s.orphan} -> ${s.canonical}:`);
    console.log(`    Before: orphan rating=${beforeOR} gp=${beforeOGp}; canonical rating=${beforeCR} gp=${beforeCGp}`);
    console.log(`    After:  ${s.canonical} rating=${afterRating} rd=${afterRd} gp=${afterGp} peak=${afterPeak} (history entries=${afterHist})`);
  }
  console.log('');

  console.log('### Opponent/partner name rewrites');
  console.log(`  ${totalRewriteCount} field replacements across ${rewrittenKeys.size} rating records`);
  if (rewrittenKeys.size > 0) {
    console.log(`  Affected keys: ${[...rewrittenKeys].sort().join(', ')}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('DRY-RUN complete. Review the plan above. Re-run with --execute to apply.');
    return;
  }

  // === Execute ===

  console.log('=== Executing writes ===');
  console.log('');
  const startMs = Date.now();
  let success = 0;
  let fail = 0;
  for (const w of writes) {
    const opStart = Date.now();
    try {
      if (w.method === 'PUT')        await fbPut(w.path, w.body);
      else if (w.method === 'PATCH') await fbPatch(w.path, w.body);
      else                           await fbDelete(w.path);
      const ms = Date.now() - opStart;
      console.log(`  OK   ${w.method.padEnd(6)} ${w.path}  (${ms}ms)`);
      success++;
    } catch (e) {
      const ms = Date.now() - opStart;
      console.error(`  FAIL ${w.method.padEnd(6)} ${w.path}  (${ms}ms): ${(e as Error).message}`);
      fail++;
    }
  }
  const elapsedMs = Date.now() - startMs;
  console.log('');
  console.log(`Done. ${success} succeeded, ${fail} failed. Elapsed: ${(elapsedMs / 1000).toFixed(2)}s (${elapsedMs}ms).`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
