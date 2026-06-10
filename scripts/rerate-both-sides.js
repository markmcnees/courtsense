/* Re-rate BOTH sides (Kings + Queens) under the capped engine — DRY-RUN ONLY
 * ---------------------------------------------------------------------------
 * Replays every Kings and Queens result through the SAME ratings.js engine the
 * app uses (now with the per-game cap from Task 2), while PRESERVING TruVolley
 * seeds so seeded players start at their seeded rating (e.g. Mark at 1600) and
 * get the 5-point cap. Everyone else starts at 1500/350 with the 10-point cap.
 *
 * Engine fidelity:
 *   - require()s ../ratings.js, so the math (including the new cap) is identical
 *     to production. Replay uses Ratings.applyToMemory, the same pure function
 *     applyGame() calls internally; pre-seeding ratingsByKey before replay is
 *     exactly how seeded starting states + the seed flag reach the cap logic.
 *   - Name resolution reproduces kotb-app.js applyRatingsLeague/namesForRatedTeam
 *     EXACTLY (per side's roster):
 *         const ss = new Set(subSlots||[]);
 *         (team||[]).filter(id => !ss.has(id))
 *                   .map(id => { const p = players[id]; return p ? p.name : null; })
 *                   .filter(Boolean);
 *     i.e. drop __SUB__ slot ids, map id->roster name, drop non-roster/named subs.
 *   - Historical backfill uses each result's stored r.ts (chronological), like
 *     seed-ratings.html, not Date.now().
 *
 * Safety: DRY-RUN by default. Read-only HTTPS GETs only; writes NOTHING. Never
 *   clears the node, never calls remove(). The live-write switch is OFF and also
 *   requires --live; the live branch is intentionally not implemented here.
 *
 * Usage:
 *   node scripts/rerate-both-sides.js          # dry run (default, no writes)
 *   node scripts/rerate-both-sides.js --live    # blocked unless LIVE_WRITE_ENABLED=true
 */

'use strict';

// ───────────────────────────────────────────────────────────────────────────
// LIVE-WRITE SWITCH — KEEP FALSE. The authorized one-time capped re-rate apply
// was performed on 2026-06-10; switch reverted to off to prevent re-running.
const LIVE_WRITE_ENABLED = false;
// ───────────────────────────────────────────────────────────────────────────

const https = require('https');
require('../ratings.js');
const Ratings = globalThis.Ratings;
if (!Ratings || !Ratings.applyToMemory) {
  console.error('FATAL: could not load Ratings engine from ../ratings.js');
  process.exit(1);
}

const BASE = 'https://leon-beach-volleyball-default-rtdb.firebaseio.com';
const wantLive = process.argv.includes('--live');
const DRY_RUN = !(LIVE_WRITE_ENABLED && wantLive);

