#!/usr/bin/env node
/**
 * scripts/check-rotation-fairness.js
 *
 * Offline check for the KotB rotation engine (buildSeasonNight in kotb-app.js).
 *
 * Priorities, in order, as Mark set them:
 *   1. Season parity: partners and opponents as even as possible across the season.
 *   2. Night parity: the same within one night.
 *   3. Rest, where 1 and 2 allow: nobody plays more than 2 in a row or sits more than 1
 *      in a row. Where the setup makes that impossible, streaks stay within one of the
 *      setup's floor (the shortest longest streak any spacing can reach).
 *
 * The engine is NOT copied here. It is extracted from kotb-app.js by function name at
 * run time, so this always measures the shipped code.
 *
 * Runs entirely offline. No Firebase, no admin key, no network.
 *
 *   node scripts/check-rotation-fairness.js               full suite, pass or fail
 *   node scripts/check-rotation-fairness.js --mutations   each mutation must make the suite fail
 *   node scripts/check-rotation-fairness.js --players 13 --courts 1,2,3 --weeks 12
 *   node scripts/check-rotation-fairness.js --src other-copy.js --emit-baseline
 *
 * Exit code 1 on any failure.
 */

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'kotb-app.js');
const WEEKS = 12, TARGET = 6;
const PLAYERS = [8, 9, 10, 11, 12, 13, 14, 16];
const NIGHT_MS_LIMIT = 1000;

// The previous generator (kotb-app.js before the rest spacing build), measured by this
// harness with --emit-baseline on the same setups, 12 weeks. Frozen so the limits do not
// move when the engine does. Fields:
//   season partners min, max, sd | season opponents min, max, sd
//   night partners max, sd, spread | night opponents max, sd, spread
//   longest play run, longest sit run, percent of nights breaking the rest rule
const BASELINE = {
  '8x1': [10,11,0.45,20,21,0.49,2,0.44,2,3,0.58,3,5,6,100],
  '8x2': [10,11,0.45,19,22,0.73,2,0.55,2,4,0.86,4,6,0,100],
  '9x1': [9,10,0.47,18,20,0.53,2,0.51,2,3,0.57,3,7,7,100],
  '9x2': [9,10,0.47,18,19,0.47,2,0.56,2,3,0.75,3,7,1,100],
  '10x1': [8,8,0,15,17,0.56,2,0.52,2,3,0.6,3,6,9,100],
  '10x2': [8,9,0.5,16,18,0.49,2,0.55,2,4,0.73,4,7,2,100],
  '11x1': [7,8,0.49,14,16,0.46,2,0.53,2,3,0.55,3,4,8,100],
  '11x2': [7,9,0.4,14,17,0.62,2,0.54,2,4,0.7,4,7,3,100],
  '12x1': [6,7,0.5,12,14,0.48,2,0.51,2,3,0.58,3,5,10,100],
  '12x2': [6,7,0.5,12,14,0.51,2,0.53,2,3,0.64,3,6,3,100],
  '12x3': [6,7,0.5,12,14,0.6,2,0.55,2,3,0.72,3,6,0,100],
  '13x1': [6,7,0.36,12,13,0.46,2,0.52,2,3,0.53,3,4,11,100],
  '13x2': [6,7,0.36,11,13,0.56,2,0.52,2,3,0.6,3,6,3,100],
  '13x3': [6,7,0.5,11,14,0.62,2,0.54,2,3,0.72,3,7,1,100],
  '14x1': [5,6,0.5,10,12,0.34,2,0.52,2,2,0.55,2,4,12,100],
  '14x2': [5,6,0.4,11,13,0.51,2,0.52,2,3,0.61,3,6,4,100],
  '14x3': [5,6,0.5,10,12,0.56,2,0.52,2,4,0.67,4,6,1,100],
  '16x1': [4,5,0.4,9,11,0.51,2,0.5,2,2,0.55,2,5,17,100],
  '16x2': [4,5,0.4,8,11,0.54,2,0.5,2,3,0.58,3,5,6,100],
  '16x3': [4,5,0.4,8,11,0.65,2,0.5,2,3,0.64,3,6,2,100]
};

