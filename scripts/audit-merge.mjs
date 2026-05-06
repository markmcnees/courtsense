#!/usr/bin/env node
// Read-only audit for player record merge cleanup.
// Pulls all relevant Firebase paths via REST and produces a report.

import fs from 'node:fs';
import path from 'node:path';

const DB = 'https://leon-beach-volleyball-default-rtdb.firebaseio.com';
const ORPHANS = ['Jasun', 'Jimmy', 'Mark', 'Jeff', 'Ian'];
const CANONICALS = {
  Jasun: 'Jasun Burdick',
  Jimmy: 'Jimmy McQuigg',
  Mark: 'Mark McNees',
  Jeff: 'Jeff Rogers',
  Ian: 'Ian Coxey',
};
const RATING_KEY = (n) => n.toLowerCase().replace(/\s+/g, '_');

async function get(p) {
  const res = await fetch(`${DB}${p}.json`);
  if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
  return res.json();
}

function countResults(results, playerIdSet) {
  if (!results || typeof results !== 'object') return { count: 0, ids: [] };
  let count = 0;
  const sampleIds = [];
  for (const [rid, r] of Object.entries(results)) {
    const t1 = Array.isArray(r?.t1) ? r.t1 : [];
    const t2 = Array.isArray(r?.t2) ? r.t2 : [];
    const all = [...t1, ...t2];
    if (all.some((id) => playerIdSet.has(id))) {
      count++;
      if (sampleIds.length < 5) sampleIds.push(rid);
    }
  }
  return { count, sampleIds };
}

function findPlayersByName(players, name) {
  // Exact case-sensitive match on `name` field
  if (!players || typeof players !== 'object') return [];
  const matches = [];
  for (const [pid, p] of Object.entries(players)) {
    if (p && typeof p === 'object' && p.name === name) {
      matches.push({ id: pid, record: p });
    }
  }
  return matches;
}