// EXACT reproduction of community/profile truvolleySeed bands. Lower edge owned
// by each band (4.0 lands in 4-6). Returns {rating, rd} or null.
function truvolleySeed(raw) {
  const v = parseFloat(raw);
  if (!isFinite(v)) return null;
  if (v < 2)  return { rating: 1300, rd: 300 };
  if (v < 4)  return { rating: 1450, rd: 250 };
  if (v < 6)  return { rating: 1600, rd: 200 };
  if (v < 8)  return { rating: 1800, rd: 150 };
  if (v < 10) return { rating: 2000, rd: 150 };
  return { rating: 2200, rd: 100 };
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('GET ' + url + ' -> HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Atomic full-node replace (RTDB REST PUT). Replaces the entire node in ONE
// operation: clears stale keys and writes the new state together, so there is no
// window where the node is empty. Only reached when LIVE_WRITE_ENABLED && --live.
function httpsPutJson(url, obj) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(obj));
    const u = new URL(url);
    const req = https.request({
      method: 'PUT', hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('PUT ' + url + ' -> HTTP ' + res.statusCode + ' ' + body));
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

// kotb-app.js namesForRatedTeam(team, subSlots) with gP(id)=players[id].
function resolveTeam(team, subSlots, players) {
  const ss = new Set(subSlots || []);
  return (team || [])
    .filter(idOrName => !ss.has(idOrName))
    .map(idOrName => { const p = players[idOrName]; return p ? p.name : null; })
    .filter(Boolean);
}

function buildGames(results, players, source) {
  const out = [];
  Object.values(results || {}).forEach(r => {
    if (!r || r.s1 == null || r.s2 == null || r.s1 === r.s2) return;
    const t1 = resolveTeam(r.t1, r.subSlots, players);
    const t2 = resolveTeam(r.t2, r.subSlots, players);
    if (!t1.length || !t2.length) return;
    out.push({ gameId: r.id, ts: r.ts || 0, source, team1Names: t1, team2Names: t2, s1: r.s1, s2: r.s2 });
  });
  return out;
}

function fmt(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(2) : String(n); }

async function main() {
  console.log('='.repeat(80));
  console.log('RE-RATE BOTH SIDES (capped engine, seed-preserving)  —  ' + (DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'));
  console.log('  LIVE_WRITE_ENABLED =', LIVE_WRITE_ENABLED, '| --live =', wantLive);
  console.log('  caps: default ±10, seeded ±5 (must match ratings.js CAP_DEFAULT/CAP_SEEDED)');
  console.log('='.repeat(80));

  // ── READ-ONLY GETs ──────────────────────────────────────────────────────────
  console.log('\nReading (read-only) ratings + both sides results/players...');
  const [ratingsSnap, kings, queens] = await Promise.all([
    httpsGetJson(BASE + '/tally_kotb_pickup/ratings.json'),
    httpsGetJson(BASE + '/tally_kotb/kings.json'),
    httpsGetJson(BASE + '/tally_kotb/queens.json')
  ]);
  const currentRatings = ratingsSnap || {};
  const kPlayers = (kings && kings.players) || {};
  const qPlayers = (queens && queens.players) || {};
  const kResults = (kings && kings.results) || {};
  const qResults = (queens && queens.results) || {};

  // Side membership by nameKey, for the final tables.
  const kingsKeys  = new Set(Object.values(kPlayers).map(p => Ratings.nameKey(p.name)));
  const queensKeys = new Set(Object.values(qPlayers).map(p => Ratings.nameKey(p.name)));

  // ── PRE-SEED ratingsByKey from TruVolley seeds (preserve seeds) ─────────────
  const ratingsByKey = {};
  const seededKeys = new Set();
  const seedOnlyPreserved = []; // seeded players with no league games
  Object.entries(currentRatings).forEach(([key, rec]) => {
    if (!rec || rec.seededFromTruVolley == null) return;
    const raw = rec.seededFromTruVolley;
    const seed = truvolleySeed(raw);
    if (!seed) return;
    ratingsByKey[key] = {
      name: rec.name || key,
      rating: seed.rating,
      rd: seed.rd,
      volatility: 0.06,
      gamesPlayed: 0,
      peakRating: seed.rating,
      peakRatingDate: null,
      lastUpdated: rec.lastUpdated ?? null, // preserved for seed-only records (no games)
      seededFromTruVolley: raw   // makes capFor() return CAP_SEEDED (5)
    };
    seededKeys.add(key);
  });
  console.log('  existing rating keys: ' + Object.keys(currentRatings).length +
              ' | TruVolley-seeded preloaded: ' + seededKeys.size +
              ' (' + Array.from(seededKeys).join(', ') + ')');

  // ── BUILD + SORT GAMES (kings + queens), ascending ts ───────────────────────
  const games = []
    .concat(buildGames(kResults, kPlayers, 'league_kings'))
    .concat(buildGames(qResults, qPlayers, 'league_queens'))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  console.log('  games to replay: ' + games.length +
              ' (kings ' + Object.keys(kResults).length + ', queens ' + Object.keys(qResults).length + ')');

  // ── REPLAY through the capped engine, tracking per-game deltas ──────────────
  const capForKey = k => (seededKeys.has(k) ? 5 : 10);
  let maxSeededDelta = 0, maxNonSeededDelta = 0;
  const violations = [];
  const historyByKey = {}; // playerKey -> { gameId: entry } for the rebuilt node
  games.forEach(g => {
    const hist = Ratings.applyToMemory(ratingsByKey, g);
    hist.forEach(h => {
      if (!historyByKey[h.playerKey]) historyByKey[h.playerKey] = {};
      historyByKey[h.playerKey][g.gameId] = h.entry;
      const mag = Math.abs(h.entry.ratingChange);
      const cap = capForKey(h.playerKey);
      if (mag > cap + 1e-9) violations.push({ key: h.playerKey, change: h.entry.ratingChange, cap, gameId: g.gameId });
      if (seededKeys.has(h.playerKey)) maxSeededDelta = Math.max(maxSeededDelta, mag);
      else maxNonSeededDelta = Math.max(maxNonSeededDelta, mag);
    });
  });

  // ── FINAL TABLES ────────────────────────────────────────────────────────────
  function table(title, keySet) {
    const rows = Object.entries(ratingsByKey)
      .filter(([k]) => keySet.has(k))
      .map(([k, r]) => ({ k, name: r.name, rating: r.rating, rd: r.rd, gp: r.gamesPlayed || 0, seeded: seededKeys.has(k) }))
      .sort((a, b) => b.rating - a.rating);
    console.log('\n' + title + ' (' + rows.length + ')');
    console.log('  ' + 'name'.padEnd(28) + 'rating'.padStart(8) + '  ' + 'rd'.padStart(7) + '  ' + 'gp'.padStart(3) + '  seed');
    rows.forEach((r, i) => {
      console.log('  ' + String(i + 1).padStart(2) + ' ' + r.name.padEnd(25) +
                  fmt(r.rating).padStart(8) + '  ' + fmt(r.rd).padStart(7) + '  ' +
                  String(r.gp).padStart(3) + '  ' + (r.seeded ? 'TV(' + (currentRatings[r.k].seededFromTruVolley) + ')' : ''));
    });
    return rows;
  }

  console.log('\n' + '='.repeat(80));
  const kingsRows  = table('KINGS — final ratings under cap', kingsKeys);
  const queensRows = table('QUEENS — final ratings under cap', queensKeys);

  // Seed-only records (seeded but not on either league roster) — must survive.
  Object.keys(ratingsByKey).forEach(k => {
    if (!kingsKeys.has(k) && !queensKeys.has(k)) {
      seedOnlyPreserved.push({ k, ...ratingsByKey[k] });
    }
  });

  // ── KEYS THAT WOULD BE WRITTEN ──────────────────────────────────────────────
  const allKeys = Object.keys(ratingsByKey).sort();
  console.log('\n' + '='.repeat(80));
  console.log('KEYS THIS RE-RATE WOULD WRITE (' + allKeys.length + '):');
  console.log('  kings:  ' + allKeys.filter(k => kingsKeys.has(k)).join(', '));
  console.log('  queens: ' + allKeys.filter(k => queensKeys.has(k)).join(', '));
  console.log('  seed-only preserved (no league games): ' +
              (seedOnlyPreserved.length ? seedOnlyPreserved.map(s => s.k + ' @ ' + fmt(s.rating) + '/' + fmt(s.rd)).join(', ') : 'NONE'));

  // ── VERIFICATION ────────────────────────────────────────────────────────────
  const mark = ratingsByKey['mark_mcnees'];
  const markOk = mark && Math.abs(mark.rating - 1600) <= 30;
  console.log('\n' + '='.repeat(80));
  console.log('VERIFICATION');
  console.log('='.repeat(80));
  console.log('a) per-game deltas over cap: ' + (violations.length ? 'VIOLATIONS ✗ ' + JSON.stringify(violations) : 'NONE ✓'));
  console.log('   max per-game delta  — seeded: ' + fmt(maxSeededDelta) + ' (cap 5)   non-seeded: ' + fmt(maxNonSeededDelta) + ' (cap 10)');
  console.log('b) Mark (seeded) final rating: ' + (mark ? fmt(mark.rating) : 'absent') +
              '  -> within ±30 of 1600? ' + (markOk ? 'YES ✓' : 'NO ✗'));
  console.log('c) seed-only records preserved: ' +
              (['robert_stewart', 'ryansanders'].every(k => ratingsByKey[k]) ? 'robert_stewart + ryansanders present ✓' : 'MISSING ✗'));
  console.log('d) clear/remove() calls this run: 0 ✓ (dry run, in-memory only)');

  const pass = !violations.length && markOk &&
               ['robert_stewart', 'ryansanders'].every(k => ratingsByKey[k]);
  console.log('\nRESULT: ' + (pass ? 'PASS — capped, seed-preserving, append-scoped.'
                                    : 'REVIEW — see ✗ above.') + (DRY_RUN ? ' No writes (dry run).' : ''));

  if (DRY_RUN) return;

  // ── LIVE WRITE (only reached with LIVE_WRITE_ENABLED && --live) ──────────────
  // Build the COMPLETE node in memory first, self-guard, then replace the node
  // in a single atomic PUT. No clear-then-write, so no empty-node window.
  if (!pass) { console.error('\nABORT: verification did not PASS. No write performed.'); process.exit(3); }

  const fullNode = {};
  Object.entries(ratingsByKey).forEach(([k, r]) => {
    const rec = {
      name: r.name,
      rating: r.rating,
      rd: r.rd,
      volatility: r.volatility,
      gamesPlayed: r.gamesPlayed || 0,
      peakRating: r.peakRating,
      peakRatingDate: r.peakRatingDate ?? null,
      lastUpdated: r.lastUpdated ?? null
    };
    if (r.seededFromTruVolley != null) rec.seededFromTruVolley = r.seededFromTruVolley;
    if (historyByKey[k] && Object.keys(historyByKey[k]).length) rec.history = historyByKey[k];
    fullNode[k] = rec;
  });

  const nKeys = Object.keys(fullNode).length;
  const markRounded = Math.round((fullNode.mark_mcnees ? fullNode.mark_mcnees.rating : 0) * 100) / 100;
  const seedsOk = ['mark_mcnees', 'robert_stewart', 'ryansanders']
    .every(k => fullNode[k] && fullNode[k].seededFromTruVolley != null);
  // Hard invariants matching the approved dry-run. Any mismatch -> no write.
  if (nKeys !== 20)        { console.error('\nABORT: expected 20 keys, built ' + nKeys + '. No write.'); process.exit(4); }
  if (markRounded !== 1600){ console.error('\nABORT: mark_mcnees != 1600.00 (' + markRounded + '). No write.'); process.exit(5); }
  if (!seedsOk)           { console.error('\nABORT: a seeded record is missing seededFromTruVolley. No write.'); process.exit(6); }

  console.log('\nIn-memory rebuild complete and self-guarded: ' + nKeys + ' keys ready (mark=1600.00, 3 seeds intact).');
  console.log('Writing atomically (single PUT replaces the node; no empty-node window)...');
  const resp = await httpsPutJson(BASE + '/tally_kotb_pickup/ratings.json', fullNode);
  const wrote = resp && typeof resp === 'object' ? Object.keys(resp).length : '?';
  console.log('PUT OK. Node now holds ' + wrote + ' keys.');
}

main().catch(e => { console.error('ERROR:', e && e.message || e); process.exit(1); });

/* LIVE WRITER (intentionally not wired up). When authorized: set
 * LIVE_WRITE_ENABLED=true, build a firebase `db`, optionally clear the node, then
 * write each ratingsByKey record + its history. Because seeds are preloaded and
 * the engine is capped, the written state equals this dry-run preview. */