// Rest ratchet. Rounds past the best target (the rule or the floor, whichever is higher),
// summed over every streak in the 12 week season, as this build measured them. A change
// may not push a setup more than 5 percent (plus 2) above these. Refresh only on purpose,
// with --emit-after, after checking the new numbers are better.
const AFTER_EXCESS = {
  '8x1': 140,
  '8x2': 0,
  '9x1': 63,
  '9x2': 0,
  '10x1': 112,
  '10x2': 51,
  '11x1': 205,
  '11x2': 72,
  '12x1': 311,
  '12x2': 129,
  '12x3': 0,
  '13x1': 421,
  '13x2': 167,
  '13x3': 0,
  '14x1': 220,
  '14x2': 225,
  '14x3': 0,
  '16x1': 431,
  '16x2': 261,
  '16x3': 93
};

// ---------------------------------------------------------------------------
// EXTRACTION, by name, so a moved function cannot make this measure the wrong code.
// ---------------------------------------------------------------------------
function extractBlock(src, header){
  const start = src.indexOf(header);
  if(start < 0) throw new Error('could not find "' + header + '" in kotb-app.js');
  const nl = src.indexOf('\n', start);
  const endMarker = src.indexOf('\n}', nl);
  if(endMarker < 0) throw new Error('could not find the end of "' + header + '"');
  return src.slice(start, endMarker + 2);
}
function extractOneLiner(src, header){
  const start = src.indexOf(header);
  if(start < 0) throw new Error('could not find "' + header + '" in kotb-app.js');
  const end = src.indexOf('\n', start);
  return src.slice(start, end < 0 ? src.length : end);
}
const ENGINE_BLOCKS = ['function parseCourts(', 'function configCourts(', 'function _ksRng(', 'function _ksFloors(', 'function buildSeasonNight('];
const ENGINE_LINES = ['const DEFAULT_COURTS', 'function _csPv(', 'function _csChg('];

function loadEngine(src, lenient){
  const parts = [];
  ENGINE_LINES.forEach(h => parts.push(extractOneLiner(src, h)));
  ENGINE_BLOCKS.forEach(h => {
    try { parts.push(extractBlock(src, h)); }
    catch(e){ if(!lenient) throw e; }
  });
  const code = parts.join('\n');
  return new Function(code + '\nreturn { buildSeasonNight };')();
}

// ---------------------------------------------------------------------------
// MEASUREMENT
// ---------------------------------------------------------------------------
function stdev(v){
  if(!v.length) return 0;
  const m = v.reduce((a,b)=>a+b,0) / v.length;
  return Math.sqrt(v.reduce((a,b)=>a+(b-m)*(b-m),0) / v.length);
}
const fx = (x, d) => Number(x).toFixed(d == null ? 2 : d);
const pad = (s,n) => { s=String(s); return s.length>=n ? s : s + ' '.repeat(n-s.length); };
const padL = (s,n) => { s=String(s); return s.length>=n ? s : ' '.repeat(n-s.length) + s; };

// The shortest longest play and sit run the setup allows. A player with g games and s
// sits has s+1 gaps to spread the games over and g+1 gaps for the sits. On top of that,
// when anyone sits, somebody sits the first round: that sit is at the edge, so it leaves
// them only s gaps (at least ceil(g/s) in a row). The recon table missed this edge
// bound, which matters at 14 on 3 (everyone sits once, so the first and last round
// sitters play 6 straight) and 16 on 3. Computed here independently of the engine, so an
// engine bug cannot move its own goalposts.
function setupFloors(n, courtsN, R){
  const A = courtsN * 4, total = R * A;
  const base = Math.floor(total / n), extra = total - base * n;
  const types = extra ? [base, base + 1] : [base];
  let play = 0, sit = 0;
  types.forEach(g => {
    const s = R - g;
    play = Math.max(play, Math.ceil(g / (s + 1)));
    sit = Math.max(sit, s > 0 ? Math.ceil(s / (g + 1)) : 0);
  });
  if(n > A){
    play = Math.max(play, Math.ceil(base / (R - base)));
    const gHi = extra ? base + 1 : base;
    sit = Math.max(sit, Math.ceil((R - gHi) / gHi));
  }
  return { play, sit };
}

