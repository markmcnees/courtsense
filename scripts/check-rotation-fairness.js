#!/usr/bin/env node
/**
 * scripts/check-rotation-fairness.js
 *
 * Offline fairness harness for the KotB rotation generator.
 *
 * KotB scores individuals, so who you are drawn with directly moves the standings.
 * A generator that hands one pair nine nights together and another pair two is not
 * a cosmetic problem, it decides the league. There is no other test of this code.
 *
 * The generator is NOT copied here. It is extracted from the live kotb-app.js at
 * run time by locating each function by name and reading to its closing brace, so
 * this harness always measures the shipped code and cannot silently drift from it.
 * Edit kotb-app.js and rerun; the numbers move with it.
 *
 * Runs entirely offline. No Firebase, no admin key, no network.
 *
 *   node scripts/check-rotation-fairness.js
 *   node scripts/check-rotation-fairness.js --players 13 --courts 1,2,3 --weeks 8
 *   node scripts/check-rotation-fairness.js --only-scenarios
 *   node scripts/check-rotation-fairness.js --verbose        (per scenario detail)
 */

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'kotb-app.js');

// ---------------------------------------------------------------------------
// EXTRACTION
// Pull the real functions out of kotb-app.js by NAME, not by line number, so a
// future edit that moves them does not silently break or, worse, silently make
// this harness measure the wrong thing.
// ---------------------------------------------------------------------------
function extractBlock(src, header){
  const start = src.indexOf(header);
  if(start < 0) throw new Error('could not find "' + header + '" in kotb-app.js');
  // Scan to the first line that is a closing brace at column 0. Every function
  // this harness needs is declared at top level in that file.
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

function loadGenerator(){
  const src = fs.readFileSync(APP, 'utf8');
  const parts = [
    extractOneLiner(src, 'const DEFAULT_COURTS'),
    extractBlock(src, 'function parseCourts('),
    extractBlock(src, 'function configCourts('),
    extractOneLiner(src, 'function _csPv('),
    extractOneLiner(src, 'function _csChg('),
    extractBlock(src, 'function buildSeasonNight(')
  ];
  const code = parts.join('\n');
  const factory = new Function(code + '\nreturn { parseCourts, configCourts, buildSeasonNight };');
  return { api: factory(), bytes: code.length, pieces: parts.length };
}

// ---------------------------------------------------------------------------
// MEASUREMENT
// ---------------------------------------------------------------------------
function stdev(list){
  if(!list.length) return 0;
  const m = list.reduce((a,b)=>a+b,0) / list.length;
  return Math.sqrt(list.reduce((a,b)=>a+(b-m)*(b-m),0) / list.length);
}
function fx(n, d){ return Number(n).toFixed(d == null ? 2 : d); }
function pad(s,n){ s=String(s); return s.length>=n ? s.slice(0,n) : s + ' '.repeat(n-s.length); }
function padL(s,n){ s=String(s); return s.length>=n ? s : ' '.repeat(n-s.length) + s; }
function hr(c){ console.log((c||'-').repeat(100)); }

// Run the generator exactly the way genFullSeason does: one shared pC, oC and
// sitCount carried across every week, weekIdx incrementing.
function runSeason(api, players, courts, weeks, target){
  const ids = [];
  for(let i=1;i<=players;i++) ids.push('p' + String(i).padStart(2,'0'));
  const pC = {}, oC = {}, sitCount = {};
  const allRounds = [];
  for(let wi=0; wi<weeks; wi++){
    const res = api.buildSeasonNight(ids, courts, pC, oC, sitCount, target, wi);
    if(!res) return null;
    allRounds.push(res.rounds);
  }
  return { ids, weeks: allRounds };
}

function measure(ids, weekRounds){
  const P = {}, O = {}, GP = {}, SIT = {};
  ids.forEach(a => { GP[a]=0; SIT[a]=0; P[a]={}; O[a]={};
    ids.forEach(b => { if(a!==b){ P[a][b]=0; O[a][b]=0; } }); });

  let games = 0, rounds = 0;
  const courtNums = new Set();
  const roundsPerWeek = [];

  weekRounds.forEach(rs => {
    roundsPerWeek.push(rs.length);
    rounds += rs.length;
    rs.forEach(rd => {
      (rd.sitting||[]).forEach(id => { if(SIT[id]!=null) SIT[id]++; });
      (rd.courts||[]).forEach(ct => {
        courtNums.add(ct.court);
        const t1 = ct.t1||[], t2 = ct.t2||[];
        if(t1.length!==2 || t2.length!==2) return;
        games++;
        [...t1,...t2].forEach(id => { if(GP[id]!=null) GP[id]++; });
        P[t1[0]][t1[1]]++; P[t1[1]][t1[0]]++;
        P[t2[0]][t2[1]]++; P[t2[1]][t2[0]]++;
        t1.forEach(a => t2.forEach(b => { O[a][b]++; O[b][a]++; }));
      });
    });
  });

  const pairs = [];
  for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++) pairs.push([ids[i], ids[j]]);
  const pv = pairs.map(([a,b]) => P[a][b]);
  const ov = pairs.map(([a,b]) => O[a][b]);
  const gp = ids.map(a => GP[a]);
  const st = ids.map(a => SIT[a]);

  const stat = v => ({
    mn: Math.min(...v), mx: Math.max(...v),
    mean: v.reduce((a,b)=>a+b,0)/v.length, sd: stdev(v),
    zero: v.filter(x => x === 0).length
  });

  return {
    games, rounds, roundsPerWeek, courtNums: [...courtNums].sort((a,b)=>a-b),
    nPairs: pairs.length,
    partnerships: games * 2, matchups: games * 4,
    P: stat(pv), O: stat(ov),
    gp: { mn: Math.min(...gp), mx: Math.max(...gp) },
    sit: { mn: Math.min(...st), mx: Math.max(...st) },
    GP, SIT, Pm: P, Om: O, ids, pairs
  };
}

