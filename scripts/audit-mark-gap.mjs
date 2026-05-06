#!/usr/bin/env node
// Read-only: enumerate all Mark kings results and reconcile against rating histories.

const DB = 'https://leon-beach-volleyball-default-rtdb.firebaseio.com';

async function get(p) {
  const res = await fetch(`${DB}${p}.json`);
  if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
  return res.json();
}

const [kingsResults, kingsPlayers, markRating, markMcneesRating] = await Promise.all([
  get('/tally_kotb/kings/results'),
  get('/tally_kotb/kings/players'),
  get('/tally_kotb_pickup/ratings/mark'),
  get('/tally_kotb_pickup/ratings/mark_mcnees'),
]);

const markPid = Object.entries(kingsPlayers).find(([, p]) => p?.name === 'Mark')?.[0];
console.log(`Mark kings player ID: ${markPid}`);

const markHistKeys = new Set(Object.keys(markRating?.history ?? {}));
const mcneesHistKeys = new Set(Object.keys(markMcneesRating?.history ?? {}));
console.log(`mark history game IDs: ${markHistKeys.size}, mark_mcnees history game IDs: ${mcneesHistKeys.size}`);

// Build timestamp lookup too
const markHistTs = new Map(Object.values(markRating?.history ?? {}).map((h) => [h.timestamp, h]));
const mcneesHistTs = new Map(Object.values(markMcneesRating?.history ?? {}).map((h) => [h.timestamp, h]));

const markGames = [];
for (const [rid, r] of Object.entries(kingsResults)) {
  const inT1 = Array.isArray(r?.t1) && r.t1.includes(markPid);
  const inT2 = Array.isArray(r?.t2) && r.t2.includes(markPid);
  if (!inT1 && !inT2) continue;
  const partnerIds = inT1 ? r.t1.filter((x) => x !== markPid) : r.t2.filter((x) => x !== markPid);
  const oppIds = inT1 ? (r.t2 ?? []) : (r.t1 ?? []);
  markGames.push({
    rid, ts: r.ts, court: r.court, round: r.round, weekId: r.weekId,
    isForfeit: !!r.isForfeit,
    score: inT1 ? r.s1 : r.s2,
    oppScore: inT1 ? r.s2 : r.s1,
    won: (inT1 ? r.s1 : r.s2) > (inT1 ? r.s2 : r.s1),
    partner: partnerIds.map((id) => kingsPlayers[id]?.name ?? `(missing ${id})`).join(', '),
    opponents: oppIds.map((id) => kingsPlayers[id]?.name ?? `(missing ${id})`).join(', '),
    inMarkHist: markHistKeys.has(rid) || markHistTs.has(r.ts),
    inMcneesHist: mcneesHistKeys.has(rid) || mcneesHistTs.has(r.ts),
  });
}

markGames.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

console.log(`\nTotal Mark kings results: ${markGames.length}`);
const inHist = markGames.filter((g) => g.inMarkHist || g.inMcneesHist);
const missing = markGames.filter((g) => !g.inMarkHist && !g.inMcneesHist);
console.log(`In a rating history: ${inHist.length} (mark: ${markGames.filter((g)=>g.inMarkHist).length}, mark_mcnees: ${markGames.filter((g)=>g.inMcneesHist).length})`);
console.log(`Missing from BOTH histories: ${missing.length}`);

console.log('\nCourt distribution:');
const courtCounts = {};
for (const g of markGames) courtCounts[g.court] = (courtCounts[g.court] ?? 0) + 1;
console.log(courtCounts);

console.log('\nMissing-court distribution:');
const missCourtCounts = {};
for (const g of missing) missCourtCounts[g.court] = (missCourtCounts[g.court] ?? 0) + 1;
console.log(missCourtCounts);

console.log('\n=== ALL 24 MARK KINGS RESULTS (chronological) ===');
for (const g of markGames) {
  const date = new Date(g.ts).toISOString().slice(0, 10);
  const tag = (g.inMarkHist || g.inMcneesHist) ? `RATED(${g.inMarkHist ? 'mark' : 'mark_mcnees'})` : 'UNRATED';
  console.log(`${date} ts=${g.ts} ${g.rid} court=${g.court} ${g.weekId ?? ''} ${g.score}-${g.oppScore} ${g.won?'W':'L'}${g.isForfeit?' [FORFEIT]':''} partner=${g.partner} opp=${g.opponents} [${tag}]`);
}

console.log('\n=== 5 SAMPLE UNRATED RESULTS (full record) ===');
for (const g of missing.slice(0, 5)) {
  const full = kingsResults[g.rid];
  console.log(`\n${g.rid}:`);
  console.log(JSON.stringify(full, null, 2));
  console.log(`  -> partner: ${g.partner}`);
  console.log(`  -> opponents: ${g.opponents}`);
  console.log(`  -> in mark history: ${g.inMarkHist}; in mark_mcnees history: ${g.inMcneesHist}`);
}
