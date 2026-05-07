#!/usr/bin/env node
//
// scripts/add-player-emails.ts
//
// Bootstrap email addresses on five player records under
// /tally_kotb_pickup/players/ so they can receive password setup.
//
// Per player:
//   - GET /tally_kotb_pickup/players/{key}
//   - If the record exists: PATCH with { email, updatedAt }
//   - If it does not exist: PUT a new record with
//     { name, email, notificationsEnabled: true, updatedAt }
//
// Defensive pre-flight check: this script assumes
// /tally_kotb_pickup/players/ is keyed by snake_case name (matching the
// ratings node convention via ratingKey()). If a record happens to live
// under a different key but already has the same display name, we warn
// loudly so the operator can decide whether to abort rather than create
// a duplicate.
//
// Usage:
//   node scripts/add-player-emails.ts            # dry-run (default)
//   node scripts/add-player-emails.ts --execute  # apply writes
//

import process from 'node:process';

// === Configuration ===

const DB = 'https://leon-beach-volleyball-default-rtdb.firebaseio.com';
const DRY_RUN = !process.argv.includes('--execute');
const PLAYERS_ROOT = '/tally_kotb_pickup/players';

// One timestamp shared across the run so the dry-run plan and the
// subsequent --execute pass produce identical write bodies (within a
// single invocation).
const RUN_TS = Date.now();

interface Player {
  key: string;
  displayName: string;
  email: string;
}

const PLAYERS: Player[] = [
  { key: 'mia_ledford',    displayName: 'Mia Ledford',    email: 'mledfordphillips@gmail.com' },
  { key: 'courtney_young', displayName: 'Courtney Young', email: 'youngca1002@gmail.com' },
  { key: 'jeff_rodgers',   displayName: 'Jeff Rodgers',   email: 'Jeffrodgers7777@yahoo.com' },
  { key: 'jesse_rouse',    displayName: 'Jesse Rouse',    email: 'stickrouse@gmail.com' },
  { key: 'jasun_burdick',  displayName: 'Jasun Burdick',  email: 'Jasun.burdick@gmail.com' },
];

// === Types ===

interface PlayerRec {
  name?: string;
  email?: string;
  notificationsEnabled?: boolean;
  updatedAt?: number;
  [k: string]: unknown;
}

interface Write {
  method: 'PUT' | 'PATCH';
  path: string;
  body: unknown;
  description: string;
}

// === Helpers (mirror scripts/merge-players.ts and scripts/fix-jeff-rodgers-spelling.ts) ===

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

// === Main ===

async function main(): Promise<void> {
  console.log('Fetching Firebase data...');
  const fetches = await Promise.all([
    fbGet(PLAYERS_ROOT) as Promise<Record<string, PlayerRec> | null>,
    ...PLAYERS.map((p) => fbGet(`${PLAYERS_ROOT}/${p.key}`) as Promise<PlayerRec | null>),
  ]);
  const allPickupPlayers = fetches[0] as Record<string, PlayerRec> | null;
  const recordsByKey = new Map<string, PlayerRec | null>(
    PLAYERS.map((p, i) => [p.key, fetches[i + 1] as PlayerRec | null]),
  );

  // === Pre-flight ===

  console.log('');
  console.log('================================================================');
  console.log(`Add player emails — ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}`);
  console.log('================================================================');
  console.log('');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no Firebase writes)' : 'EXECUTE (Firebase writes will be applied)'}`);
  console.log(`Run timestamp: ${RUN_TS} (${new Date(RUN_TS).toISOString()})`);
  console.log('');

  console.log('### Pre-flight checks');
  console.log('');
  let preflightWarnings = 0;
  for (const p of PLAYERS) {
    const rec = recordsByKey.get(p.key) ?? null;
    if (rec) {
      const fields = Object.keys(rec).sort().join(', ') || '<none>';
      const currentEmail = typeof rec.email === 'string' ? rec.email : '<unset>';
      const nameOk = rec.name === undefined || rec.name === p.displayName;
      console.log(`  [EXISTS]  ${p.key}`);
      console.log(`            fields: ${fields}`);
      console.log(`            current name:  ${rec.name ?? '<unset>'}${nameOk ? '' : ` (expected "${p.displayName}")`}`);
      console.log(`            current email: ${currentEmail}`);
      if (typeof rec.email === 'string' && rec.email.length > 0) {
        if (rec.email === p.email) {
          console.log(`            NOTE: email already matches target — PATCH will be a no-op for this field.`);
        } else {
          console.log(`            WARNING: existing email "${rec.email}" differs from target "${p.email}". PATCH will overwrite.`);
          preflightWarnings++;
        }
      }
      if (!nameOk) {
        console.log(`            WARNING: existing name "${rec.name}" does not match expected "${p.displayName}".`);
        preflightWarnings++;
      }
    } else {
      console.log(`  [MISSING] ${p.key} — no record at ${PLAYERS_ROOT}/${p.key}`);
      // Defensive: scan all pickup/players for a name-keyed duplicate so
      // we don't silently create a parallel record.
      const collisions = Object.entries(allPickupPlayers ?? {})
        .filter(([k, v]) => k !== p.key && v && typeof v === 'object' && (v as PlayerRec).name === p.displayName)
        .map(([k]) => k);
      if (collisions.length > 0) {
        console.log(`            WARNING: another pickup/players record matches name "${p.displayName}" under key(s): ${collisions.join(', ')}`);
        console.log(`            PUT to "${p.key}" will create a parallel record. Consider aborting.`);
        preflightWarnings++;
      }
    }
  }
  console.log('');
  if (preflightWarnings > 0) {
    console.log(`Pre-flight raised ${preflightWarnings} warning(s). Review before --execute.`);
  } else {
    console.log('Pre-flight OK. No warnings.');
  }
  console.log('');

  // === Build plan ===

  const writes: Write[] = [];
  for (const p of PLAYERS) {
    const rec = recordsByKey.get(p.key) ?? null;
    if (rec) {
      writes.push({
        method: 'PATCH',
        path: `${PLAYERS_ROOT}/${p.key}`,
        body: { email: p.email, updatedAt: RUN_TS },
        description: `existing record: PATCH email -> "${p.email}" (and updatedAt)`,
      });
    } else {
      writes.push({
        method: 'PUT',
        path: `${PLAYERS_ROOT}/${p.key}`,
        body: {
          name: p.displayName,
          email: p.email,
          notificationsEnabled: true,
          updatedAt: RUN_TS,
        },
        description: `missing record: PUT new player { name: "${p.displayName}", email: "${p.email}", notificationsEnabled: true }`,
      });
    }
  }

  console.log(`Total planned operations: ${writes.length}`);
  console.log('');

  const patches = writes.filter((w) => w.method === 'PATCH');
  const puts = writes.filter((w) => w.method === 'PUT');

  console.log(`### Existing records (PATCH) — ${patches.length}`);
  for (const w of patches) {
    console.log(`  ${w.method.padEnd(6)} ${w.path}`);
    console.log(`         body: ${JSON.stringify(w.body)}`);
    console.log(`         ${w.description}`);
  }
  console.log('');

  console.log(`### Missing records (PUT new) — ${puts.length}`);
  for (const w of puts) {
    console.log(`  ${w.method.padEnd(6)} ${w.path}`);
    console.log(`         body: ${JSON.stringify(w.body)}`);
    console.log(`         ${w.description}`);
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
      if (w.method === 'PUT') await fbPut(w.path, w.body);
      else                    await fbPatch(w.path, w.body);
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