// The arithmetic floor. Totals must divide across the pairs, so when the ideal is
// not a whole number the tightest possible distribution is floor and ceil, a spread
// of 1. This is a LOWER BOUND on the spread, not a promise that a design achieving
// it exists for every shape.
function floorSpread(total, nPairs){
  return (total % nPairs === 0) ? 0 : 1;
}

function detail(label, m, players, courts, weeks, target){
  hr('=');
  console.log(label);
  hr('=');
  const courtsN = Math.min(courts.length, Math.floor(players/4));
  const sitPer = players - courtsN*4;
  console.log('  SETUP');
  console.log('    players             : ' + players);
  console.log('    court list          : ' + JSON.stringify(courts)
    + '   effective courts: ' + courtsN + (courtsN < courts.length ? '  (clamped by roster size)' : ''));
  console.log('    sitters per round   : ' + sitPer);
  console.log('    rounds per week     : ' + [...new Set(m.roundsPerWeek)].join(', '));
  console.log('    weeks               : ' + weeks + '   total rounds: ' + m.rounds);
  console.log('    target games/night  : ' + target);
  console.log('    total games         : ' + m.games);
  console.log('    total partnerships  : ' + m.partnerships + '   total matchups: ' + m.matchups);
  console.log('    distinct pairs      : ' + m.nPairs);
  console.log('    court numbers used  : ' + JSON.stringify(m.courtNums));

  const idealP = m.partnerships / m.nPairs;
  const idealO = m.matchups / m.nPairs;
  const fP = floorSpread(m.partnerships, m.nPairs);
  const fO = floorSpread(m.matchups, m.nPairs);

  console.log('\n  PARTNERS');
  console.log('    ideal per pair      : ' + fx(idealP));
  console.log('    min ' + m.P.mn + '   max ' + m.P.mx + '   mean ' + fx(m.P.mean)
    + '   stdev ' + fx(m.P.sd) + '   spread ' + (m.P.mx - m.P.mn));
  console.log('    never-partnered pairs: ' + m.P.zero + ' of ' + m.nPairs);
  console.log('    arithmetic floor spread: ' + fP + '   GAP: ' + ((m.P.mx-m.P.mn) - fP));

  console.log('\n  OPPONENTS');
  console.log('    ideal per pair      : ' + fx(idealO));
  console.log('    min ' + m.O.mn + '   max ' + m.O.mx + '   mean ' + fx(m.O.mean)
    + '   stdev ' + fx(m.O.sd) + '   spread ' + (m.O.mx - m.O.mn));
  console.log('    never-faced pairs   : ' + m.O.zero + ' of ' + m.nPairs);
  console.log('    arithmetic floor spread: ' + fO + '   GAP: ' + ((m.O.mx-m.O.mn) - fO));

  console.log('\n  GAMES AND SITS PER PLAYER');
  console.log('    games: ' + m.gp.mn + ' to ' + m.gp.mx + '  (spread ' + (m.gp.mx-m.gp.mn) + ')'
    + '    sits: ' + m.sit.mn + ' to ' + m.sit.mx + '  (spread ' + (m.sit.mx-m.sit.mn) + ')');
  console.log('');
}

// ---------------------------------------------------------------------------
// SCENARIOS
// ---------------------------------------------------------------------------
function buildScenarios(){
  const out = [];
  // The two live shapes, named so a regression on either is obvious.
  out.push({ tag: 'QUEENS today', players: 13, courts: [1,2,3], weeks: 8, target: 6 });
  out.push({ tag: 'KINGS today',  players:  8, courts: [4],     weeks: 8, target: 6 });
  // A sweep. Sitters per round is what starves the optimiser, so the sweep
  // deliberately covers 0, 1 and 2 sitters at several roster sizes.
  //
  // Deduped by EFFECTIVE court count. buildSeasonNight clamps to floor(n/4), so on
  // a small roster a 2, 3 and 4 court list all collapse to the same shape and would
  // otherwise print as identical rows. Keep the shortest list that reaches each shape.
  const seen = new Set();
  for(let p=9; p<=20; p++){
    for(let c=1; c<=4; c++){
      const courtsN = Math.min(c, Math.floor(p/4));
      if(courtsN < 1) continue;
      const key = p + ':' + courtsN;
      if(seen.has(key)) continue;
      seen.add(key);
      const courts = [];
      for(let i=1;i<=c;i++) courts.push(i);
      out.push({ tag: '', players: p, courts, weeks: 8, target: 6 });
    }
  }
  return out;
}