function pairKey(a, b){ return a < b ? a + '|' + b : b + '|' + a; }

function runSetup(api, n, courts, weeks){
  const ids = [];
  for(let i=1;i<=n;i++) ids.push('p' + String(i).padStart(2,'0'));
  const courtsN = Math.min(courts.length, Math.floor(n/4));
  const S = n - courtsN*4;
  const R = S === 0 ? TARGET : Math.ceil(n*TARGET/(courtsN*4));
  const pairs = [];
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) pairs.push(pairKey(ids[i], ids[j]));
  const sP = {}, sO = {};
  pairs.forEach(k => { sP[k]=0; sO[k]=0; });
  const pC = {}, oC = {}, sitCount = {};
  const errors = [];
  let maxNightMs = 0, seasonMs = 0, longestPlay = 0, longestSit = 0, badNights = 0, overNights = 0, excess = 0;
  // The best rest the setup allows: the rule (2 games, 1 sit) or the floor, whichever is
  // higher. excess counts rounds past it, summed over every streak in the season.
  const fl = setupFloors(n, courtsN, R);
  const tPlay = Math.max(2, fl.play), tSit = Math.max(1, fl.sit);
  let nPmax = 0, nOmax = 0, nPspr = 0, nOspr = 0;
  const nPsd = [], nOsd = [];
  for(let wi=0; wi<weeks; wi++){
    const t0 = process.hrtime.bigint();
    const res = api.buildSeasonNight(ids, courts, pC, oC, sitCount, TARGET, wi);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    maxNightMs = Math.max(maxNightMs, ms); seasonMs += ms;
    if(!res || !Array.isArray(res.rounds)){ errors.push('week ' + (wi+1) + ': no rounds'); break; }
    const rounds = res.rounds;
    if(rounds.length !== R) errors.push('week ' + (wi+1) + ': ' + rounds.length + ' rounds, expected ' + R);
    const nP = {}, nO = {}, gp = {}, playGrid = {};
    pairs.forEach(k => { nP[k]=0; nO[k]=0; });
    ids.forEach(id => { gp[id]=0; playGrid[id]=[]; });
    rounds.forEach((rd, ri) => {
      const seen = new Set();
      if((rd.courts||[]).length !== courtsN) errors.push('week ' + (wi+1) + ' round ' + (ri+1) + ': ' + (rd.courts||[]).length + ' courts');
      (rd.courts||[]).forEach((ct, ci) => {
        if(ct.court !== courts[ci]) errors.push('week ' + (wi+1) + ': court number ' + ct.court + ' not ' + courts[ci]);
        const t1 = ct.t1||[], t2 = ct.t2||[];
        if(t1.length !== 2 || t2.length !== 2){ errors.push('week ' + (wi+1) + ': team not 2 players'); return; }
        [...t1, ...t2].forEach(id => { if(seen.has(id) || gp[id] == null) errors.push('week ' + (wi+1) + ' round ' + (ri+1) + ': bad or repeated id ' + id); seen.add(id); gp[id]++; });
        nP[pairKey(t1[0],t1[1])]++; nP[pairKey(t2[0],t2[1])]++;
        t1.forEach(a => t2.forEach(b => nO[pairKey(a,b)]++));
      });
      const sit = rd.sitting || [];
      if(sit.length !== n - seen.size || sit.some(id => seen.has(id) || gp[id] == null)) errors.push('week ' + (wi+1) + ' round ' + (ri+1) + ': sitting list does not match');
      ids.forEach(id => playGrid[id].push(seen.has(id) ? 1 : 0));
    });
    const g = ids.map(id => gp[id]);
    if(Math.max(...g) - Math.min(...g) > 1) errors.push('week ' + (wi+1) + ': games spread ' + (Math.max(...g) - Math.min(...g)));
    if(Math.min(...g) < TARGET) errors.push('week ' + (wi+1) + ': a player has ' + Math.min(...g) + ' games');
    // Streaks
    let nightBad = false, nightOver = false;
    ids.forEach(id => {
      const row = playGrid[id];
      let r = 0;
      while(r < row.length){
        let e = r + 1; while(e < row.length && row[e] === row[r]) e++;
        const len = e - r;
        if(row[r]){ longestPlay = Math.max(longestPlay, len); if(len > 2) nightBad = true; if(len > tPlay){ nightOver = true; excess += len - tPlay; } }
        else { longestSit = Math.max(longestSit, len); if(len > 1) nightBad = true; if(len > tSit){ nightOver = true; excess += len - tSit; } }
        r = e;
      }
    });
    if(nightBad) badNights++;
    if(nightOver) overNights++;
    const pv = pairs.map(k => nP[k]), ov = pairs.map(k => nO[k]);
    nPmax = Math.max(nPmax, ...pv); nOmax = Math.max(nOmax, ...ov);
    nPspr = Math.max(nPspr, Math.max(...pv) - Math.min(...pv));
    nOspr = Math.max(nOspr, Math.max(...ov) - Math.min(...ov));
    nPsd.push(stdev(pv)); nOsd.push(stdev(ov));
    pairs.forEach(k => { sP[k] += nP[k]; sO[k] += nO[k]; });
  }
  const spv = pairs.map(k => sP[k]), sov = pairs.map(k => sO[k]);
  const mean = v => v.reduce((a,b)=>a+b,0) / (v.length || 1);
  return {
    n, courtsN, S, R, errors,
    floors: setupFloors(n, courtsN, R),
    sPmin: Math.min(...spv), sPmax: Math.max(...spv), sPsd: stdev(spv),
    sOmin: Math.min(...sov), sOmax: Math.max(...sov), sOsd: stdev(sov),
    nPmax, nPsd: mean(nPsd), nPspr, nOmax, nOsd: mean(nOsd), nOspr,
    play: longestPlay, sit: longestSit, bad: Math.round(100 * badNights / weeks),
    over: Math.round(100 * overNights / weeks), excess,
    maxNightMs, seasonMs
  };
}

