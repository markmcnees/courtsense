#!/usr/bin/env node
/**
 * scripts/check-court-split.js
 *
 * Offline check for the fair Kings and Queens court split in kotb-app.js.
 *
 * Fair, as decided: each side capped at one court per 4 active players; lowest worst
 * sit share per round wins; then the shorter night for the slower side (6 games each);
 * then fewer sitters in total; then, on an exact tie, the side that did not win the last
 * tie (Queens when none). Queens get the lowest court numbers, Kings the next.
 *
 * The helpers are extracted from kotb-app.js by name at run time, so this always tests
 * the shipped code. The brute force below is written separately on purpose.
 *
 *   node scripts/check-court-split.js
 *   node scripts/check-court-split.js --mutations
 *
 * Offline: no Firebase, no network. Exit code 1 on any failure.
 */

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'kotb-app.js');
const HTML = path.join(__dirname, '..', 'kotb', 'index.html');
const NL = String.fromCharCode(10);

function extractBlock(src, header){
  const start = src.indexOf(header);
  if(start < 0) throw new Error('could not find "' + header + '"');
  const nl = src.indexOf('\n', start);
  const end = src.indexOf('\n}', nl);
  if(end < 0) throw new Error('could not find the end of "' + header + '"');
  return src.slice(start, end + 2);
}
function extractOneLiner(src, header){
  const start = src.indexOf(header);
  if(start < 0) throw new Error('could not find "' + header + '"');
  const end = src.indexOf('\n', start);
  return src.slice(start, end < 0 ? src.length : end);
}

const PURE = ['function parseCourts(', 'function configCourts(', 'function _ksSideNight(', 'function _ksCourtSplit(',
  'function _ksCourtCheck(', 'function _ksCourtPlan(', 'function _ksCourtPlanUpdates(', 'function _ksCourtPlanArchiveUpdates('];
const PAGE = ['function _cpLeagueCourtsSet(', 'function _cpActive(', 'function _cpHasSchedule(', 'function _cpStored(', 'function _cpWrite(',
  'function _cpMaybeAuto(', 'function cpApplyFair(', 'function cpSaveOverride(', 'function saveSeasonCfg(', 'function renderPlannerCfg('];

function loadPure(src){
  const code = [extractOneLiner(src, 'const DEFAULT_COURTS'), ...PURE.map(h => extractBlock(src, h))].join(NL);
  return new Function(code + NL + 'return { configCourts, _ksSideNight, _ksCourtSplit, _ksCourtCheck, _ksCourtPlan, _ksCourtPlanUpdates, _ksCourtPlanArchiveUpdates };')();
}
// The page functions run inside a sandbox whose writes go to spies.
function loadPage(src, ctx){
  const code = [extractOneLiner(src, 'const DEFAULT_COURTS'), ...PURE.map(h => extractBlock(src, h)),
    extractOneLiner(src, 'let _cpBusy='), ...PAGE.map(h => extractBlock(src, h))].join(NL);
  return new Function('ctx', 'with(ctx){' + NL + code + NL
    + 'return { _cpMaybeAuto, cpApplyFair, cpSaveOverride, saveSeasonCfg, renderPlannerCfg };' + NL + '}')(ctx);
}

// ---------------------------------------------------------------------------
// Independent brute force. Shares compared as exact fractions.
// ---------------------------------------------------------------------------
function bruteSplit(N, K, Q, last){
  const cands = [];
  for(let k=0;k<=N;k++) for(let q=0;q+k<=N;q++){
    if(k > Math.floor(K/4) || q > Math.floor(Q/4)) continue;
    const side = (n, c) => {
      if(n < 4) return { num: 0, den: 1, rounds: 0, sit: 0 };
      if(c === 0) return { num: 1, den: 1, rounds: 1e9, sit: n };
      const s = n - 4*c;
      return { num: s, den: n, rounds: s === 0 ? 6 : Math.ceil(6*n/(4*c)), sit: s };
    };
    const a = side(K, k), b = side(Q, q);
    const worst = a.num*b.den >= b.num*a.den ? a : b;
    cands.push({ k, q, wn: worst.num, wd: worst.den, r: Math.max(a.rounds, b.rounds), s: a.sit + b.sit });
  }
  const cmp = (x, y) => (x.wn*y.wd - y.wn*x.wd) || (x.r - y.r) || (x.s - y.s);
  cands.sort(cmp);
  const top = cands.filter(c => cmp(c, cands[0]) === 0);
  const pref = last === 'queens' ? 'kings' : 'queens';
  top.sort((x, y) => pref === 'queens' ? (y.q - x.q) : (y.k - x.k));
  return { k: top[0].k, q: top[0].q, tie: top.length > 1 };
}

