#!/usr/bin/env node
//
// scripts/fix-jeff-rodgers-spelling.ts
//
// Correction to yesterday's player merge migration (PR #2 / commit 1f54a9f).
// The rename "Jeff" -> "Jeff Rogers" used the wrong spelling. Correct
// spelling is "Jeff Rodgers" (with a 'd').
//
// Operations performed (exactly three, per brief):
//
//   1. Player profile name update
//      PATCH /tally_kotb/kings/players/pmnoveqf16qp with { name: "Jeff Rodgers" }
//      (audit-confirmed: "Jeff" / "Jeff Rogers" only ever lived in
//       kings/players, not queens/players, pickup/players, or any event)
//
//   2. Rating record key rename
//      - GET  /tally_kotb_pickup/ratings/jeff_rogers
//      - Set  record.name = "Jeff Rodgers"
//      - PUT  /tally_kotb_pickup/ratings/jeff_rodgers (with updated record)
//      - DELETE /tally_kotb_pickup/ratings/jeff_rogers
//
//   3. Opponent/partner name string rewrites
//      - Walk every record in /tally_kotb_pickup/ratings/
//      - For each history entry, if opponent1/opponent2/partner strictly
//        equals "Jeff Rogers" (Map.has — no substring matching), rewrite
//        it to "Jeff Rodgers".
//      - PUT only those records that actually changed.
//      - Skips the OLD rating key (`jeff_rogers`), which is being deleted
//        in step 2; self-references in that record are vanishingly
//        unlikely (would imply Jeff played himself).
//
// Usage:
//   node scripts/fix-jeff-rodgers-spelling.ts            # dry-run (default)
//   node scripts/fix-jeff-rodgers-spelling.ts --execute  # apply writes
//

import process from 'node:process';

// === Configuration ===

const DB = 'https://leon-beach-volleyball-default-rtdb.firebaseio.com';
const DRY_RUN = !process.argv.includes('--execute');

const OLD_NAME = 'Jeff Rogers';
const NEW_NAME = 'Jeff Rodgers';
const OLD_RATING_KEY = 'jeff_rogers';
const NEW_RATING_KEY = 'jeff_rodgers';
const PLAYER_PATH = '/tally_kotb/kings/players/pmnoveqf16qp';
const RATINGS_ROOT = '/tally_kotb_pickup/ratings';

// === Types ===

interface HistoryEntry {
  timestamp?: number;
  partner?: string | null;
  opponent1?: string | null;
  opponent2?: string | null;
  [k: string]: unknown;
}

interface RatingRecord {
  name?: string;
  history?: Record<string, HistoryEntry>;
  [k: string]: unknown;
}

interface PlayerRec { name?: string; [k: string]: unknown; }

interface Write {
  method: 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  description: string;
}