function setups(){
  const out = [];
  PLAYERS.forEach(n => [1,2,3].forEach(c => {
    if(c > Math.floor(n/4)) return;
    const courts = []; for(let i=1;i<=c;i++) courts.push(i);
    out.push({ n, courts, key: n + 'x' + c });
  }));
  return out;
}

// ---------------------------------------------------------------------------
// PASS LIMITS
// ---------------------------------------------------------------------------
function judge(m, key){
  const fails = [], notes = [];
  m.errors.slice(0, 5).forEach(e => fails.push('shape: ' + e));
  const b = BASELINE[key];
  if(!b){ fails.push('no baseline row for ' + key); return { fails, notes }; }
  const [bPmin, bPmax, , bOmin, bOmax, , , , bNPspr, , , bNOspr, bPlay, bSit] = b;
  const playGain = bPlay - m.play, sitGain = bSit - m.sit;
  const restGain = Math.max(playGain, sitGain);
  const allow = restGain >= 2 ? 1 : 0;
  const sPs = m.sPmax - m.sPmin, sOs = m.sOmax - m.sOmin;
  const bPs = bPmax - bPmin, bOs = bOmax - bOmin;
  if(sPs > bPs + allow) fails.push('season partner spread ' + sPs + ' vs before ' + bPs + (allow ? ' (+1 allowed)' : ''));
  else if(sPs > bPs) notes.push('season partner spread ' + bPs + ' to ' + sPs + ', rest gained ' + restGain);
  if(sOs > bOs + allow) fails.push('season opponent spread ' + sOs + ' vs before ' + bOs + (allow ? ' (+1 allowed)' : ''));
  else if(sOs > bOs) notes.push('season opponent spread ' + bOs + ' to ' + sOs + ', rest gained ' + restGain);
  if(m.nPspr > bNPspr) fails.push('night partner spread ' + m.nPspr + ' vs before ' + bNPspr);
  if(m.nOspr > bNOspr) fails.push('night opponent spread ' + m.nOspr + ' vs before ' + bNOspr);
  if(m.play > m.floors.play + 1) fails.push('longest play ' + m.play + ', floor ' + m.floors.play);
  if(m.sit > m.floors.sit + 1) fails.push('longest sit ' + m.sit + ', floor ' + m.floors.sit);
  const ax = AFTER_EXCESS[key];
  if(ax == null) fails.push('no rest ratchet row for ' + key);
  else if(m.excess > Math.floor(ax * 1.05) + 2) fails.push('rest excess ' + m.excess + ' vs ' + ax);
  if(m.maxNightMs > NIGHT_MS_LIMIT) fails.push('slowest night ' + fx(m.maxNightMs, 0) + ' ms');
  return { fails, notes };
}

