/* Tally KotB shared ratings module
 *
 * Glicko-2 (Glickman 2012) with logarithmic margin-of-victory weighting.
 * One module, used by:
 *   - courtsense.app/kotb         (league, Kings/Queens toggle)
 *   - courtsense.app/kotb-pickup  (pickup tournaments)
 *   - courtsense.app/seed-ratings (one-shot historical replay)
 *
 * Storage: tally_kotb_pickup/ratings/{nameKey}/
 *   { rating, rd, volatility, gamesPlayed, peakRating, peakRatingDate, lastUpdated,
 *     history: { [gameId]: { ... } }, name }
 *
 * Per-player update:
 *   - Treat the game as me vs avg(opponents) in standard Glicko-2.
 *   - Partner influences my expected score: E uses team mu = (myMu + partnerMu)/2,
 *     but the rating change applies to me alone (RD and volatility from my own state).
 *   - Margin multiplier scales the final rating delta only.
 */
(function(global){
  const DEFAULT_RATING = 1500;
  const DEFAULT_RD = 350;
  const DEFAULT_VOL = 0.06;
  const TAU = 0.5;
  const SCALE = 173.7178;

  function nameKey(name){
    return String(name||'').toLowerCase().trim().replace(/[.#$/[\]]/g,'').replace(/\s+/g,'_');
  }

  function newPlayerState(name){
    return {
      name: String(name||'').trim(),
      rating: DEFAULT_RATING,
      rd: DEFAULT_RD,
      volatility: DEFAULT_VOL,
      gamesPlayed: 0,
      peakRating: DEFAULT_RATING,
      peakRatingDate: null,
      lastUpdated: null
    };
  }

  // ── GLICKO-2 MATH ───────────────────────────────────────────────────────────
  function gOf(phi){ return 1 / Math.sqrt(1 + 3*phi*phi/(Math.PI*Math.PI)); }
  function eOf(mu, muJ, phiJ){ return 1 / (1 + Math.exp(-gOf(phiJ) * (mu - muJ))); }

  // Volatility update by Illinois algorithm (Glickman 2012, step 5).
  function newVolatility(phi, v, delta, sigma){
    const a = Math.log(sigma*sigma);
    const eps = 1e-6;
    function f(x){
      const ex = Math.exp(x);
      const num = ex * (delta*delta - phi*phi - v - ex);
      const den = 2 * Math.pow(phi*phi + v + ex, 2);
      return num/den - (x - a)/(TAU*TAU);
    }
    let A = a, B;
    if(delta*delta > phi*phi + v){
      B = Math.log(delta*delta - phi*phi - v);
    } else {
      let k = 1;
      while(f(a - k*TAU) < 0){ k++; if(k>100) break; }
      B = a - k*TAU;
    }
    let fA = f(A), fB = f(B);
    let iters = 0;
    while(Math.abs(B - A) > eps && iters++ < 1000){
      const C = A + (A - B)*fA/(fB - fA);
      const fC = f(C);
      if(fC*fB <= 0){ A = B; fA = fB; }
      else { fA = fA/2; }
      B = C; fB = fC;
    }
    return Math.exp(A/2);
  }

  // Compute one player's update against a single virtual opponent (avg of opponents),
  // with partner-aware expected-score. Returns deltas before margin scaling.
  function updateOnePlayer(self, partner, oppAvg, score){
    const mu = (self.rating - DEFAULT_RATING) / SCALE;
    const phi = self.rd / SCALE;
    const sigma = self.volatility;

    const teamMu = partner
      ? (mu + ((partner.rating - DEFAULT_RATING) / SCALE)) / 2
      : mu;

    const oppMu = (oppAvg.rating - DEFAULT_RATING) / SCALE;
    const oppPhi = oppAvg.rd / SCALE;

    const g = gOf(oppPhi);
    const E = eOf(teamMu, oppMu, oppPhi);
    const v = 1 / (g*g * E * (1-E));
    const delta = v * g * (score - E);

    const sigmaNew = newVolatility(phi, v, delta, sigma);
    const phiStar = Math.sqrt(phi*phi + sigmaNew*sigmaNew);
    const phiNew  = 1 / Math.sqrt(1/(phiStar*phiStar) + 1/v);
    const muNew   = mu + phiNew*phiNew * g * (score - E);

    return {
      rating: DEFAULT_RATING + SCALE*muNew,
      rd: SCALE*phiNew,
      volatility: sigmaNew,
      expected: E
    };
  }

  // Margin-of-victory multiplier. winnerRating/loserRating are the team averages.
  function marginMultiplier(winnerRating, loserRating, margin){
    const m = Math.max(0, margin|0);
    return Math.log(m + 1) * (2.2 / ((winnerRating - loserRating) * 0.001 + 2.2));
  }

  // ── PURE IN-MEMORY HELPERS (used by seed and live wrappers) ─────────────────

  // Filter team name list to real-player names (defined and not flagged sub).
  // Caller is responsible for handing in only real names. This is a defensive
  // dedupe / coerce step.
  function cleanTeam(names){
    return (names||[]).map(n=>String(n||'').trim()).filter(Boolean);
  }

  // Given a per-name ratings dict and one game, mutate the dict and return
  // an array of history entries to persist. Returns [] if the game can't be
  // applied (e.g. no real players on a side).
  function applyToMemory(ratingsByKey, game){
    const t1 = cleanTeam(game.team1Names);
    const t2 = cleanTeam(game.team2Names);
    if(!t1.length || !t2.length) return [];
    if(game.s1 === game.s2) return [];

    const all = [...t1, ...t2];
    const states = {};
    all.forEach(n=>{
      const k = nameKey(n);
      if(!ratingsByKey[k]) ratingsByKey[k] = newPlayerState(n);
      // Make sure name field reflects most recent casing.
      if(!ratingsByKey[k].name) ratingsByKey[k].name = n;
      states[n] = { key:k, ref: ratingsByKey[k] };
    });

    const t1Avg = t1.reduce((s,n)=>s + states[n].ref.rating, 0) / t1.length;
    const t2Avg = t2.reduce((s,n)=>s + states[n].ref.rating, 0) / t2.length;
    const t1Rd  = t1.reduce((s,n)=>s + states[n].ref.rd, 0) / t1.length;
    const t2Rd  = t2.reduce((s,n)=>s + states[n].ref.rd, 0) / t2.length;

    const t1Win = game.s1 > game.s2;
    const winnerAvg = t1Win ? t1Avg : t2Avg;
    const loserAvg  = t1Win ? t2Avg : t1Avg;
    const margin = Math.abs(game.s1 - game.s2);
    const mult = marginMultiplier(winnerAvg, loserAvg, margin);

    const oppForT1 = { rating: t2Avg, rd: t2Rd };
    const oppForT2 = { rating: t1Avg, rd: t1Rd };

    const winnerScore = Math.max(game.s1, game.s2);
    const loserScore  = Math.min(game.s1, game.s2);
    const ts = game.ts || Date.now();
    const history = [];

    function applyToSide(team, opp, won){
      const initial = {};
      team.forEach(n=>{ initial[n] = { ...states[n].ref }; });
      team.forEach(n=>{
        const me = initial[n];
        const partnerName = team.find(x => x !== n);
        const partner = partnerName ? initial[partnerName] : null;
        const score = won ? 1 : 0;
        const upd = updateOnePlayer(
          { rating: me.rating, rd: me.rd, volatility: me.volatility },
          partner ? { rating: partner.rating } : null,
          opp,
          score
        );
        const baseDelta = upd.rating - me.rating;
        const scaledDelta = baseDelta * mult;
        const newRating = me.rating + scaledDelta;
        const newRD = upd.rd;
        const newVol = upd.volatility;

        const rec = states[n].ref;
        const ratingBefore = rec.rating;
        const rdBefore = rec.rd;

        rec.rating = newRating;
        rec.rd = newRD;
        rec.volatility = newVol;
        rec.gamesPlayed = (rec.gamesPlayed||0) + 1;
        if(newRating > (rec.peakRating||0)){
          rec.peakRating = newRating;
          rec.peakRatingDate = ts;
        }
        rec.lastUpdated = ts;

        const oppNames = team === t1 ? t2 : t1;
        history.push({
          playerKey: states[n].key,
          playerName: rec.name,
          entry: {
            timestamp: ts,
            source: game.source || 'unknown',
            partner: partnerName || null,
            opponent1: oppNames[0] || null,
            opponent2: oppNames[1] || null,
            score: won ? winnerScore : loserScore,
            opponentScore: won ? loserScore : winnerScore,
            ratingBefore, ratingAfter: newRating, ratingChange: scaledDelta,
            rdBefore, rdAfter: newRD,
            won: !!won
          }
        });
      });
    }
    applyToSide(t1, oppForT1, t1Win);
    applyToSide(t2, oppForT2, !t1Win);

    return history;
  }

  // ── LIVE FIREBASE WRAPPERS ─────────────────────────────────────────────────

  // Reads each player's current state, computes the update, writes back.
  // gameId becomes the key under each player's history/.
  // Returns a Promise that resolves when the writes have been issued (best effort).
  async function applyGame(opts){
    const { db, dbRoot, gameId, source, ts, team1Names, team2Names, s1, s2 } = opts;
    if(!db) return;
    const t1 = cleanTeam(team1Names);
    const t2 = cleanTeam(team2Names);
    if(!t1.length || !t2.length) return;
    if(s1 === s2) return;

    const all = [...t1, ...t2];
    const ratingsByKey = {};
    await Promise.all(all.map(async n=>{
      const k = nameKey(n);
      const snap = await db.ref(dbRoot+'/ratings/'+k).once('value');
      const cur = snap.val();
      if(cur && typeof cur === 'object'){
        ratingsByKey[k] = {
          name: cur.name || n,
          rating: cur.rating ?? DEFAULT_RATING,
          rd: cur.rd ?? DEFAULT_RD,
          volatility: cur.volatility ?? DEFAULT_VOL,
          gamesPlayed: cur.gamesPlayed || 0,
          peakRating: cur.peakRating ?? DEFAULT_RATING,
          peakRatingDate: cur.peakRatingDate || null,
          lastUpdated: cur.lastUpdated || null
        };
      } else {
        ratingsByKey[k] = newPlayerState(n);
      }
    }));

    const game = { team1Names: t1, team2Names: t2, s1, s2, ts: ts || Date.now(), source };
    const history = applyToMemory(ratingsByKey, game);
    if(!history.length) return;

    const writes = [];
    history.forEach(h=>{
      const rec = ratingsByKey[h.playerKey];
      writes.push(db.ref(dbRoot+'/ratings/'+h.playerKey).update({
        name: rec.name,
        rating: rec.rating,
        rd: rec.rd,
        volatility: rec.volatility,
        gamesPlayed: rec.gamesPlayed,
        peakRating: rec.peakRating,
        peakRatingDate: rec.peakRatingDate,
        lastUpdated: rec.lastUpdated
      }));
      writes.push(db.ref(dbRoot+'/ratings/'+h.playerKey+'/history/'+gameId).set(h.entry));
    });
    try { await Promise.all(writes); } catch(e){ console.warn('rating write failed', e); }
  }

  // Approximate reverse: subtract the recorded ratingChange and decrement games.
  // This is intentionally simple. For a strict rebuild after edits, run the seed
  // tool again. team1Names/team2Names is the participant list to look up by name.
  async function reverseGame(opts){
    const { db, dbRoot, gameId, team1Names, team2Names } = opts;
    if(!db) return;
    const all = [...cleanTeam(team1Names), ...cleanTeam(team2Names)];
    if(!all.length) return;
    const writes = [];
    await Promise.all(all.map(async n=>{
      const k = nameKey(n);
      const histSnap = await db.ref(dbRoot+'/ratings/'+k+'/history/'+gameId).once('value');
      const h = histSnap.val();
      if(!h) return;
      const recSnap = await db.ref(dbRoot+'/ratings/'+k).once('value');
      const rec = recSnap.val()||{};
      const newRating = (rec.rating ?? DEFAULT_RATING) - (h.ratingChange||0);
      const newGames = Math.max(0, (rec.gamesPlayed||0) - 1);
      writes.push(db.ref(dbRoot+'/ratings/'+k).update({
        rating: newRating,
        gamesPlayed: newGames,
        lastUpdated: Date.now()
      }));
      writes.push(db.ref(dbRoot+'/ratings/'+k+'/history/'+gameId).remove());
    }));
    try { await Promise.all(writes); } catch(e){ console.warn('rating reverse failed', e); }
  }

  global.Ratings = {
    DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, TAU,
    nameKey,
    newPlayerState,
    updateOnePlayer,
    marginMultiplier,
    applyToMemory,
    applyGame,
    reverseGame
  };
})(typeof window !== 'undefined' ? window : globalThis);
