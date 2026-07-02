/* Season backfill — stamp seasonId on existing result records — DRY-RUN BY DEFAULT
 * ---------------------------------------------------------------------------
 * Why this exists:
 *   Season Records Step 1 (beach-app-core v1.1.59) added seasonId stamping to
 *   every result CREATE via fbSetResult, but existing records written before
 *   that deploy have no seasonId. Step 2 (read-side filtering) will use a strict
 *   seasonId match, so those legacy records must be stamped with the season they
 *   belong to (all existing data is the 2026 season) or they would disappear
 *   from every season-filtered view.
 *
 * Scope:
 *   - Result nodes ONLY: matches, gamedays, scrimmages, schedule, duals.
 *   - Runs per school root (DB_ROOT = SC.dbRoots.matches per school). All schools
 *     share one RTDB, differing only by root node.
 *   - NEVER touches players, goals, config, standings, assignments, tier_requests,
 *     live_scoring, quizScores, or the profiles/passwords roots.
 *   - Idempotent: only records missing seasonId are stamped; re-running is a no-op.
 *
 * Safety:
 *   - DRY_RUN defaults to true. In dry run the script performs ONLY read-only
 *     HTTPS GETs against the public RTDB and writes NOTHING anywhere.
 *   - The live-write switch (LIVE_WRITE_ENABLED) is OFF by default and gated so
 *     the write branch is never reached unless you deliberately flip it AND pass
 *     --live. It never calls remove(); the only write is a PATCH of {seasonId}
 *     onto a single record, which cannot clobber sibling keys.
 *
 * Usage:
 *   node scripts/season-backfill.js          # dry run (default, no writes)
 *   node scripts/season-backfill.js --live    # blocked unless LIVE_WRITE_ENABLED=true below
 */

'use strict';

// ───────────────────────────────────────────────────────────────────────────
// LIVE-WRITE SWITCH — KEEP FALSE. Flipping this to true is the ONLY thing that
// lets the script touch Firebase. Even then you must also pass --live on the
// CLI. Leave false until the dry-run output has been reviewed and authorized.
const LIVE_WRITE_ENABLED = false;
// ───────────────────────────────────────────────────────────────────────────

const https = require('https');

const BASE = 'https://leon-beach-volleyball-default-rtdb.firebaseio.com';

// School roots that may hold live results. Add/remove as needed.
const SCHOOL_ROOTS = [
  'leon_queens_matches',
  'south_walton_matches',
  // grass club root here if it has live results
];

// Result nodes ONLY. Do not add players/goals/config/standings/etc.
const RESULT_NODES = ['matches', 'gamedays', 'scrimmages', 'schedule', 'duals'];
const SEASON = '2026';

const wantLive = process.argv.includes('--live');
const DRY_RUN = !(LIVE_WRITE_ENABLED && wantLive);

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('GET ' + url + ' -> HTTP ' + res.statusCode));
        try { resolve(body === 'null' ? null : JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function httpsPatchJson(url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('PATCH ' + url + ' -> HTTP ' + res.statusCode + ' ' + body));
        resolve(body);
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('='.repeat(78));
  console.log('SEASON BACKFILL  —  ' + (DRY_RUN ? 'DRY RUN (no writes)' : '*** LIVE WRITE ***'));
  console.log('  LIVE_WRITE_ENABLED =', LIVE_WRITE_ENABLED, '| --live flag =', wantLive);
  console.log('  season stamp:', SEASON, '| result nodes:', RESULT_NODES.join(', '));
  console.log('  roots:', SCHOOL_ROOTS.join(', '));
  console.log('='.repeat(78));

  let grandTotal = 0, grandMissing = 0;

  for (const root of SCHOOL_ROOTS) {
    console.log('\n---- root: ' + root + ' ----');
    for (const node of RESULT_NODES) {
      const url = BASE + '/' + root + '/' + node + '.json';
      let data;
      try { data = await httpsGetJson(url); }
      catch (e) { console.log('  ' + node + ': READ ERROR — ' + e.message); continue; }
      if (!data || typeof data !== 'object') { console.log('  ' + node + ': (empty or missing)'); continue; }
      const ids = Object.keys(data);
      const missing = ids.filter(id => data[id] && typeof data[id] === 'object' && data[id].seasonId == null);
      grandTotal += ids.length;
      grandMissing += missing.length;
      console.log('  ' + node + ': total ' + ids.length + ' | missing seasonId ' + missing.length +
        (missing.length ? ' | sample ' + missing.slice(0, 3).join(', ') : ''));
      if (!DRY_RUN) {
        for (const id of missing) {
          await httpsPatchJson(BASE + '/' + root + '/' + node + '/' + id + '.json', { seasonId: SEASON });
        }
        if (missing.length) console.log('     -> stamped ' + missing.length + ' records with seasonId ' + SEASON);
      }
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log('TOTAL records scanned: ' + grandTotal + ' | ' + (DRY_RUN ? 'would stamp' : 'stamped') + ': ' + grandMissing);
  if (DRY_RUN) {
    console.log('\nDRY-RUN complete. No data written.');
    console.log('To go live after review: set LIVE_WRITE_ENABLED=true (top of file), run with --live.');
  } else {
    console.log('\nLIVE WRITE complete.');
  }
  console.log('='.repeat(78));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