// ---------------------------------------------------------------------------
// genNight must never call the AI. Run it in a sandbox with every page helper stubbed
// and a fetch spy, on 1, 2 and 3 courts.
// ---------------------------------------------------------------------------
function checkGenNight(src){
  const fails = [];
  let code;
  try {
    code = [
      extractOneLiner(src, 'const KOTB_AI_SCHEDULE'),
      ...ENGINE_LINES.map(h => extractOneLiner(src, h)),
      ...ENGINE_BLOCKS.map(h => extractBlock(src, h)),
      extractBlock(src, 'function buildLocalNight('),
      extractBlock(src, 'async function genNight(')
    ].join('\n');
  } catch(e){ return ['genNight sandbox: ' + e.message]; }
  const run = async (courts) => {
    let fetches = 0, applied = null;
    const els = { 'week-sel': { value: 'w1' }, 'week-detail': { innerHTML: '', querySelector: () => null } };
    const players = {};
    for(let i=1;i<=13;i++) players['k' + i] = { id: 'k' + i, name: 'Player ' + i };
    const ctx = {
      D: { kings: { weeks: { w1: { id: 'w1', weekNum: 1 } }, players, config: { courts }, results: {} } },
      SIDE: 'kings', $: id => els[id] || null, toast: () => {}, confirm: () => true,
      clearAiError: () => {}, aiErr: () => {}, loadWeekDetail: () => {}, schedNote: () => {},
      _refuseLockedWeek: () => false, getSessionAbsences: () => [], pN: id => id,
      courtsPhrase: a => a.join(', '), extractJsonArray: () => null, AI_URL: 'https://example.invalid',
      fetch: async () => { fetches++; throw new Error('network'); },
      applyGeneratedRounds: (wid, rounds) => { applied = rounds; return true; },
      setTimeout: (f) => f(), console: { log(){}, error(){} }
    };
    const fn = new Function('ctx', 'with(ctx){\n' + code + '\nreturn genNight;\n}')(ctx);
    await fn(true);
    return { fetches, applied };
  };
  return (async () => {
    for(const courts of [[4], [1,2], [1,2,3]]){
      try {
        const r = await run(courts);
        if(r.fetches) fails.push('genNight called the network on ' + courts.length + ' court(s)');
        if(!r.applied) fails.push('genNight built nothing on ' + courts.length + ' court(s)');
        else if(r.applied.some(rd => (rd.courts||[]).length !== courts.length)) fails.push('genNight used the wrong court count');
      } catch(e){ fails.push('genNight sandbox threw: ' + e.message); }
    }
    return fails;
  })();
}