// === Helpers (mirrors scripts/merge-players.ts) ===

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
  const [playerRec, oldRatingRec, newRatingRec, allRatings] = await Promise.all([
    fbGet(PLAYER_PATH),
    fbGet(`${RATINGS_ROOT}/${OLD_RATING_KEY}`),
    fbGet(`${RATINGS_ROOT}/${NEW_RATING_KEY}`),
    fbGet(RATINGS_ROOT),
  ]) as [
    PlayerRec | null,
    RatingRecord | null,
    RatingRecord | null,
    Record<string, RatingRecord> | null,
  ];

  // Pre-flight idempotency / sanity checks.
  if (newRatingRec) {
    console.warn(`WARNING: ${RATINGS_ROOT}/${NEW_RATING_KEY} already exists. Migration may have already been applied (or there is a key collision).`);
  }
  if (!oldRatingRec) {
    console.warn(`WARNING: ${RATINGS_ROOT}/${OLD_RATING_KEY} does NOT exist. Step 2 (rating-key rename) will be skipped.`);
  }
  if (!playerRec) {
    console.warn(`WARNING: player record at ${PLAYER_PATH} does not exist. Step 1 (player name PATCH) will be skipped.`);
  } else if (playerRec.name !== OLD_NAME) {
    console.warn(`WARNING: player at ${PLAYER_PATH} has name "${playerRec.name}", expected "${OLD_NAME}". Will still PATCH name to "${NEW_NAME}".`);
  }

  const writes: Write[] = [];

  // 1. Player profile name update
  if (playerRec) {
    writes.push({
      method: 'PATCH',
      path: PLAYER_PATH,
      body: { name: NEW_NAME },
      description: `kings player pmnoveqf16qp: name "${playerRec.name ?? '<missing>'}" -> "${NEW_NAME}"`,
    });
  }

  // 2. Rating record key rename
  if (oldRatingRec) {
    const renamed: RatingRecord = JSON.parse(JSON.stringify(oldRatingRec));
    renamed.name = NEW_NAME;
    writes.push({
      method: 'PUT',
      path: `${RATINGS_ROOT}/${NEW_RATING_KEY}`,
      body: renamed,
      description: `create rating record "${NEW_RATING_KEY}" (rename target; name field set to "${NEW_NAME}")`,
    });
    writes.push({
      method: 'DELETE',
      path: `${RATINGS_ROOT}/${OLD_RATING_KEY}`,
      description: `delete old rating record "${OLD_RATING_KEY}" (renamed away)`,
    });
  }

  // 3. Opponent/partner name string rewrites across every other rating record.
  const nameMap = new Map<string, string>([[OLD_NAME, NEW_NAME]]);
  let totalRewriteCount = 0;
  const rewrittenKeys: string[] = [];
  const rewrittenRecords = new Map<string, RatingRecord>();
  for (const [key, rec] of Object.entries(allRatings ?? {})) {
    // Skip the old key being deleted in step 2.
    if (key === OLD_RATING_KEY) continue;
    // Deep clone so we operate on an isolated copy.
    const cloned: RatingRecord = JSON.parse(JSON.stringify(rec));
    const count = rewriteHistoryNames(cloned, nameMap);
    if (count > 0) {
      rewrittenKeys.push(key);
      rewrittenRecords.set(key, cloned);
      totalRewriteCount += count;
    }
  }
  for (const [key, rec] of rewrittenRecords) {
    writes.push({
      method: 'PUT',
      path: `${RATINGS_ROOT}/${key}`,
      body: rec,
      description: `update rating record "${key}" (history opp/partner refs "${OLD_NAME}" -> "${NEW_NAME}")`,
    });
  }

  // === Plan output ===

  console.log('');
  console.log('================================================================');
  console.log(`Jeff Rodgers spelling correction — ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}`);
  console.log('================================================================');
  console.log('');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no Firebase writes)' : 'EXECUTE (Firebase writes will be applied)'}`);
  console.log(`Total planned operations: ${writes.length}`);
  console.log('');

  const isPlayerWrite       = (w: Write) => w.path === PLAYER_PATH;
  const isRenameWrite       = (w: Write) =>
    w.path === `${RATINGS_ROOT}/${NEW_RATING_KEY}` ||
    w.path === `${RATINGS_ROOT}/${OLD_RATING_KEY}`;
  const isHistoryRewrite    = (w: Write) =>
    w.path.startsWith(`${RATINGS_ROOT}/`) && !isRenameWrite(w);

  const sections: Array<[string, Write[]]> = [
    ['Step 1 — Player profile name update', writes.filter(isPlayerWrite)],
    ['Step 2 — Rating record key rename',   writes.filter(isRenameWrite)],
    ['Step 3 — Opponent/partner name rewrites', writes.filter(isHistoryRewrite)],
  ];
  for (const [name, ws] of sections) {
    console.log(`### ${name} (${ws.length})`);
    for (const w of ws) {
      console.log(`  ${w.method.padEnd(6)} ${w.path}`);
      console.log(`         ${w.description}`);
    }
    console.log('');
  }

  console.log('### Step 3 summary');
  console.log(`  ${totalRewriteCount} field replacements across ${rewrittenKeys.length} rating records`);
  if (rewrittenKeys.length > 0) {
    console.log(`  Affected keys: ${rewrittenKeys.slice().sort().join(', ')}`);
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