const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function suite(src){
  const fails = [];
  const fail = m => { if(fails.length < 25) fails.push(m); };
  let api;
  try { api = loadPure(src); } catch(e){ return ['extract: ' + e.message]; }

  // 1. Brute force, invariants, determinism over courts 1 to 6, Kings 0 to 20, Queens 0 to 20.
  for(let N=1; N<=6; N++){
    // Scrambled, non contiguous numbers so the number assignment is tested too.
    const nums = [9, 2, 7, 4, 11, 5].slice(0, N);
    const sorted = nums.slice().sort((a,b)=>a-b);
    for(let K=0; K<=20; K++) for(let Q=0; Q<=20; Q++) for(const last of [null, 'queens', 'kings']){
      const tag = N + ' courts, ' + K + 'K ' + Q + 'Q, last tie ' + last;
      const f = api._ksCourtSplit(nums, K, Q, last);
      const b = bruteSplit(N, K, Q, last);
      if(f.kings.length !== b.k || f.queens.length !== b.q){ fail(tag + ': split ' + f.queens.length + 'Q/' + f.kings.length + 'K, expected ' + b.q + 'Q/' + b.k + 'K'); continue; }
      if(!!f.tie !== b.tie) fail(tag + ': tie flag');
      if(!sameList(f.queens, sorted.slice(0, b.q)) || !sameList(f.kings, sorted.slice(b.q, b.q + b.k))) fail(tag + ': numbers ' + f.queens + ' | ' + f.kings);
      if(f.kings.some(x => f.queens.indexOf(x) >= 0)) fail(tag + ': overlap');
      if(f.kings.length > Math.floor(K/4) || f.queens.length > Math.floor(Q/4)) fail(tag + ': over cap');
      const used = f.kings.length + f.queens.length;
      if(used < N && !(f.kings.length === Math.floor(K/4) && f.queens.length === Math.floor(Q/4))) fail(tag + ': court left unused while a side could take it');
      if(!sameList(f.unused, sorted.slice(used))) fail(tag + ': unused list');
      const need = (K>=4?1:0) + (Q>=4?1:0);
      if(N >= need && ((K>=4 && !f.kings.length) || (Q>=4 && !f.queens.length))) fail(tag + ': a 4+ side got no court although one was available');
      if(f.tooFew !== (K>=4 && Q>=4 && (!f.kings.length || !f.queens.length))) fail(tag + ': tooFew flag');
      if(JSON.stringify(api._ksCourtSplit(nums, K, Q, last)) !== JSON.stringify(f)) fail(tag + ': not deterministic');
    }
  }
  // The case that started this: 4 courts, 8 Kings, 13 Queens is 2 and 2, not 1 and 3.
  { const f = api._ksCourtSplit([1,2,3,4], 8, 13, null);
    if(!sameList(f.queens, [1,2]) || !sameList(f.kings, [3,4])) fail('4 courts 8K 13Q should be Queens 1,2 and Kings 3,4'); }

  // 2. Plan logic. Manual is never replaced; auto applies only with no schedule.
  for(let K=0; K<=20; K+=3) for(let Q=0; Q<=20; Q+=2) for(const sched of [false, true]){
    const man = api._ksCourtPlan({ courts:[1,2,3,4], mode:'manual', kings:[4], queens:[1,2,3] }, K, Q, sched);
    if(man.autoApply) fail('manual plan would be auto applied (' + K + 'K ' + Q + 'Q)');
    if(!sameList(man.current.kings, [4]) || !sameList(man.current.queens, [1,2,3])) fail('manual plan current split changed');
    const auto = api._ksCourtPlan({ courts:[1,2,3,4], mode:'auto', kings:[], queens:[] }, K, Q, sched);
    const want = !sched && !auto.fair.tooFew && auto.differs;
    if(auto.autoApply !== want) fail('auto apply ' + auto.autoApply + ' with schedule ' + sched + ' (' + K + 'K ' + Q + 'Q)');
    if(sched && auto.autoApply) fail('auto applied after a schedule exists');
  }
  // 3. Updates: both sides and the plan in one update; a side with no courts is 'none'.
  { const u = api._ksCourtPlanUpdates({ courts:[1,2,3,4], lastTieWinner:'kings' }, [3,4], [1,2], 'auto', 8, 13, null);
    if(!u['court_plan'] || !sameList(u['kings/config/courts'], [3,4]) || !sameList(u['queens/config/courts'], [1,2])) fail('updates do not carry both sides and the plan');
    if(u['court_plan'].lastTieWinner !== 'kings') fail('updates dropped lastTieWinner');
    const z = api._ksCourtPlanUpdates({ courts:[1] }, [], [1], 'manual', 8, 8, null);
    if(z['kings/config/courts'] !== 'none') fail('a side with no court is not stored as none');
    if(api.configCourts({ courts:'none' }).length !== 0) fail('configCourts does not read none as no courts'); }
  // 3b. Close & Archive: mode back to auto, courts kept, tie winner rolled forward.
  { const a = api._ksCourtPlanArchiveUpdates({ courts:[1,2,3,4], mode:'manual', kings:[4], queens:[1,2,3], tieWinner:'queens' });
    if(!a || a['court_plan/mode'] !== 'auto') fail('Close & Archive does not reset the court plan to auto');
    if(a && (a['court_plan/lastTieWinner'] !== 'queens' || a['court_plan/tieWinner'] !== null)) fail('Close & Archive does not roll the tie winner');
    if(a && Object.keys(a).some(k => /courts|kings|queens$/.test(k) && k !== 'court_plan/lastTieWinner')) fail('Close & Archive touches the league courts or the split');
    const b = api._ksCourtPlanArchiveUpdates({ courts:[1,2], mode:'manual' });
    if(!b || b['court_plan/mode'] !== 'auto' || 'court_plan/lastTieWinner' in b) fail('Close & Archive without a tie should only reset the mode');
    if(api._ksCourtPlanArchiveUpdates(null) !== null) fail('Close & Archive with no plan should change nothing');
    let close = '';
    try { close = extractBlock(src, 'async function doCloseSeason('); } catch(e){ fail('scan: ' + e.message); }
    const flat = close.replace(/\s+/g, '');
    if(flat.indexOf('const_cpu=_ksCourtPlanArchiveUpdates(D.courtPlan);if(_cpu){constcpOk=awaitfbUpdate(_cpu);') < 0) fail('Close & Archive does not write the court plan reset'); }
  // 4. Override checks.
  { const c = (k, q, K, Q, total) => api._ksCourtCheck(total || [1,2,3,4], k, q, K, Q);
    if(c([3,4],[1,2],8,13)) fail('valid override refused: ' + c([3,4],[1,2],8,13));
    if(!c([2,3],[1,2],8,13)) fail('overlapping override accepted');
    if(!c([2,3,4],[1],8,13)) fail('override over the Kings cap accepted');
    if(!c([],[1,2,3,4],8,16)) fail('override with no Kings court accepted');
    if(!c([5],[1],8,8)) fail('override with a court outside the league accepted');
    if(c([],[1],8,8,[1])) fail('one court for two sides should allow one side none'); }

  // 5. Page writers in a sandbox with spies.
  const page = (D, extra) => {
    const writes = [], sets = [];
    const els = { 'cfg-day':{value:'1'}, 'cfg-start':{value:'2027-01-04'}, 'cfg-weeks':{value:'2'}, 'cfg-score':{value:'15'}, 'cfg-skips':{value:''}, 'cfg-courts-note':{ style:{} } };
    const ctx = Object.assign({
      D, SIDE:'kings', $: id => els[id] || null, toast: () => {}, confirm: () => true, document:{ activeElement:null },
      fbUpdate: u => { writes.push(u); return Promise.resolve(true); },
      fbSet: (p, v) => { sets.push([p, v]); return Promise.resolve(true); },
      esc: s => s, escAttr: s => s, renderCourtPlan: () => {}
    }, extra || {});
    return { fns: loadPage(src, ctx), writes, sets, els };
  };
  const roster = n => { const o = {}; for(let i=1;i<=n;i++) o['x'+i] = { id:'x'+i, name:'P'+i }; return o; };
  const mkD = (plan, rounds) => ({
    kings:{ config:{ courts:[4] }, players:roster(8), weeks: rounds ? { w1:{ id:'w1', weekNum:1, rounds:[{round:1}] } } : {}, results:{} },
    queens:{ config:{ courts:[1,2,3] }, players:roster(13), weeks:{}, results:{} },
    courtPlan: plan
  });
  try {
    // Auto, no schedule: one update with both sides and the plan.
    let p = page(mkD({ courts:[1,2,3,4], mode:'auto' }, false));
    p.fns._cpMaybeAuto(); await new Promise(r => setImmediate(r));
    if(p.writes.length !== 1) fail('auto with no schedule wrote ' + p.writes.length + ' updates');
    else {
      const u = p.writes[0];
      if(!sameList(u['kings/config/courts'], [3,4]) || !sameList(u['queens/config/courts'], [1,2]) || !u['court_plan']) fail('auto apply did not write both sides together');
    }
    if(p.sets.some(([path]) => /config/.test(path))) fail('auto apply wrote a side config on its own');
    // Auto, schedule exists: nothing.
    p = page(mkD({ courts:[1,2,3,4], mode:'auto' }, true));
    p.fns._cpMaybeAuto(); await new Promise(r => setImmediate(r));
    if(p.writes.length) fail('auto applied after weeks were scheduled');
    // Manual: nothing, even with no schedule.
    p = page(mkD({ courts:[1,2,3,4], mode:'manual', kings:[4], queens:[1,2,3], setAt:1 }, false));
    p.fns._cpMaybeAuto(); await new Promise(r => setImmediate(r));
    if(p.writes.length) fail('auto overwrote a manual plan');
    // Use the fair split from manual: one update, both sides.
    p.fns.cpApplyFair(); await new Promise(r => setImmediate(r));
    if(p.writes.length !== 1 || !p.writes[0]['kings/config/courts'] || !p.writes[0]['queens/config/courts'] || p.writes[0]['court_plan'].mode !== 'auto') fail('Use the fair split did not write both sides and auto mode');
    // Override with an overlap is refused.
    p = page(mkD({ courts:[1,2,3,4], mode:'auto', kings:[3,4], queens:[1,2], setAt:1 }, false), {});
    p.els['cp-oq'] = { value:'1, 2, 3' }; p.els['cp-ok'] = { value:'3, 4' };
    p.fns.cpSaveOverride(); await new Promise(r => setImmediate(r));
    if(p.writes.length) fail('an overlapping override was saved');
    p.els['cp-oq'] = { value:'1, 2' }; p.els['cp-ok'] = { value:'3, 4' };
    p.els['cp-oq'].value = '1, 2, 3'; p.els['cp-ok'].value = '4';
    p.fns.cpSaveOverride(); await new Promise(r => setImmediate(r));
    if(p.writes.length !== 1 || p.writes[0]['court_plan'].mode !== 'manual' || !sameList(p.writes[0]['kings/config/courts'], [4]) || !sameList(p.writes[0]['queens/config/courts'], [1,2,3])) fail('a valid override was not saved as manual with both sides');
    // The old court box once league courts are set: read-only, and a save keeps the stored
    // courts whatever the box says. Only Override and Apply write courts.
    let D2 = mkD({ courts:[1,2,3,4], mode:'auto', kings:[3,4], queens:[1,2], setAt:1 }, false);
    D2.kings.config.courts = [3,4];
    p = page(D2);
    p.els['cfg-courts'] = { value:'2' };
    p.fns.saveSeasonCfg(); await new Promise(r => setImmediate(r));
    const cfgSet = p.sets.find(([path]) => path === 'kings/config');
    if(!cfgSet) fail('Save Season Config did not save the config');
    else if(!sameList(cfgSet[1].courts, [3,4])) fail('the side court box wrote courts while league courts are set (' + JSON.stringify(cfgSet[1].courts) + ')');
    if(p.writes.length || p.sets.some(([path]) => /court_plan|config\/courts/.test(path))) fail('Save Season Config wrote the court plan or courts');
    p.fns.renderPlannerCfg();
    if(p.els['cfg-courts'].readOnly !== true) fail('the side court box is not read-only while league courts are set');
    if(!p.els['cfg-courts-note'] || p.els['cfg-courts-note'].style.display !== 'block') fail('the Override note is not shown');
    // With no league courts set, the box works as before.
    D2 = mkD(null, false);
    p = page(D2);
    p.els['cfg-courts'] = { value:'4' };
    p.fns.saveSeasonCfg(); await new Promise(r => setImmediate(r));
    const cfgSet2 = p.sets.find(([path]) => path === 'kings/config');
    if(!cfgSet2 || !sameList(cfgSet2[1].courts, [4])) fail('with no league courts the side box no longer saves');
    p.fns.renderPlannerCfg();
    if(p.els['cfg-courts'].readOnly !== false) fail('the side court box is read-only with no league courts');
    if(p.els['cfg-courts-note'].style.display !== 'none') fail('the Override note shows with no league courts');
  } catch(e){ fail('page sandbox threw: ' + e.message); }

  // 6. The Courts block is in the page, above STEP 1, and the version tag points at a tag.
  try {
    const html = fs.readFileSync(HTML, 'utf8');
    const a = html.indexOf('id="cp-courts"'), b = html.indexOf('STEP 1');
    if(a < 0 || b < 0 || a > b) fail('Courts block missing or not above STEP 1');
    if(html.indexOf('id="cp-body"') < 0) fail('Courts block has no body');
  } catch(e){ fail('html: ' + e.message); }

  // 7. Em dashes and null bytes in the touched files.
  const EM = String.fromCharCode(0x2014);
  for(const h of [...PURE.slice(2), ...PAGE, 'function renderCourtPlan(', 'function cpSaveCourts(', 'function fbUpdate(']){
    try { const t = extractBlock(src, h); if(t.indexOf(EM) >= 0) fail('em dash in ' + h); if(t.indexOf('\u0000') >= 0) fail('null byte in ' + h); }
    catch(e){ fail('scan: ' + e.message); }
  }
  const self = fs.readFileSync(__filename, 'utf8');
  if(self.indexOf(EM) >= 0 || self.indexOf('\u0000') >= 0) fail('em dash or null byte in this file');
  return fails;
}