// The season build runs in a Web Worker whose source is assembled from this page's own
// functions. Run that exact source with a stand in Worker and check it matches a direct
// build, so a helper missing from the worker's list fails here and not on a phone.
function checkWorker(src){
  const NL = String.fromCharCode(10);
  let code;
  try {
    code = [...ENGINE_LINES.map(h => extractOneLiner(src, h)), ...ENGINE_BLOCKS.map(h => extractBlock(src, h)),
      extractBlock(src, 'function _seasonWorker(')].join(NL);
  } catch(e){ return Promise.resolve(['worker check: ' + e.message]); }
  const blobs = [];
  class FakeWorker {
    constructor(){
      const self = this;
      const body = blobs[blobs.length - 1].join('');
      this._on = new Function('postMessage', 'var onmessage;' + NL + body + NL + 'return onmessage;')(d => setImmediate(() => self.onmessage({ data: d })));
    }
    postMessage(d){ setImmediate(() => { try { this._on({ data: JSON.parse(JSON.stringify(d)) }); } catch(e){ this.onerror(e); } }); }
    terminate(){}
  }
  const ctx = {
    Blob: function(parts){ blobs.push(parts); }, URL: { createObjectURL: () => 'blob:check', revokeObjectURL(){} },
    Worker: FakeWorker
  };
  const api = new Function('ctx', 'with(ctx){' + NL + code + NL + 'return { _seasonWorker, buildSeasonNight };' + NL + '}')(ctx);
  const ids = []; for(let i=1;i<=13;i++) ids.push('q' + i);
  const direct = []; { const pC = {}, oC = {}, sc = {}; for(let wi=0; wi<3; wi++) direct.push(api.buildSeasonNight(ids, [1,2,3], pC, oC, sc, TARGET, wi).rounds); }
  return api._seasonWorker(ids, [1,2,3], 3, TARGET).then(
    weeks => JSON.stringify(weeks) === JSON.stringify(direct) ? [] : ['season worker output differs from a direct build'],
    e => ['season worker failed: ' + (e && e.message || e)]);
}

// Em dashes and null bytes in what this build touches: the engine and its callers in
// kotb-app.js, and this file.
function scanText(src){
  const EM = String.fromCharCode(0x2014), fails = [];
  const blocks = [...ENGINE_BLOCKS, 'function buildLocalNight(', 'async function genNight(', 'async function genFullSeason(', 'function _seasonWorker(', 'function _seasonChunked('];
  blocks.forEach(h => {
    let t; try { t = extractBlock(src, h); } catch(e){ fails.push('scan: ' + e.message); return; }
    if(t.indexOf(EM) >= 0) fails.push('em dash in ' + h);
    if(t.indexOf('\u0000') >= 0) fails.push('null byte in ' + h);
  });
  const self = fs.readFileSync(__filename, 'utf8');
  if(self.indexOf(EM) >= 0) fails.push('em dash in ' + path.basename(__filename));
  if(self.indexOf('\u0000') >= 0) fails.push('null byte in ' + path.basename(__filename));
  return fails;
}

// ---------------------------------------------------------------------------
// SUITE
// ---------------------------------------------------------------------------
async function suite(src, opts){
  const quiet = !!opts.quiet, failFast = !!opts.failFast;
  const failures = [], notes = [], rows = [];
  scanText(src).forEach(f => failures.push(f));
  (await checkGenNight(src)).forEach(f => failures.push(f));
  (await checkWorker(src)).forEach(f => failures.push(f));
  if(failFast && failures.length) return { failures, notes, rows };
  let api;
  try { api = loadEngine(src); } catch(e){ failures.push('extract: ' + e.message); return { failures, notes, rows }; }
  for(const s of setups()){
    let m;
    try { m = runSetup(api, s.n, s.courts, WEEKS); }
    catch(e){ failures.push(s.key + ': engine threw ' + e.message); if(failFast) break; continue; }
    const j = judge(m, s.key);
    j.fails.forEach(f => failures.push(s.key + ': ' + f));
    j.notes.forEach(f => notes.push(s.key + ': ' + f));
    rows.push({ s, m });
    if(failFast && failures.length) break;
  }
  if(!quiet) printTable(rows);
  return { failures, notes, rows };
}