(async () => {
  console.log('Fetching Firebase data...');
  const [kingsResults, queensResults, kingsPlayers, queensPlayers,
         pickupPlayers, pickupRatings, pickupEvents, archive] = await Promise.all([
    get('/tally_kotb/kings/results'),
    get('/tally_kotb/queens/results'),
    get('/tally_kotb/kings/players'),
    get('/tally_kotb/queens/players'),
    get('/tally_kotb_pickup/players'),
    get('/tally_kotb_pickup/ratings'),
    get('/tally_kotb_pickup/events'),
    get('/tally_kotb/archive'),
  ]);

  const ratingKeys = pickupRatings ? Object.keys(pickupRatings) : [];

  const report = [];
  report.push('# Merge Audit Report');
  report.push('');
  report.push(`Generated: ${new Date().toISOString()}`);
  report.push('Source: Firebase RTDB `leon-beach-volleyball-default-rtdb` (read-only)');
  report.push('');
  report.push('## Database structure observations');
  report.push('');
  report.push('- `tally_kotb_pickup/results` does NOT exist as a top-level path. Pickup results live nested at `tally_kotb_pickup/events/{eventId}/results/{resultId}`.');
  report.push('- All result records reference players via per-section `t1`/`t2` arrays of player IDs (NOT names). Name lookup is via the corresponding `players/{pid}/name` field.');
  report.push('- Per-section player ID namespaces: `tally_kotb/kings/players`, `tally_kotb/queens/players`, `tally_kotb_pickup/players`, plus per-event embedded `tally_kotb_pickup/events/{eventId}/players` (event-scoped player IDs).');
  report.push('- Pickup rating record keys are snake_case lowercase of the player display name (e.g. `Mark McNees` -> `mark_mcnees`, `Jasun` -> `jasun`).');
  report.push('- Archive at `tally_kotb/archive/Season 2026/{kings|queens}/results` mirrors the live shape and may contain historical results that reference orphan-named players.');
  report.push('');

  // Pickup events list
  const eventIds = pickupEvents ? Object.keys(pickupEvents) : [];
  report.push(`## Pickup events present: ${eventIds.length}`);
  for (const eid of eventIds) {
    const ev = pickupEvents[eid];
    const numResults = ev?.results ? Object.keys(ev.results).length : 0;
    const numPlayers = ev?.players ? Object.keys(ev.players).length : 0;
    report.push(`- \`${eid}\` (${ev?.meta?.name ?? '(no name)'}, ${ev?.meta?.date ?? '?'}) — ${numPlayers} players, ${numResults} results`);
  }
  report.push('');

  // Archive seasons list
  const archiveSeasons = archive ? Object.keys(archive) : [];
  report.push(`## Archive seasons present: ${archiveSeasons.join(', ') || 'none'}`);
  report.push('');

  // Per-orphan analysis
  for (const orphan of ORPHANS) {
    const canonical = CANONICALS[orphan];
    const orphanKey = RATING_KEY(orphan);
    const canonicalKey = RATING_KEY(canonical);
    const isMerge = orphan !== 'Jeff' && orphan !== 'Ian';
    report.push(`## ${orphan} ${isMerge ? `→ ${canonical} (MERGE)` : `→ ${canonical} (RENAME)`}`);
    report.push('');

    // 1. Rating records
    report.push('### Rating records (`tally_kotb_pickup/ratings/`)');
    const orphanRating = pickupRatings?.[orphanKey];
    const canonicalRating = pickupRatings?.[canonicalKey];
    if (orphanRating) {
      const summary = {
        rating: orphanRating.rating ?? orphanRating.r ?? '?',
        rd: orphanRating.rd ?? '?',
        gp: orphanRating.gp ?? orphanRating.gamesPlayed ?? orphanRating.games ?? '?',
        wins: orphanRating.wins ?? orphanRating.w ?? '?',
        losses: orphanRating.losses ?? orphanRating.l ?? '?',
        history_count: Array.isArray(orphanRating.history) ? orphanRating.history.length : (orphanRating.history && typeof orphanRating.history === 'object' ? Object.keys(orphanRating.history).length : 0),
      };
      report.push(`- Orphan key \`${orphanKey}\` EXISTS. Top-level fields: ${Object.keys(orphanRating).join(', ')}`);
      report.push(`  - rating=${summary.rating} rd=${summary.rd} gp=${summary.gp} wins=${summary.wins} losses=${summary.losses} history_entries=${summary.history_count}`);
    } else {
      report.push(`- Orphan key \`${orphanKey}\` does NOT exist`);
    }
    if (canonicalRating) {
      const summary = {
        rating: canonicalRating.rating ?? canonicalRating.r ?? '?',
        rd: canonicalRating.rd ?? '?',
        gp: canonicalRating.gp ?? canonicalRating.gamesPlayed ?? canonicalRating.games ?? '?',
        wins: canonicalRating.wins ?? canonicalRating.w ?? '?',
        losses: canonicalRating.losses ?? canonicalRating.l ?? '?',
        history_count: Array.isArray(canonicalRating.history) ? canonicalRating.history.length : (canonicalRating.history && typeof canonicalRating.history === 'object' ? Object.keys(canonicalRating.history).length : 0),
      };
      report.push(`- Canonical key \`${canonicalKey}\` EXISTS. Top-level fields: ${Object.keys(canonicalRating).join(', ')}`);
      report.push(`  - rating=${summary.rating} rd=${summary.rd} gp=${summary.gp} wins=${summary.wins} losses=${summary.losses} history_entries=${summary.history_count}`);
    } else {
      report.push(`- Canonical key \`${canonicalKey}\` does NOT exist`);
    }
    report.push('');

    // 2. Player profile records (orphan name)
    report.push('### Player profile records by exact name match');
    const playerSearches = [
      { path: 'tally_kotb/kings/players', table: kingsPlayers, name: 'kings' },
      { path: 'tally_kotb/queens/players', table: queensPlayers, name: 'queens' },
      { path: 'tally_kotb_pickup/players', table: pickupPlayers, name: 'pickup_top' },
    ];
    const orphanIdsBySection = { kings: new Set(), queens: new Set(), pickup_top: new Set(), pickup_events: new Map() };
    const canonicalIdsBySection = { kings: new Set(), queens: new Set(), pickup_top: new Set(), pickup_events: new Map() };

    for (const { path: ppath, table, name } of playerSearches) {
      const orphanMatches = findPlayersByName(table, orphan);
      const canonMatches = findPlayersByName(table, canonical);
      for (const m of orphanMatches) orphanIdsBySection[name].add(m.id);
      for (const m of canonMatches) canonicalIdsBySection[name].add(m.id);
      const orphanLine = orphanMatches.length ? orphanMatches.map((m) => `\`${m.id}\``).join(', ') : 'none';
      const canonLine = canonMatches.length ? canonMatches.map((m) => `\`${m.id}\``).join(', ') : 'none';
      report.push(`- \`${ppath}\` — orphan "${orphan}": ${orphanLine}; canonical "${canonical}": ${canonLine}`);
    }

    // Per-event pickup players
    let pickupEventOrphanRefs = [];
    let pickupEventCanonRefs = [];
    for (const eid of eventIds) {
      const evPlayers = pickupEvents[eid]?.players;
      const orphanMatches = findPlayersByName(evPlayers, orphan);
      const canonMatches = findPlayersByName(evPlayers, canonical);
      if (orphanMatches.length) {
        const ids = orphanMatches.map((m) => m.id);
        orphanIdsBySection.pickup_events.set(eid, new Set(ids));
        pickupEventOrphanRefs.push(`\`${eid}\` ids: ${ids.map((i) => `\`${i}\``).join(', ')}`);
      }
      if (canonMatches.length) {
        const ids = canonMatches.map((m) => m.id);
        canonicalIdsBySection.pickup_events.set(eid, new Set(ids));
        pickupEventCanonRefs.push(`\`${eid}\` ids: ${ids.map((i) => `\`${i}\``).join(', ')}`);
      }
    }
    report.push(`- \`tally_kotb_pickup/events/*/players\` — orphan "${orphan}" in events: ${pickupEventOrphanRefs.length ? pickupEventOrphanRefs.join('; ') : 'none'}`);
    report.push(`- \`tally_kotb_pickup/events/*/players\` — canonical "${canonical}" in events: ${pickupEventCanonRefs.length ? pickupEventCanonRefs.join('; ') : 'none'}`);
    report.push('');

    // 3. Game result reference counts
    report.push('### Game result references (counts by path, matched on player ID)');
    let totalOrphanRefs = 0;
    let totalCanonRefs = 0;

    // Kings results (live)
    {
      const orphanIds = orphanIdsBySection.kings;
      const canonIds = canonicalIdsBySection.kings;
      const oc = countResults(kingsResults, orphanIds);
      const cc = countResults(kingsResults, canonIds);
      totalOrphanRefs += oc.count;
      totalCanonRefs += cc.count;
      report.push(`- \`tally_kotb/kings/results\` — orphan refs: ${oc.count}${oc.sampleIds?.length ? ` (e.g. ${oc.sampleIds.slice(0,3).map((i)=>`\`${i}\``).join(', ')})` : ''}; canonical refs: ${cc.count}`);
    }
    // Queens results (live)
    {
      const orphanIds = orphanIdsBySection.queens;
      const canonIds = canonicalIdsBySection.queens;
      const oc = countResults(queensResults, orphanIds);
      const cc = countResults(queensResults, canonIds);
      totalOrphanRefs += oc.count;
      totalCanonRefs += cc.count;
      report.push(`- \`tally_kotb/queens/results\` — orphan refs: ${oc.count}${oc.sampleIds?.length ? ` (e.g. ${oc.sampleIds.slice(0,3).map((i)=>`\`${i}\``).join(', ')})` : ''}; canonical refs: ${cc.count}`);
    }
    // Pickup events (per event)
    {
      let evOrphan = 0, evCanon = 0;
      for (const eid of eventIds) {
        const ev = pickupEvents[eid];
        const orphanIds = orphanIdsBySection.pickup_events.get(eid) ?? new Set();
        const canonIds = canonicalIdsBySection.pickup_events.get(eid) ?? new Set();
        const oc = countResults(ev?.results, orphanIds);
        const cc = countResults(ev?.results, canonIds);
        evOrphan += oc.count;
        evCanon += cc.count;
      }
      totalOrphanRefs += evOrphan;
      totalCanonRefs += evCanon;
      report.push(`- \`tally_kotb_pickup/events/*/results\` — orphan refs: ${evOrphan}; canonical refs: ${evCanon}`);
    }
    // Archive
    {
      let archOrphan = 0, archCanon = 0;
      const archDetails = [];
      for (const season of archiveSeasons) {
        for (const section of ['kings', 'queens']) {
          const arch = archive?.[season]?.[section];
          if (!arch) continue;
          const archPlayers = arch.players ?? {};
          const orphanMatches = findPlayersByName(archPlayers, orphan);
          const canonMatches = findPlayersByName(archPlayers, canonical);
          const orphanIds = new Set(orphanMatches.map((m) => m.id));
          const canonIds = new Set(canonMatches.map((m) => m.id));
          const oc = countResults(arch.results, orphanIds);
          const cc = countResults(arch.results, canonIds);
          archOrphan += oc.count;
          archCanon += cc.count;
          archDetails.push(`  - \`tally_kotb/archive/${season}/${section}\`: orphan players=${orphanMatches.length} (refs ${oc.count}); canonical players=${canonMatches.length} (refs ${cc.count})`);
        }
      }
      totalOrphanRefs += archOrphan;
      totalCanonRefs += archCanon;
      report.push(`- \`tally_kotb/archive/*\` — orphan refs: ${archOrphan}; canonical refs: ${archCanon}`);
      for (const d of archDetails) report.push(d);
    }
    report.push('');
    report.push(`**Total orphan game refs needing re-pointing: ${totalOrphanRefs}**`);
    report.push(`Total canonical refs (for context): ${totalCanonRefs}`);
    report.push('');
  }

  // Anomalies section: any rating key matching ORPHAN name pattern that doesn't appear in players?
  report.push('## Anomalies & cross-checks');
  report.push('');
  report.push('### All pickup rating keys');
  report.push('```');
  report.push(ratingKeys.sort().join('\n'));
  report.push('```');
  report.push('');

  // Are there orphan IDs that share an event ID across two distinct names? (sanity)
  report.push('### Orphan-canonical co-occurrence in same pickup event');
  for (const orphan of ORPHANS) {
    const canonical = CANONICALS[orphan];
    const coOccur = [];
    for (const eid of eventIds) {
      const evPlayers = pickupEvents[eid]?.players ?? {};
      const hasOrphan = Object.values(evPlayers).some((p) => p?.name === orphan);
      const hasCanon = Object.values(evPlayers).some((p) => p?.name === canonical);
      if (hasOrphan && hasCanon) coOccur.push(eid);
    }
    if (coOccur.length) {
      report.push(`- ⚠ "${orphan}" AND "${canonical}" both appear in events: ${coOccur.map((e) => `\`${e}\``).join(', ')} — possible two distinct people, NOT a duplicate. Confirm before merging.`);
    } else {
      report.push(`- "${orphan}" / "${canonical}" never co-occur in same event — consistent with same-person duplicate.`);
    }
  }
  report.push('');

  const outPath = path.join(process.cwd(), 'docs', 'merge-audit-report.md');
  fs.writeFileSync(outPath, report.join('\n'));
  console.log(`Wrote ${outPath}`);
})();