// Equivalent mutations: they must NOT change any answer, and the run confirms they do not.
// A side's night length is ceil(6 / (1 - sit share)), which only rises with its sit share,
// so the slower side's night always ranks splits exactly as the worst sit share does.
// Tie-break 1 can therefore never decide anything on its own, and moving it around is a
// no-op. If a future change makes either of these alter an answer, the order needs review.
const EQUIVALENT = [
  ['tie-breaks 1 and 2 swapped', [["    if(a[1]!==b[1]) return a[1]<b[1]?-1:1;\n    return a[2]-b[2];", "    if(a[2]!==b[2]) return a[2]-b[2];\n    return a[1]===b[1]?0:(a[1]<b[1]?-1:1);"]]],
  ['night length before sit share', [["    if(Math.abs(a[0]-b[0])>1e-9) return a[0]-b[0];\n    if(a[1]!==b[1]) return a[1]<b[1]?-1:1;",
    "    if(a[1]!==b[1]) return a[1]<b[1]?-1:1;\n    if(Math.abs(a[0]-b[0])>1e-9) return a[0]-b[0];"]]],
  // Every split that uses all the courts has the same total sitters, so ranking sitters
  // first only rules out idle courts, which the sit share already never prefers.
  ['total sitters before sit share', [["    if(Math.abs(a[0]-b[0])>1e-9) return a[0]-b[0];\n",
    "    if(a[2]!==b[2]) return a[2]-b[2];\n    if(Math.abs(a[0]-b[0])>1e-9) return a[0]-b[0];\n"]]]
];
const MUTATIONS = [
  ['tie-breaks 1 and 2 removed (exact tie decided by side alone)', [["    if(a[1]!==b[1]) return a[1]<b[1]?-1:1;\n    return a[2]-b[2];", '    return 0;']]],
  ['tie-break 3 reversed (tie goes to the last winner)', [["  const prefer=lastTieWinner==='queens'?'kings':'queens';", "  const prefer=lastTieWinner==='kings'?'kings':'queens';"]]],
  ['cap removed', [['  const capK=Math.floor(K/4),capQ=Math.floor(Q/4);', '  const capK=N,capQ=N;']]],
  ['proportional substituted', [['  const queens=nums.slice(0,best.q),kings=nums.slice(best.q,best.q+best.k);',
    '  const _pk=N>=2&&K>=4&&Q>=4?Math.max(1,Math.min(N-1,Math.round(N*K/(K+Q)))):best.k,_pq=N>=2&&K>=4&&Q>=4?N-_pk:best.q;\n  const queens=nums.slice(0,_pq),kings=nums.slice(_pq,_pq+_pk);']]],
  ['override ignored', [["  const mode=st.mode==='manual'?'manual':'auto';", "  const mode='auto';"]]],
  ['overlapping numbers', [['kings=nums.slice(best.q,best.q+best.k);', 'kings=nums.slice(0,best.k);']]],
  ['zero-court side', [['  if(c<1) return {playable:true,courts:0,sitShare:1,rounds:Infinity,sitters:n};', '  if(c<1) return {playable:false,courts:0,sitShare:0,rounds:0,sitters:0};']]],
  ['one side written', [["  u['queens/config/courts']=plan.queens.length?plan.queens:'none';", '']]],
  ['auto apply after weeks exist', [['  const autoApply=mode===\'auto\'&&!hasSchedule&&', "  const autoApply=mode==='auto'&&"]]],
  ['auto apply after weeks exist (caller)', [["  const r=_ksCourtPlan(_cpStored(),_cpActive('kings'),_cpActive('queens'),_cpHasSchedule());\n  if(!r.ready||!r.autoApply||_cpBusy) return false;",
    "  const r=_ksCourtPlan(_cpStored(),_cpActive('kings'),_cpActive('queens'),false);\n  if(!r.ready||!r.autoApply||_cpBusy) return false;"]]],
  ['archive keeps mode manual', [["  const u={'court_plan/mode':'auto'};", '  const u={};']]],
  ['archive skips the plan update', [['    const _cpu=_ksCourtPlanArchiveUpdates(D.courtPlan);', '    const _cpu=null;']]],
  ['side box still writes', [['    if(cur!=null) cfg.courts=cur; else delete cfg.courts;', '']]],
  ['side box not read-only', [['  if(_cc) _cc.readOnly=_lc;', '']]]
];