function printTable(rows){
  const line = '-'.repeat(132);
  console.log(line);
  console.log('  ' + pad('setup',6) + pad('rds',4) + pad('sit',4) + ' | ' + pad('season P min/max/sd',20) + pad('season O min/max/sd',20)
    + '| ' + pad('night P max/sd',15) + pad('night O max/sd',15) + '| ' + pad('play(fl)',9) + pad('sit(fl)',8) + pad('bad%',5)
    + '| ' + pad('ms/night',9) + 'ms/season');
  console.log(line);
  rows.forEach(({ s, m }) => {
    const cell = (b, row) => {
      console.log('  ' + pad(s.key,6) + pad(m.R,4) + pad(m.S,4) + ' | '
        + pad(row[0] + '/' + row[1] + '/' + fx(row[2]), 20) + pad(row[3] + '/' + row[4] + '/' + fx(row[5]), 20)
        + '| ' + pad(row[6] + '/' + fx(row[7]), 15) + pad(row[9] + '/' + fx(row[10]), 15)
        + '| ' + pad(row[12] + '(' + m.floors.play + ')', 9) + pad(row[13] + '(' + m.floors.sit + ')', 8) + pad(row[14], 5)
        + '| ' + (b ? pad('before',9) : pad(fx(m.maxNightMs, 0), 9) + pad(fx(m.seasonMs, 0), 10) + 'over ' + m.over + '% excess ' + m.excess));
    };
    const b = BASELINE[s.key];
    if(b) cell(true, b);
    cell(false, rowOf(m));
  });
  console.log(line);
  console.log('  P partners, O opponents, over every pair. night max is the most times one pair met in a night,');
  console.log('  night sd the average per night. play and sit are longest runs in rounds, (fl) the setup floor.');
  console.log('  bad% is nights where anyone played 3+ in a row or sat 2+ in a row. ms/night is the slowest night.');
}
function rowOf(m){
  return [m.sPmin, m.sPmax, +fx(m.sPsd), m.sOmin, m.sOmax, +fx(m.sOsd), m.nPmax, +fx(m.nPsd), m.nPspr, m.nOmax, +fx(m.nOsd), m.nOspr, m.play, m.sit, m.bad];
}

// ---------------------------------------------------------------------------
// MUTATIONS. Each breaks one rule in an in-memory copy of kotb-app.js; the suite must
// fail on every one. Nothing on disk is changed.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  ['rest tier removed', [
    ['if(len>pT[i])pen+=(len-pT[i])*(len-pT[i]);', ''],
    ['if(r>0&&e<R&&len<ib[i])pen+=ib[i]-len;', ''],
    ['if(len>sT[i])pen+=(len-sT[i])*(len-sT[i]);', '']]],
  ['night tier removed', [
    ['cN+=3*band(p,nLoP,nHiP)+band(o,nLoO,nHiO);cG+=(p>nHiP+1?p-nHiP-1:0)+(o>nHiO+1?o-nHiO-1:0);', ''],
    ['tn+=3*band(p,nLoP,nHiP)+band(o,nLoO,nHiO);tg+=(p>nHiP+1?p-nHiP-1:0)+(o>nHiO+1?o-nHiO-1:0);', '']]],
  ['season banding replaced by plain squared counts', [
    ['cS+=3*band(hP[k]+p,sLoP,sHiP)+2*band(hO[k]+o,sLoO,sHiO);', 'cS+=3*(hP[k]+p)*(hP[k]+p)+(hO[k]+o)*(hO[k]+o);'],
    ['ts+=3*band(hP[k]+p,sLoP,sHiP)+2*band(hO[k]+o,sLoO,sHiO);', 'ts+=3*(hP[k]+p)*(hP[k]+p)+(hO[k]+o)*(hO[k]+o);']]],
  ['sitter choice reverted to game-count sort', [
    ['[candOld(),candSeq(0),candSeq(A<=S?A:S),candSeq(A<=S?A:S)]', '[candOld()]']]],
  ['streak floor ignored (no hard rest limit)', [
    ['pK[i]=Math.max(2,fP+1);sK[i]=fS+1;', 'pK[i]=R;sK[i]=R;']]],
  ['season worker missing an engine helper', [
    ['_csPv,_csChg,_ksRng,_ksFloors,buildSeasonNight].map(String)', '_csPv,_csChg,_ksRng,buildSeasonNight].map(String)']]],
  ['AI path re-enabled', [
    ['const KOTB_AI_SCHEDULE=false;', 'const KOTB_AI_SCHEDULE=true;']]]
];