function parseArgs(){
  const a = process.argv.slice(2);
  const get = (flag, def) => { const i = a.indexOf(flag); return i >= 0 && a[i+1] != null ? a[i+1] : def; };
  return {
    players: parseInt(get('--players', ''), 10) || null,
    courts:  get('--courts', null),
    weeks:   parseInt(get('--weeks', '8'), 10) || 8,
    target:  parseInt(get('--target', '6'), 10) || 6,
    verbose: a.includes('--verbose'),
    onlyScenarios: a.includes('--only-scenarios')
  };
}

function main(){
  const args = parseArgs();
  let gen;
  try { gen = loadGenerator(); }
  catch(e){ console.error('Could not extract the generator from kotb-app.js: ' + e.message); process.exit(1); }

  console.log('KotB rotation fairness harness');
  console.log('  generator source : ' + path.relative(process.cwd(), APP)
    + '   (' + gen.pieces + ' blocks, ' + gen.bytes + ' bytes, extracted by name at run time)');
  console.log('  mode             : offline, no Firebase, no network');
  console.log('');

  // Single ad hoc run when --players is given.
  if(args.players && !args.onlyScenarios){
    const courts = args.courts ? args.courts.split(',').map(s=>parseInt(s.trim(),10)).filter(Boolean) : [1,2];
    const r = runSeason(gen.api, args.players, courts, args.weeks, args.target);
    if(!r){ console.log('  generator returned null: roster too small for that court list'); process.exit(0); }
    detail('AD HOC RUN', measure(r.ids, r.weeks), args.players, courts, args.weeks, args.target);
    return;
  }

  const scenarios = buildScenarios();
  const rows = [];
  scenarios.forEach(s => {
    const r = runSeason(gen.api, s.players, s.courts, s.weeks, s.target);
    if(!r){ rows.push({ s, skip: true }); return; }
    const m = measure(r.ids, r.weeks);
    rows.push({ s, m });
    if(args.verbose || s.tag){
      detail((s.tag ? s.tag + '  ' : '') + s.players + ' players, courts '
        + JSON.stringify(s.courts) + ', ' + s.weeks + ' weeks', m, s.players, s.courts, s.weeks, s.target);
    }
  });

  hr('=');
  console.log('SUMMARY, all scenarios');
  hr('=');
  console.log('  ' + pad('scenario',16) + padL('plrs',5) + padL('crts',5) + padL('sit',4)
    + padL('rds/wk',7) + padL('games',7)
    + '  |' + padL('P min',6) + padL('max',5) + padL('sprd',5) + padL('floor',6) + padL('gap',5) + padL('stdev',7) + padL('none',5)
    + '  |' + padL('O min',6) + padL('max',5) + padL('sprd',5) + padL('gap',5) + padL('none',5)
    + '  |' + padL('gm sprd',8) + padL('sit sprd',9));
  hr();
  rows.forEach(({ s, m, skip }) => {
    if(skip){
      console.log('  ' + pad(s.tag || '', 16) + padL(s.players,5) + padL(s.courts.length,5)
        + '   generator returned null (roster too small for that court list)');
      return;
    }
    const courtsN = Math.min(s.courts.length, Math.floor(s.players/4));
    const sitPer = s.players - courtsN*4;
    const fP = floorSpread(m.partnerships, m.nPairs);
    const fO = floorSpread(m.matchups, m.nPairs);
    const pSpread = m.P.mx - m.P.mn, oSpread = m.O.mx - m.O.mn;
    const flag = (pSpread - fP) >= 3 ? '  <== far from floor' : (pSpread - fP) === 0 ? '  ok' : '';
    console.log('  ' + pad(s.tag || '', 16) + padL(s.players,5) + padL(courtsN,5) + padL(sitPer,4)
      + padL(m.roundsPerWeek[0],7) + padL(m.games,7)
      + '  |' + padL(m.P.mn,6) + padL(m.P.mx,5) + padL(pSpread,5) + padL(fP,6) + padL(pSpread-fP,5) + padL(fx(m.P.sd),7) + padL(m.P.zero,5)
      + '  |' + padL(m.O.mn,6) + padL(m.O.mx,5) + padL(oSpread,5) + padL(oSpread-fO,5) + padL(m.O.zero,5)
      + '  |' + padL(m.gp.mx-m.gp.mn,8) + padL(m.sit.mx-m.sit.mn,9) + flag);
  });
  hr();
  console.log('  P = partners, O = opponents. sprd = max minus min. floor = arithmetic lower bound');
  console.log('  on the spread, so gap = how far this shape is from the tightest possible.');
  console.log('  none = pairs that never partner or never meet. sit = sitters per round.');
  hr('=');
}

main();