async function main(){
  const src = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
  console.log('KotB court split check  (offline)');
  if(process.argv.includes('--mutations')){
    let bad = 0;
    for(const [name, pairs] of MUTATIONS){
      const miss = pairs.find(([a]) => src.split(a).length !== 2);
      if(miss){ bad++; console.log('ANCHOR      ' + name); continue; }
      const m = pairs.reduce((t, [a, b]) => t.split(a).join(b), src);
      const f = await suite(m);
      if(f.length) console.log('caught      ' + name + '  (' + f[0] + ')');
      else { bad++; console.log('NOT CAUGHT  ' + name); }
    }
    for(const [name, pairs] of EQUIVALENT){
      if(pairs.some(([a]) => src.split(a).length !== 2)){ bad++; console.log('ANCHOR      ' + name); continue; }
      const f = await suite(pairs.reduce((t, [a, b]) => t.split(a).join(b), src));
      if(f.length){ bad++; console.log('NOT EQUIV   ' + name + ' now changes answers; review the tie-break order  (' + f[0] + ')'); }
      else console.log('equivalent  ' + name + '  (no answer changes, as expected)');
    }
    console.log(bad ? NL + 'mutations: ' + bad + ' not caught' : NL + 'mutations: all caught (' + MUTATIONS.length + '), equivalents confirmed (' + EQUIVALENT.length + ')');
    process.exitCode = bad ? 1 : 0;
    return;
  }
  const f = await suite(src);
  if(f.length){ console.log('FAIL'); f.forEach(x => console.log('  ' + x)); process.exitCode = 1; }
  else console.log('PASS  (6 x 21 x 21 x 3 split cases, plan, updates, override, page writers, html, scan)');
}
main();