async function mutations(src){
  let bad = 0;
  for(const [name, pairs] of MUTATIONS){
    const miss = pairs.find(([a]) => src.split(a).length !== 2);
    if(miss){ bad++; console.log('ANCHOR      ' + name + '  (' + miss[0].slice(0, 50) + ')'); continue; }
    const mutated = pairs.reduce((t, [a, b]) => t.split(a).join(b), src);
    const r = await suite(mutated, { quiet: true, failFast: true });
    if(r.failures.length) console.log('caught      ' + name + '  (' + r.failures[0] + ')');
    else { bad++; console.log('NOT CAUGHT  ' + name); }
  }
  console.log(bad ? '\nmutations: ' + bad + ' not caught' : '\nmutations: all caught (' + MUTATIONS.length + ')');
  return bad;
}

// ---------------------------------------------------------------------------
async function main(){
  const a = process.argv.slice(2);
  const get = (flag, def) => { const i = a.indexOf(flag); return i >= 0 && a[i+1] != null ? a[i+1] : def; };
  const srcPath = get('--src', APP);
  const src = fs.readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n');
  console.log('KotB rotation check  (' + path.relative(process.cwd(), srcPath) + ', offline)');

  if(a.includes('--emit-baseline')){
    const api = loadEngine(src, true);
    setups().forEach(s => {
      const m = runSetup(api, s.n, s.courts, WEEKS);
      console.log("  '" + s.key + "': " + JSON.stringify(rowOf(m)) + ',');
    });
    return;
  }
  if(a.includes('--emit-after')){
    const api = loadEngine(src);
    setups().forEach(s => console.log("  '" + s.key + "': " + runSetup(api, s.n, s.courts, WEEKS).excess + ','));
    return;
  }
  if(a.includes('--mutations')){
    process.exitCode = (await mutations(src)) ? 1 : 0;
    return;
  }
  const players = parseInt(get('--players', ''), 10);
  if(players){
    const courts = get('--courts', '1,2').split(',').map(x => parseInt(x, 10)).filter(Boolean);
    const m = runSetup(loadEngine(src), players, courts, parseInt(get('--weeks', String(WEEKS)), 10) || WEEKS);
    printTable([{ s: { key: players + 'x' + m.courtsN }, m }]);
    if(m.errors.length) console.log('  shape errors: ' + m.errors.slice(0, 5).join('; '));
    return;
  }
  const r = await suite(src, {});
  if(r.notes.length){ console.log('\n  Rest gains that cost one unit of season spread (allowed):'); r.notes.forEach(x => console.log('    ' + x)); }
  if(r.failures.length){ console.log('\n  FAIL'); r.failures.forEach(x => console.log('    ' + x)); }
  else console.log('\n  PASS  (' + r.rows.length + ' setups, ' + WEEKS + ' weeks each)');
  process.exitCode = r.failures.length ? 1 : 0;
}

main();
