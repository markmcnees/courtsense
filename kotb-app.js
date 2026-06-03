// ─── LEAGUE CONFIG (injected by shell via window.LEAGUE_CONFIG) ───
const LC = window.LEAGUE_CONFIG;
// Note: LC.colors is currently informational only.
// CSS variables for kings/queens themes are defined in the shell <style>.
// Future enhancement: inject from LC.colors at boot for true config-driven theming.
const FB_CFG    = LC.fbConfig;
const DB_ROOT   = LC.dbRoot;
const ADMIN_PIN = LC.adminPin;
const AI_URL    = LC.aiProxyUrl;

// ─── STATE ───
let db = null;
let SIDE = 'kings';
let _pendingRoundsUpdate = null;
let _genFromScore = false;
let _editCourtCtx = null;
let tab  = 'standings';
let sortK = {key:'diff', dir:'desc'};
let liveWeek = null;
let liveRound = 1;
const lscore = {};

let D = {
  kings:  {config:{}, players:{}, weeks:{}, results:{}},
  queens: {config:{}, players:{}, weeks:{}, results:{}},
  ratings: {}
};

// ─── HELPERS ───
const $ = id => document.getElementById(id);
function gi(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5);}
function td(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function fD(s){if(!s)return'';return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function pm(v){return(v>0?'+':'')+v;}
function pmc(v){return v>0?'pos':v<0?'neg':'neu';}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2400);}
function fbSet(p,v){if(db)db.ref(DB_ROOT+'/'+p).set(v);}
function fbDel(p){if(db)db.ref(DB_ROOT+'/'+p).remove();}
function gP(id){return (D[SIDE].players||{})[id]||null;}
function pN(id){const p=gP(id);return p?p.name:'?';}
function closeModal(id){$(id).classList.remove('on');}


// ─── SEASON MANAGEMENT ───
function promptCloseSeason(){
  const name=(D[SIDE].config.seasonName||'Season '+(new Date().getFullYear()));
  const label=prompt('Name this season before archiving (e.g. "Spring 2025"):',name);
  if(!label)return;
  _pinAction='closeseason';window._pendingSeasonLabel=label;
  _pinEntry='';updatePinDots();
  $('pin-error').textContent='';
  $('pin-modal-title').textContent='Admin PIN';
  $('pin-modal').classList.add('on');
}

async function doCloseSeason(){
  const label=window._pendingSeasonLabel;
  if(!label)return;
  const archKey='archive/'+label.replace(/[.#$/[\]]/g,'_')+'/'+SIDE;
  const snap={
    config:D[SIDE].config||{},
    players:D[SIDE].players||{},
    weeks:D[SIDE].weeks||{},
    results:D[SIDE].results||{}
  };
  // Archive full season
  await db.ref(DB_ROOT+'/'+archKey).set(snap);
  // Clear weeks, results, and players — new season starts fresh
  await db.ref(DB_ROOT+'/'+SIDE+'/weeks').remove();
  await db.ref(DB_ROOT+'/'+SIDE+'/results').remove();
  await db.ref(DB_ROOT+'/'+SIDE+'/players').remove();
  // Reset config but preserve courts/day preferences
  const oldCfg=D[SIDE].config||{};
  await db.ref(DB_ROOT+'/'+SIDE+'/config').set({
    courts:oldCfg.courts||2,
    dayOfWeek:oldCfg.dayOfWeek??1,
    winScore:oldCfg.winScore||15
  });
  window._pendingSeasonLabel=null;
  toast('Season "'+label+'" archived! Set a new start date to begin.');
  renderPlannerCfg();
}

function renderArchives(){
  const cont=$('archive-list');
  if(!cont)return;
  if(!db){cont.innerHTML='<p style="color:var(--gray);font-size:13px;">Not connected.</p>';return;}
  cont.innerHTML='<p style="font-size:13px;color:var(--gray);">Loading…</p>';
  db.ref(DB_ROOT+'/archive').once('value',snap=>{
    const arch=snap.val()||{};
    const seasons=Object.keys(arch).sort().reverse();
    if(!seasons.length){cont.innerHTML='<p style="font-size:13px;color:var(--gray);">No archived seasons yet.</p>';return;}
    cont.innerHTML=seasons.map(name=>{
      const sd=arch[name][SIDE]||{};
      const players=Object.values(sd.players||{}).filter(p=>p&&p.name);
      const results=Object.values(sd.results||{});
      const wins=results.filter(r=>r.s1>r.s2).length;
      const label=name.replace(/_/g,' ');
      return `<div style="padding:12px 0;border-bottom:1px solid var(--sand-border);">
        <div style="font-weight:700;font-size:14px;">${label}</div>
        <div style="font-size:12px;color:var(--gray);margin-top:2px;">${players.length} players · ${results.length} games played</div>
        <button class="btn btn-g btn-sm" style="margin-top:8px;" onclick="viewArchiveSeason('${name}')">📊 View Standings</button>
      </div>`;
    }).join('');
  });
}

function viewArchiveSeason(name){
  if(!db)return;
  db.ref(DB_ROOT+'/archive/'+name+'/'+SIDE).once('value',snap=>{
    const sd=snap.val()||{};
    const players=Object.values(sd.players||{}).filter(p=>p&&p.name);
    const results=Object.values(sd.results||{});
    const stats={};
    players.forEach(p=>{stats[p.id]={name:p.name,gp:0,w:0,l:0,pf:0,pa:0};});
    results.forEach(r=>{
      const process=(team,sf,sa)=>(team||[]).forEach(pid=>{
        if(!stats[pid])stats[pid]={name:pid,gp:0,w:0,l:0,pf:0,pa:0};
        stats[pid].gp++;stats[pid].pf+=sf;stats[pid].pa+=sa;
        sf>sa?stats[pid].w++:stats[pid].l++;
      });
      process(r.t1,r.s1,r.s2);process(r.t2,r.s2,r.s1);
    });
    const rows=Object.values(stats).filter(p=>p.gp>0)
      .sort((a,b)=>(b.w-b.l)-(a.w-a.l)||(b.pf-b.pa)-(a.pf-a.pa))
      .map((p,i)=>`<tr><td>${i+1}</td><td style="font-weight:700;">${p.name}</td><td>${p.gp}</td><td>${p.w}</td><td>${p.l}</td><td style="font-weight:700;color:${p.pf-p.pa>=0?'var(--win)':'var(--loss)'};">${p.pf-p.pa>=0?'+':''}${p.pf-p.pa}</td></tr>`).join('');
    const label=name.replace(/_/g,' ');
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML=`<div style="background:#fff;border-radius:12px;padding:20px;max-width:420px;width:100%;max-height:85vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;">${label}</div>
        <button onclick="this.closest('div[style]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="font-size:11px;color:var(--gray);border-bottom:2px solid #eee;">
          <th style="text-align:left;padding:6px 4px;">#</th>
          <th style="text-align:left;padding:6px 4px;">Player</th>
          <th style="padding:6px 4px;">GP</th><th style="padding:6px 4px;">W</th><th style="padding:6px 4px;">L</th>
          <th style="padding:6px 4px;">+/-</th>
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:#aaa;padding:16px;">No results recorded</td></tr>'}</tbody>
      </table>
    </div>`;
    document.body.appendChild(overlay);
  });
}

// ─── FIREBASE INIT ───
function initFB(){
  try{
    if(!firebase.apps.length) firebase.initializeApp(FB_CFG);
    db = firebase.database();
    setSS(true);
    db.ref(DB_ROOT).on('value', snap=>{
      const v=snap.val()||{};
      ['kings','queens'].forEach(s=>{
        const sv=v[s]||{};
        D[s].config  = sv.config||{};
        D[s].players = sv.players||{};
        D[s].weeks   = sv.weeks||{};
        if(_pendingRoundsUpdate&&_pendingRoundsUpdate.side===s&&Date.now()-_pendingRoundsUpdate.ts<8000){
          if(D[s].weeks[_pendingRoundsUpdate.weekId]) D[s].weeks[_pendingRoundsUpdate.weekId].rounds=_pendingRoundsUpdate.rounds;
        }
        D[s].results = sv.results||{};
      });
      refreshAll();
    }, e=>{console.error(e);setSS(false);});
    db.ref('tally_kotb_pickup/ratings').on('value', snap=>{
      D.ratings = snap.val()||{};
      if(tab==='ratings') refreshTab('ratings');
    }, e=>console.warn('ratings read failed', e));
    db.ref('.info/connected').on('value',s=>setSS(s.val()===true));
  }catch(e){console.error(e);setSS(false);}
}
function setSS(on){
  const d=$('sync');
  d.className='sync '+(on?'on':'off');
  d.title=on?'Connected':'Offline';
}
function openProfile(){
  if(window.Identity) Identity.openProfile({ db });
  else toast('Profile module not loaded yet, refresh the page');
}

// ─── SIDE / TAB ───
function switchSide(s){
  SIDE=s;
  document.body.classList.toggle('queens',s==='queens');
  $('btn-k').classList.toggle('on',s==='kings');
  $('btn-q').classList.toggle('on',s==='queens');
  $('brand-ico').textContent=s==='kings'?'👑':'👸';
  refreshAll();
}

function initTabs(){
  document.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('click',()=>{
      const dest=t.dataset.tab;
      if(dest==='planner'){
        _pinAction='planner';_pinEntry='';updatePinDots();
        $('pin-error').textContent='';
        $('pin-modal-title').textContent='Admin PIN';
        $('pin-modal').classList.add('on');
        // store the tab element for after PIN
        window._pendingTab=t;
        return;
      }
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
      document.querySelectorAll('.pane').forEach(x=>x.classList.remove('on'));
      t.classList.add('on');
      tab=t.dataset.tab;
      $('pane-'+tab).classList.add('on');
      refreshTab(tab);
    });
  });
  document.querySelectorAll('#stbl th[data-sort]').forEach(th=>{
    th.style.cursor='pointer';
    th.addEventListener('click',()=>{
      if(sortK.key===th.dataset.sort){sortK.dir=sortK.dir==='asc'?'desc':'asc';}
      else{sortK={key:th.dataset.sort,dir:'desc'};}
      renderStandings();
    });
  });
  document.querySelectorAll('#rtbl th[data-rsort]').forEach(th=>{
    th.style.cursor='pointer';
    th.addEventListener('click',()=>{
      if(ratingSort.key===th.dataset.rsort){ratingSort.dir=ratingSort.dir==='asc'?'desc':'asc';}
      else{ratingSort={key:th.dataset.rsort,dir:'desc'};}
      renderRatings();
    });
  });
  $('cfg-start').value=td();
}

function refreshAll(){fillWeekSels();refreshTab(tab);}
function refreshTab(t){
  if(t==='standings') renderStandings();
  else if(t==='planner'){renderRoster();renderPlannerCfg();loadWeekDetail();renderArchives();}
  else if(t==='score'){fillWeekSels();renderScoreAbsencePanel();renderWeekActions();renderRoundPills();renderLiveCourts();}
  else if(t==='ratings'){renderRatings();renderRatingsHeader();}
}

// ─── STATS ───
function calcStats(pid){
  let gp=0,w=0,l=0,pf=0,pa=0;
  Object.values(D[SIDE].results||{}).forEach(r=>{
    const in1=(r.t1||[]).includes(pid),in2=(r.t2||[]).includes(pid);
    if(!in1&&!in2)return;
    // Skip if this player was flagged as a sub for this game
    if(r.subSlots&&r.subSlots.includes(pid))return;
    gp++;const ms=in1?r.s1:r.s2,os=in1?r.s2:r.s1;
    pf+=ms;pa+=os;ms>os?w++:l++;
  });
  return{gp,w,l,pct:gp>0?Math.round(w/gp*100)+'%':'—',pf,pa,diff:pf-pa};
}

function partnerHistory(pid){
  const ph={};
  Object.values(D[SIDE].results||{}).forEach(r=>{
    let team=null;
    if((r.t1||[]).includes(pid))team=r.t1;
    else if((r.t2||[]).includes(pid))team=r.t2;
    if(!team)return;
    const partner=team.find(p=>p!==pid);
    if(!partner)return;
    if(!ph[partner])ph[partner]={gp:0,w:0,l:0,pf:0,pa:0};
    const ms=(r.t1||[]).includes(pid)?r.s1:r.s2,os=(r.t1||[]).includes(pid)?r.s2:r.s1;
    ph[partner].gp++;ph[partner].pf+=ms;ph[partner].pa+=os;ms>os?ph[partner].w++:ph[partner].l++;
  });
  return ph;
}

// ─── STANDINGS ───
function renderStandings(){
  const players=Object.values(D[SIDE].players||{}).filter(p=>p&&p.name);
  if(!players.length){
    $('sbody').innerHTML=`<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--gray);">No players yet — add some in the Roster tab.</td></tr>`;
    return;
  }
  let rows=players.map(p=>({p,s:calcStats(p.id)}));
  rows.sort((a,b)=>{
    const k=sortK.key;
    let va=k==='name'?a.p.name:k==='pct'?parseFloat(a.s.pct)||0:a.s[k]||0;
    let vb=k==='name'?b.p.name:k==='pct'?parseFloat(b.s.pct)||0:b.s[k]||0;
    if(typeof va==='string')return sortK.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);
    return sortK.dir==='asc'?va-vb:vb-va;
  });
  const rc=['r1','r2','r3'];
  $('sbody').innerHTML=rows.map(({p,s},i)=>`
    <tr onclick="showPH('${p.id}')" style="cursor:pointer;">
      <td style="padding-left:14px;"><span class="rnk ${rc[i]||''}">${i+1}</span></td>
      <td class="pname">${p.name}</td>
      <td class="gp">${s.gp}</td>
      <td class="win">${s.w}</td>
      <td class="loss">${s.l}</td>
      <td style="font-size:12px;">${s.pct}</td>
      <td class="${pmc(s.diff)}">${s.gp>0?pm(s.diff):'—'}</td>
    </tr>`).join('');

  document.querySelectorAll('#stbl th[data-sort]').forEach(th=>{
    const isSorted=th.dataset.sort===sortK.key;
    th.classList.toggle('sorted',isSorted);
    const labels={pct:'Win%',diff:'+/-'};
    th.textContent=(labels[th.dataset.sort]||th.dataset.sort)+(isSorted?(sortK.dir==='asc'?' ▲':' ▼'):'');
  });
}

function showPH(pid){
  const player=gP(pid);if(!player)return;
  showPlayerRatingDetail(player.name);
}

function showPlayerRatingDetail(name){
  if(!name) return;
  const k = window.Ratings ? Ratings.nameKey(name) : '';
  const rec = (D.ratings||{})[k] || {};
  const rating = rec.rating ?? 1500;
  const rd = rec.rd ?? 350;
  const gp = rec.gamesPlayed || 0;
  const peak = rec.peakRating ?? rating;
  const history = rec.history ? Object.values(rec.history) : [];
  history.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  const wins = history.filter(h=>h.won).length;
  const losses = history.length - wins;

  const partnerAgg = {};
  history.forEach(h=>{
    const pn = h.partner; if(!pn) return;
    if(!partnerAgg[pn]) partnerAgg[pn] = { gp:0, w:0, l:0, pf:0, pa:0 };
    partnerAgg[pn].gp++;
    partnerAgg[pn].pf += (h.score||0);
    partnerAgg[pn].pa += (h.opponentScore||0);
    if(h.won) partnerAgg[pn].w++; else partnerAgg[pn].l++;
  });
  const partnerRows = Object.entries(partnerAgg).sort((a,b)=>b[1].gp-a[1].gp || (b[1].w-b[1].l)-(a[1].w-a[1].l));

  function ratingOf(nm){ const kk = Ratings.nameKey(nm); return (D.ratings||{})[kk]?.rating ?? 1500; }
  let bestWin = null, worstLoss = null;
  history.forEach(h=>{
    const opps = [h.opponent1, h.opponent2].filter(Boolean);
    if(!opps.length) return;
    const oppRatings = opps.map(ratingOf);
    const oppPeak = Math.max(...oppRatings), oppWeak = Math.min(...oppRatings);
    if(h.won && (!bestWin || oppPeak > bestWin.r)) bestWin = { r:oppPeak, opp:opps.join(' & '), score:h.score+'-'+h.opponentScore, ts:h.timestamp };
    if(!h.won && (!worstLoss || oppWeak < worstLoss.r)) worstLoss = { r:oppWeak, opp:opps.join(' & '), score:h.score+'-'+h.opponentScore, ts:h.timestamp };
  });

  const recent = history.slice(0, 20);
  const chartH = 90, chartW = 320, pad = 6;
  let chartHTML;
  if(history.length<2){
    chartHTML = `<p style="font-size:12px;color:var(--gray);text-align:center;padding:18px 0;">Need at least 2 games for a chart.</p>`;
  } else {
    const sortedAsc = history.slice().sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
    const ratings = sortedAsc.map(h=>h.ratingAfter);
    const minR = Math.min(...ratings), maxR = Math.max(...ratings);
    const span = Math.max(1, maxR - minR);
    const xStep = (chartW - pad*2) / (sortedAsc.length-1);
    const points = sortedAsc.map((h,i)=>{
      const x = pad + i*xStep;
      const y = pad + (1 - (h.ratingAfter - minR)/span) * (chartH - pad*2);
      return x.toFixed(1)+','+y.toFixed(1);
    }).join(' ');
    chartHTML = `<svg viewBox="0 0 ${chartW} ${chartH}" style="width:100%;height:${chartH}px;display:block;background:var(--sand);border-radius:8px;">
      <polyline fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${points}"/>
    </svg>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray);margin-top:4px;"><span>${Math.round(minR)}</span><span>${sortedAsc.length} games</span><span>${Math.round(maxR)}</span></div>`;
  }
  const sourceBadge = src => {
    const map = { league_kings:['KINGS','#1a3a6b'], league_queens:['QUEENS','#6b21a8'], pickup:['PICKUP','#d4a843'] };
    const v = map[src] || [src||'?', '#6b7280'];
    return `<span style="font-family:'Bebas Neue';font-size:9px;letter-spacing:1px;background:${v[1]};color:#fff;padding:2px 6px;border-radius:4px;vertical-align:middle;">${v[0]}</span>`;
  };
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  $('ph-title').textContent = name;
  $('ph-body').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
      <div>
        <div style="font-family:'Bebas Neue';font-size:42px;line-height:1;color:var(--primary);">${Math.round(rating)}</div>
        <div style="font-size:12px;color:var(--gray);margin-top:2px;">± ${Math.round(rd)} · ${gp} game${gp===1?'':'s'} · peak ${Math.round(peak)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-family:'Bebas Neue';font-size:18px;letter-spacing:1px;"><span class="win">${wins}W</span> · <span class="loss">${losses}L</span></div>
        <div style="font-size:12px;color:var(--gray);">${gp>0 ? Math.round(wins/gp*100)+'% win rate' : ''}</div>
      </div>
    </div>
    <div class="ctitle" style="margin-top:8px;"><span class="bar"></span>Rating Trend</div>
    ${chartHTML}
    <div class="ctitle" style="margin-top:18px;"><span class="bar"></span>Recent Games</div>
    ${recent.length ? `<div style="border-top:1px solid var(--sand-border);">${recent.map(h=>{
      const dStr = h.timestamp ? new Date(h.timestamp).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
      const partner = h.partner ? `with ${esc(h.partner)}` : 'solo';
      const opps = [h.opponent1,h.opponent2].filter(Boolean).map(esc).join(' & ') || '?';
      const change = (h.ratingChange||0);
      const sign = change>=0?'+':'';
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--sand-border);">
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:700;">${h.won?'✓':'✕'} ${h.score||0}-${h.opponentScore||0} ${sourceBadge(h.source)}</div>
          <div style="font-size:11px;color:var(--gray);margin-top:2px;">${dStr} · ${partner} vs ${opps}</div>
        </div>
        <div style="font-family:'Bebas Neue';font-size:14px;color:${change>=0?'var(--win)':'var(--loss)'};min-width:48px;text-align:right;">${sign}${change.toFixed(1)}</div>
      </div>`;
    }).join('')}</div>` : '<p style="color:var(--gray);font-size:13px;padding:8px 0;">No rated games yet.</p>'}
    ${(bestWin || worstLoss) ? `<div class="ctitle" style="margin-top:18px;"><span class="bar"></span>Highlights</div>
    ${bestWin ? `<div style="padding:10px 0;border-bottom:1px solid var(--sand-border);font-size:13px;">
      <div style="font-size:11px;color:var(--gray);text-transform:uppercase;letter-spacing:1px;">Best Win</div>
      <div style="font-weight:700;">vs ${esc(bestWin.opp)} (${Math.round(bestWin.r)})</div>
      <div style="font-size:12px;color:var(--gray);">${bestWin.score} on ${new Date(bestWin.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
    </div>` : ''}
    ${worstLoss ? `<div style="padding:10px 0;border-bottom:1px solid var(--sand-border);font-size:13px;">
      <div style="font-size:11px;color:var(--gray);text-transform:uppercase;letter-spacing:1px;">Toughest Loss</div>
      <div style="font-weight:700;">vs ${esc(worstLoss.opp)} (${Math.round(worstLoss.r)})</div>
      <div style="font-size:12px;color:var(--gray);">${worstLoss.score} on ${new Date(worstLoss.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
    </div>` : ''}` : ''}
    ${partnerRows.length ? `<div class="ctitle" style="margin-top:18px;"><span class="bar"></span>Partners</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="font-family:'Bebas Neue';font-size:11px;letter-spacing:1px;color:var(--gray);">
        <th style="padding:6px 0;text-align:left;">Partner</th>
        <th style="padding:6px;text-align:center;">GP</th>
        <th style="padding:6px;text-align:center;">W</th>
        <th style="padding:6px;text-align:center;">L</th>
        <th style="padding:6px;text-align:center;">+/-</th>
      </tr></thead>
      <tbody>${partnerRows.map(([nm,s])=>`
        <tr style="border-top:1px solid var(--sand-border);font-size:13px;">
          <td style="padding:10px 0;font-weight:700;">${esc(nm)}</td>
          <td style="padding:10px;text-align:center;color:var(--gray);">${s.gp}</td>
          <td style="padding:10px;text-align:center;" class="win">${s.w}</td>
          <td style="padding:10px;text-align:center;" class="loss">${s.l}</td>
          <td style="padding:10px;text-align:center;" class="${pmc(s.pf-s.pa)}">${pm(s.pf-s.pa)}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : ''}
  `;
  $('ph-modal').classList.add('on');
}

// RATINGS TAB
let ratingSort = { key:'rating', dir:'desc' };
function timeAgo(ts){
  const d = Date.now() - ts;
  if(d < 60*1000) return 'just now';
  if(d < 60*60*1000) return Math.round(d/60000)+' min ago';
  if(d < 24*60*60*1000) return Math.round(d/3600000)+' hr ago';
  return Math.round(d/86400000)+' day'+(Math.round(d/86400000)===1?'':'s')+' ago';
}
function renderRatingsHeader(){
  const cont = $('ratings-header'); if(!cont) return;
  const all = Object.values(D.ratings||{}).filter(r=>r&&r.name);
  const total = all.length;
  const avg = total ? Math.round(all.reduce((s,r)=>s+(r.rating||1500),0)/total) : 1500;
  const lastTs = all.reduce((m,r)=>Math.max(m, r.lastUpdated||0), 0);
  const ago = lastTs ? timeAgo(lastTs) : 'never';
  cont.innerHTML = `<div class="card" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
    <div style="flex:1;min-width:140px;">
      <div style="font-family:'Bebas Neue';font-size:24px;color:var(--primary);">${total}</div>
      <div style="font-size:11px;color:var(--gray);text-transform:uppercase;letter-spacing:1px;">Players Ranked</div>
    </div>
    <div style="flex:1;min-width:140px;">
      <div style="font-family:'Bebas Neue';font-size:24px;">${avg}</div>
      <div style="font-size:11px;color:var(--gray);text-transform:uppercase;letter-spacing:1px;">Avg Rating</div>
    </div>
    <div style="flex:1;min-width:140px;">
      <div style="font-size:13px;font-weight:700;">Updated ${ago}</div>
      <button class="btn btn-g btn-sm" style="margin-top:6px;" onclick="$('how-modal').classList.add('on')">ⓘ How ratings work</button>
    </div>
  </div>`;
}
function renderRatings(){
  const tbody = $('rbody'); if(!tbody) return;
  const all = Object.values(D.ratings||{}).filter(r=>r&&r.name);
  if(!all.length){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--gray);">No ratings yet. Run seed-ratings.html or score a game.</td></tr>';
    return;
  }
  const k = ratingSort.key;
  all.sort((a,b)=>{
    const va = a[k]||0, vb = b[k]||0;
    return ratingSort.dir==='asc' ? va-vb : vb-va;
  });
  const rc = ['r1','r2','r3'];
  tbody.innerHTML = all.map((r,i)=>`
    <tr onclick="showPlayerRatingDetail('${String(r.name).replace(/'/g,"\\'")}')" style="cursor:pointer;">
      <td style="padding-left:14px;"><span class="rnk ${rc[i]||''}">${i+1}</span></td>
      <td class="pname">${r.name}</td>
      <td style="font-family:'Bebas Neue';font-size:18px;color:var(--primary);">${Math.round(r.rating||1500)}</td>
      <td style="font-size:12px;color:var(--gray);">± ${Math.round(r.rd||350)}</td>
      <td class="gp">${r.gamesPlayed||0}</td>
    </tr>`).join('');
  document.querySelectorAll('#rtbl th[data-rsort]').forEach(th=>{
    const isSorted = th.dataset.rsort===ratingSort.key;
    th.classList.toggle('sorted', isSorted);
    const labels = { rating:'Rating', rd:'RD', gamesPlayed:'GP' };
    th.textContent = (labels[th.dataset.rsort]||th.dataset.rsort) + (isSorted ? (ratingSort.dir==='asc'?' ▲':' ▼') : '');
  });
}

// ─── ROSTER ───
function renderRoster(){
  const players=Object.values(D[SIDE].players||{}).filter(p=>p&&p.name).sort((a,b)=>a.name.localeCompare(b.name));
  $('pcnt').textContent=`(${players.length})`;
  if(!players.length){$('plist').innerHTML='<p style="color:var(--gray);font-size:14px;padding:16px;text-align:center;">No players yet.</p>';return;}
  $('plist').innerHTML=players.map((p,i)=>`
    <div class="pitem ${p.active===false?'off':''}">
      <span class="pnum">${i+1}</span>
      <span class="pname2">${p.name}</span>
      <div class="pacts">
        <button class="btn btn-g btn-sm" onclick="toggleActive('${p.id}')" style="font-size:11px;padding:8px 10px;">${p.active===false?'Activate':'Pause'}</button>
        <button class="btn btn-d btn-sm" onclick="removePlayer('${p.id}')">✕</button>
      </div>
    </div>`).join('');
}

function addPlayer(){
  const inp=$('new-name'),name=inp.value.trim();
  if(!name){toast('Enter a name');return;}
  // Require admin PIN to add players
  window._pendingPlayerName=name;
  _pinAction='addplayer';_pinEntry='';updatePinDots();
  $('pin-error').textContent='';
  $('pin-modal-title').textContent='Admin PIN';
  $('pin-modal').classList.add('on');
}
function _doAddPlayer(){
  const name=window._pendingPlayerName;
  if(!name)return;
  const id=gi('p');
  fbSet(SIDE+'/players/'+id,{id,name,active:true});
  $('new-name').value='';
  window._pendingPlayerName=null;
  toast(name+' added!');
}
function removePlayer(id){const p=gP(id);if(p){fbDel(SIDE+'/players/'+id);toast(p.name+' removed');}}
function toggleActive(id){const p=gP(id);if(p)fbSet(SIDE+'/players/'+id+'/active',p.active===false);}

// ─── SEASON CONFIG ───
function saveSeasonCfg(){
  const cfg={
    dayOfWeek:parseInt($('cfg-day').value),
    startDate:$('cfg-start').value,
    numWeeks:parseInt($('cfg-weeks').value)||10,
    courts:parseInt($('cfg-courts').value)||2,
    winScore:parseInt($('cfg-score').value)||15
  };
  if(!cfg.startDate){toast('Pick a start date');return;}
  const skipText=$('cfg-skips')?$('cfg-skips').value.trim():'';
  const skipDates=skipText?skipText.split('\n').map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)):[];
  cfg.skipDates=skipDates;
  fbSet(SIDE+'/config',cfg);
  const start=new Date(cfg.startDate+'T12:00:00');
  for(let w=0;w<cfg.numWeeks;w++){
    const d=new Date(start);d.setDate(d.getDate()+w*7);
    const ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const wid='w'+(w+1);
    const isSk=skipDates.includes(ds);
    if(!D[SIDE].weeks[wid]) fbSet(SIDE+'/weeks/'+wid,{id:wid,weekNum:w+1,date:ds,absences:[],subs:null,rounds:null,skipped:isSk});
    else fbSet(SIDE+'/weeks/'+wid+'/skipped',isSk);
  }
  toast('Season saved!');
}

function renderPlannerCfg(){
  const c=D[SIDE].config||{};
  if(c.dayOfWeek!=null)$('cfg-day').value=c.dayOfWeek;
  if(c.startDate)$('cfg-start').value=c.startDate;
  if(c.numWeeks)$('cfg-weeks').value=c.numWeeks;
  if(c.courts)$('cfg-courts').value=c.courts;
  if(c.winScore)$('cfg-score').value=c.winScore;
  if(c.skipDates&&c.skipDates.length){const el=$('cfg-skips');if(el)el.value=c.skipDates.join('\n');}
}

function fillWeekSels(){
  const weeks=Object.values(D[SIDE].weeks||{}).sort((a,b)=>a.weekNum-b.weekNum);
  ['week-sel','live-sel'].forEach(selId=>{
    const sel=$(selId);if(!sel)return;
    const cur=sel.value;
    sel.innerHTML='<option value="">— Select Week —</option>'+weeks.map(w=>{
      const lbl=w.cancelled?' (Cancelled)':w.skipped?' (Skipped)':'';
      return`<option value="${w.id}">Week ${w.weekNum} · ${fD(w.date)}${lbl}</option>`;
    }).join('');
    if(cur)sel.value=cur;
  });
}

// ─── WEEK DETAIL ───
function loadWeekDetail(){
  const wid=$('week-sel').value;
  const week=D[SIDE].weeks[wid];
  const cont=$('week-detail');
  if(!week){cont.innerHTML='';return;}
  const absences=week.absences||[];
  const subs=week.subs||[];
  let h=`<div style="font-size:14px;margin-bottom:10px;">
    <strong>Week ${week.weekNum}</strong> · ${fD(week.date)}`;
  const abNames=absences.map(id=>pN(id)).filter(n=>n!=='?');
  if(abNames.length) h+=`<div class="chip-grp">${abNames.map(n=>`<span class="abs-chip">📵 ${n}</span>`).join('')}</div>`;
  const subNames=(subs||[]).map(s=>`${s.name} ➜ ${pN(s.forPlayerId)}`);
  if(subNames.length) h+=`<div class="chip-grp">${subNames.map(n=>`<span class="abs-chip sub-chip">🔄 ${n}</span>`).join('')}</div>`;
  h+='</div>';
  if(week.rounds&&week.rounds.length){
    week.rounds.forEach(rd=>{
      h+=`<div class="rblock"><div class="rtitle">Round ${rd.round}</div>`;
      (rd.courts||[]).forEach((c,cidx)=>{
        const t1=c.t1.map(id=>pN(id)).join(' & ');
        const t2=c.t2.map(id=>pN(id)).join(' & ');
        const hasQ=c.t1.concat(c.t2).some(id=>pN(id)==='?');
        h+=`<div class="crow" style="align-items:center;">
          <span class="cbadge">CT ${c.court}</span>
          <span style="flex:1;">${t1}</span>
          <span style="color:var(--gray);padding:0 4px;">vs</span>
          <span style="flex:1;text-align:right;">${t2}</span>
          <button onclick="promptEditCourtPlayers('${wid}',${rd.round},${cidx})" style="margin-left:8px;padding:4px 8px;font-size:11px;background:${hasQ?'var(--loss)':'var(--gray)'};color:#fff;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;flex-shrink:0;">${hasQ?'⚠️ Fix':'✏️'}</button>
        </div>`;
      });
      if(rd.sitting&&rd.sitting.length) h+=`<div class="sit">Sitting: ${rd.sitting.map(id=>pN(id)).join(', ')}</div>`;
      h+=`</div>`;
    });
  } else {
    h+=`<div class="empty"><div class="eico">🤖</div><p class="etxt">No schedule yet. Tap Generate Tonight's Schedule above.</p></div>`;
  }
  if(week.rounds&&week.rounds.length){
    h+=`<button onclick="promptClearSchedule('${wid}')" style="margin-top:12px;width:100%;padding:10px;background:#fee2e2;color:var(--loss);border:1.5px solid #fca5a5;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">🗑 Clear Schedule</button>`;
  }
  cont.innerHTML=h;
}

// ─── CLEAR SCHEDULE ───
function promptClearSchedule(wid){
  if(_plannerUnlocked){
    if(confirm('Clear the schedule for this week? This cannot be undone.')) doClearSchedule(wid);
    return;
  }
  _editCourtCtx = {wid, roundNum:null, courtIdx:null};
  _pinAction = 'clearschedule';
  _pinEntry = '';
  updatePinDots();
  $('pin-error').textContent = '';
  $('pin-modal-title').textContent = 'Admin PIN — Clear Schedule';
  $('pin-modal').classList.add('on');
}
function doClearSchedule(wid){
  fbDel(SIDE+'/weeks/'+wid+'/rounds');
  toast('Schedule cleared.');
  loadWeekDetail();
}

// ─── ABSENCE MODAL ───
function openAbsModal(){
  const wid=$('week-sel').value;
  if(!wid){toast('Select a week first');return;}
  const week=D[SIDE].weeks[wid];if(!week)return;
  const players=Object.values(D[SIDE].players||{}).filter(p=>p&&p.name&&p.active!==false);
  const absences=week.absences||[];
  const subs=week.subs||[];
  let h=`<div style="font-size:14px;color:var(--gray);margin-bottom:14px;"><strong style="color:var(--black);">Week ${week.weekNum}</strong> · ${fD(week.date)}</div>`;
  h+=`<div style="font-family:'Bebas Neue';font-size:12px;letter-spacing:1px;color:var(--gray);margin-bottom:10px;">MARK ABSENCES — tap to flag, add sub name if known</div>`;
  players.forEach(p=>{
    const isAbs=absences.includes(p.id);
    const subEntry=(subs||[]).find(s=>s.forPlayerId===p.id);
    h+=`<div style="padding:12px 0;border-bottom:1px solid var(--sand-border);">
      <div style="display:flex;align-items:center;gap:12px;">
        <input type="checkbox" id="abs-${p.id}" ${isAbs?'checked':''} style="width:22px;height:22px;accent-color:var(--primary);cursor:pointer;">
        <label for="abs-${p.id}" style="flex:1;font-weight:700;font-size:15px;cursor:pointer;">${p.name}</label>
      </div>
      <div id="sub-row-${p.id}" style="margin-top:8px;padding-left:34px;display:${isAbs?'block':'none'};">
        <input class="inp" id="sub-${p.id}" placeholder="Sub name (optional)" value="${subEntry?subEntry.name:''}" style="font-size:13px;padding:10px 12px;">
      </div>
    </div>`;
  });
  $('abs-body').innerHTML=h;
  // Toggle sub inputs on checkbox change
  players.forEach(p=>{
    const cb=$('abs-'+p.id);
    if(cb) cb.addEventListener('change',()=>{
      const row=$('sub-row-'+p.id);
      if(row) row.style.display=cb.checked?'block':'none';
    });
  });
  $('abs-modal').classList.add('on');
}

function saveAbsences(){
  const wid=$('week-sel').value;
  const week=D[SIDE].weeks[wid];if(!week)return;
  const players=Object.values(D[SIDE].players||{}).filter(p=>p&&p.name&&p.active!==false);
  const absences=[],subs=[];
  players.forEach(p=>{
    const cb=$('abs-'+p.id);
    if(cb&&cb.checked){
      absences.push(p.id);
      const subInp=$('sub-'+p.id);
      const subName=subInp?subInp.value.trim():'';
      if(subName) subs.push({name:subName,forPlayerId:p.id});
    }
  });
  fbSet(SIDE+'/weeks/'+wid+'/absences',absences.length?absences:null);
  fbSet(SIDE+'/weeks/'+wid+'/subs',subs.length?subs:null);
  $('abs-modal').classList.remove('on');
  toast('Absences saved!');
  loadWeekDetail();
}

// ─── SCHEDULE GENERATION PIN PROTECTION ───
function promptGenSchedule(fromScore){
  _genFromScore = !!fromScore;
  _pinAction = 'genschedule';
  _pinEntry = '';
  updatePinDots();
  $('pin-error').textContent = '';
  $('pin-modal-title').textContent = 'Admin PIN — Generate Schedule';
  $('pin-modal').classList.add('on');
}
async function doGenScheduleAction(){
  if(_genFromScore){
    if(!liveWeek){toast('Select a week first');return;}
    const weekSel=$('week-sel');if(weekSel)weekSel.value=liveWeek;
    await genNight();
    renderWeekActions();renderRoundPills();renderLiveCourts();
  } else {
    await genNight();
  }
}

// ─── EDIT COURT PLAYERS (PLANNER) ───
function promptEditCourtPlayers(wid, roundNum, courtIdx){
  _editCourtCtx = {wid, roundNum, courtIdx};
  _pinAction = 'editcourt';
  _pinEntry = '';
  updatePinDots();
  $('pin-error').textContent = '';
  $('pin-modal-title').textContent = 'Admin PIN — Edit Court';
  $('pin-modal').classList.add('on');
}
function openEditCourtModal(){
  const {wid, roundNum, courtIdx} = _editCourtCtx;
  const week = D[SIDE].weeks[wid];
  if(!week){toast('Week not found');return;}
  const rd = (week.rounds||[]).find(r=>r.round===roundNum);
  if(!rd){toast('Round not found');return;}
  const court = rd.courts[courtIdx];
  if(!court){toast('Court not found');return;}
  const players = Object.values(D[SIDE].players||{})
    .filter(p=>p&&p.name&&p.active!==false)
    .sort((a,b)=>a.name.localeCompare(b.name));

  $('edit-court-title').textContent = `Edit Court \u2014 Round ${roundNum} Court ${court.court}`;

  let h = `<div style="font-size:13px;color:var(--gray);margin-bottom:14px;">Select the correct registered players for each slot. Changes save directly to the schedule.</div>`;

  ['Team 1','Team 2'].forEach((label,ti)=>{
    const team = ti===0 ? court.t1 : court.t2;
    h += `<div style="font-family:'Bebas Neue';font-size:13px;letter-spacing:1px;color:var(--primary);margin:14px 0 8px;">${label}</div>`;
    team.forEach((pid,pi)=>{
      const knownPlayer = players.find(p=>p.id===pid);
      const unknownBadge = knownPlayer ? '' : ` <span style="color:var(--loss);">(fix this)</span>`;
      const opts = players.map(p=>`<option value="${p.id}"${p.id===pid?' selected':''}>${p.name}</option>`).join('');
      const unknownOpt = knownPlayer ? '' : `<option value="${pid}" selected>? (unknown)</option>`;
      h += `<div style="margin-bottom:10px;">
        <label style="font-size:11px;letter-spacing:1px;color:var(--gray);display:block;margin-bottom:4px;">PLAYER ${pi+1}${unknownBadge}</label>
        <select data-team="${ti}" data-slot="${pi}" style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:10px;font-size:15px;background:#fff;color:#222;">
          ${unknownOpt}${opts}
        </select>
      </div>`;
    });
  });

  if(rd.sitting&&rd.sitting.length){
    h += `<div style="font-size:12px;color:var(--gray);margin-top:10px;padding-top:10px;border-top:1px solid #eee;">Sitting this round: ${rd.sitting.map(id=>pN(id)).join(', ')}</div>`;
  }

  $('edit-court-body').innerHTML = h;
  $('edit-court-modal').classList.add('on');
}

function saveEditCourt(){
  const {wid, roundNum, courtIdx} = _editCourtCtx;
  const week = D[SIDE].weeks[wid];
  if(!week){toast('Week not found');return;}
  const rounds = JSON.parse(JSON.stringify(week.rounds||[]));
  const rdIdx = rounds.findIndex(r=>r.round===roundNum);
  if(rdIdx===-1){toast('Round not found');return;}
  const court = rounds[rdIdx].courts[courtIdx];
  $('edit-court-body').querySelectorAll('select').forEach(sel=>{
    const ti = parseInt(sel.dataset.team);
    const pi = parseInt(sel.dataset.slot);
    if(ti===0) court.t1[pi]=sel.value;
    else court.t2[pi]=sel.value;
  });
  rounds[rdIdx].courts[courtIdx] = court;
  fbSet(SIDE+'/weeks/'+wid+'/rounds', rounds);
  closeModal('edit-court-modal');
  toast('Court updated!');
  loadWeekDetail();
}

// ─── SCORE TAB SCHEDULE GENERATION ───
async function genNightFromScore(){
  if(!liveWeek){toast('Select a week first');return;}
  const weekSel=$('week-sel');if(weekSel)weekSel.value=liveWeek;
  await genNight();
  renderWeekActions();renderRoundPills();renderLiveCourts();
}

// ─── AI SCHEDULE GENERATION ───
// --- SCHEDULE HEALER ---
function healSchedule(parsed,pool,pCounts,oCounts,TARGET_GAMES){
  const validIds=pool.map(p=>p.id);
  const poolSet=new Set(validIds);

  function countGames(sched){
    const c={};validIds.forEach(id=>c[id]=0);
    sched.forEach(rd=>(rd.courts||[]).forEach(ct=>[...(ct.t1||[]),...(ct.t2||[])].forEach(id=>{if(c[id]!=null)c[id]++;})));
    return c;
  }

  function pickBest(candidates,partnerIds,oppIds,gameCounts){
    return candidates.slice().sort((a,b)=>{
      const sc=id=>(gameCounts[id]||0)*1+partnerIds.reduce((s,q)=>s+(pCounts[id]&&pCounts[id][q]!=null?pCounts[id][q]:0)*3,0)+oppIds.reduce((s,q)=>s+(oCounts[id]&&oCounts[id][q]!=null?oCounts[id][q]:0)*2,0);
      return sc(a)-sc(b);
    })[0];
  }

  // Pass 1: fix "?" / invalid / missing slots per round
  parsed.forEach(rd=>{
    const roundUsed=new Set();
    (rd.courts||[]).forEach(ct=>[...(ct.t1||[]),...(ct.t2||[])].forEach(id=>{if(poolSet.has(id)&&id!=='?')roundUsed.add(id);}));
    const sittingSet=new Set((rd.sitting||[]).filter(id=>poolSet.has(id)));
    (rd.courts||[]).forEach(ct=>{
      const fixTeam=(team,other)=>team.forEach((id,i)=>{
        if(!id||id.trim()==='?'||!poolSet.has(id)){
          let available=validIds.filter(pid=>!roundUsed.has(pid));
          // Fallback: if all court slots are full, steal from sitting list
          if(!available.length) available=[...sittingSet];
          if(!available.length)return;
          const partner=team.filter((_,j)=>j!==i&&poolSet.has(_)&&_&&_.trim()!=='?');
          const gc=countGames(parsed);
          const chosen=pickBest(available,partner,(other||[]).filter(q=>poolSet.has(q)),gc);
          if(!chosen)return;
          team[i]=chosen;roundUsed.add(chosen);sittingSet.delete(chosen);
        }
      });
      fixTeam(ct.t1,ct.t2||[]);
      fixTeam(ct.t2,ct.t1||[]);
    });
    rd.sitting=[...sittingSet];
  });

  // Pass 2: enforce TARGET_GAMES per player
  for(let iter=0;iter<50;iter++){
    const counts=countGames(parsed);
    const under=validIds.filter(id=>counts[id]<TARGET_GAMES);
    const over=validIds.filter(id=>counts[id]>TARGET_GAMES);
    if(!under.length&&!over.length)break;
    let swapped=false;
    for(const uid of under){
      for(const rd of parsed){
        if(!(rd.sitting||[]).includes(uid))continue;
        for(const ct of(rd.courts||[])){
          for(const team of[ct.t1,ct.t2]){
            for(let i=0;i<team.length;i++){
              if(over.includes(team[i])){
                const swapId=team[i];
                rd.sitting=rd.sitting.filter(s=>s!==uid);
                rd.sitting.push(swapId);
                team[i]=uid;
                swapped=true;break;
              }
            }if(swapped)break;
          }if(swapped)break;
        }if(swapped)break;
      }if(swapped)break;
    }
    if(!swapped)break;
  }
  return parsed;
}

async function genNight(skipOverwriteCheck){
  const wid=$('week-sel').value;
  if(!wid){toast('Select a week first');return;}
  const week=D[SIDE].weeks[wid];if(!week)return;
  // ── Overwrite guard (fix #1): warn before replacing an existing schedule ──
  if(!skipOverwriteCheck){
    const existingRounds=Array.isArray(week.rounds)?week.rounds.length:(week.rounds?Object.keys(week.rounds).length:0);
    const resultCount=Object.values(D[SIDE].results||{}).filter(r=>r&&r.weekId===wid).length;
    if(existingRounds>0){
      const msg=resultCount>0
        ? 'Heads up: this week already has a schedule and '+resultCount+' recorded result'+(resultCount===1?'':'s')+'.\n\nGenerating a new schedule will replace the current matchups. Your recorded scores stay saved, but they may no longer match the new rounds.\n\nReplace the schedule anyway?'
        : 'This week already has a schedule.\n\nGenerating a new one will replace the current matchups.\n\nReplace it?';
      if(!confirm(msg)) return;
    }
  }
  const cfg=D[SIDE].config||{};
  const courts=cfg.courts||2;
  const absences=getSessionAbsences();
  const allP=Object.values(D[SIDE].players||{}).filter(p=>p&&p.name&&p.active!==false);
  const present=allP.filter(p=>!absences.includes(p.id));
  // Auto-label absent players as Sub 1, Sub 2, etc.
  let subCounter=0;
  const subPlayers=absences.map(abPid=>{
    const namedSub=(week.subs||[]).find(s=>s.forPlayerId===abPid);
    const subName=namedSub&&namedSub.name?namedSub.name:'Sub '+(++subCounter);
    return {id:subName,name:subName,isSub:true,forId:abPid};
  });
  const pool=[...present,...subPlayers];
  if(pool.length<4){toast('Need at least 4 players (present + subs)');return;}

  // Partner counts + opponent counts for optimization
  const pCounts={};
  const oCounts={};
  pool.forEach(p=>{
    pCounts[p.id]={};
    oCounts[p.id]={};
    pool.forEach(q=>{if(p.id!==q.id){pCounts[p.id][q.id]=0;oCounts[p.id][q.id]=0;}});
  });
  Object.values(D[SIDE].results||{}).forEach(r=>{
    // Partners: teammates on same team
    const processTeam=team=>{if(!team||team.length<2)return;const[a,b]=team;if(pCounts[a]&&pCounts[a][b]!=null)pCounts[a][b]++;if(pCounts[b]&&pCounts[b][a]!=null)pCounts[b][a]++;};
    processTeam(r.t1);processTeam(r.t2);
    // Opponents: players on opposite teams
    const t1=r.t1||[],t2=r.t2||[];
    t1.forEach(a=>t2.forEach(b=>{
      if(oCounts[a]&&oCounts[a][b]!=null)oCounts[a][b]++;
      if(oCounts[b]&&oCounts[b][a]!=null)oCounts[b][a]++;
    }));
  });

  $('week-detail').innerHTML='<div class="ai-load"><div class="spin"></div><div>AI is building tonight\'s rotation...</div></div>';

  // Build short IDs (P1..PN) so the AI doesn't have to track Firebase keys
  const shortId={};   // realId -> shortId
  const shortIdRev={}; // shortId -> realId
  pool.forEach((p,i)=>{ const sid='P'+(i+1); shortId[p.id]=sid; shortIdRev[sid]=p.id; });

  const playerList=pool.map(p=>shortId[p.id]+':'+p.name+(p.isSub?' (SUB for '+pN(p.forId)+')':'')).join(', ');
  const pSummary=pool.map(p=>`${p.name}(${shortId[p.id]}) partnered with: ${Object.entries(pCounts[p.id]||{}).filter(([,c])=>c>0).map(([id,c])=>pN(id)||id+' x'+c).join(', ')||'nobody yet'}`).join('\n');
  const oSummary=pool.map(p=>`${p.name}(${shortId[p.id]}) faced: ${Object.entries(oCounts[p.id]||{}).filter(([,c])=>c>0).map(([id,c])=>pN(id)||id+' x'+c).join(', ')||'nobody yet'}`).join('\n');

  // Rounds needed so every player gets exactly 6 games
  const TARGET_GAMES=6;
  const slotsPerRound=courts*4;
  const totalRounds=pool.length<=slotsPerRound
    ? TARGET_GAMES
    : Math.ceil(pool.length*TARGET_GAMES/slotsPerRound);
  const sitPerRound=Math.max(0,pool.length-slotsPerRound);

  const prompt=`You are scheduling a King/Queen of the Beach recreational league night.

PLAYERS TONIGHT (${pool.length} players, ${courts} courts):
${playerList}

PAST PARTNER HISTORY (who has played on the same team together):
${pSummary}

PAST OPPONENT HISTORY (who has played against each other):
${oSummary}

RULES:
- Each round: ${courts} courts running simultaneously. Each court = 2v2 (4 players per court).
- Active per round: ${slotsPerRound} players. Sitting out: ${sitPerRound} per round.
- Generate EXACTLY ${totalRounds} rounds.
- PRIMARY GOAL: every player must play exactly ${TARGET_GAMES} games total.
- Distribute sit-outs evenly — each player sits out roughly ${totalRounds-TARGET_GAMES} times.
- PARTNER VARIETY: NEVER pair the same two players as partners twice in one night if possible. Prioritize pairs who have never partnered before.
- OPPONENT VARIETY: equally important — avoid putting the same two players on opposite sides of the net repeatedly. Spread opponent matchups as evenly as possible across all players.
- SEASON GOAL: by end of season every player should have partnered with AND faced every other player roughly equal times.
- SUB players: include them in matchups normally. Track by their given IDs.

Return ONLY a valid JSON array — no explanation, no markdown:
[
  {"round":1,"courts":[{"court":1,"t1":["P1","P2"],"t2":["P3","P4"]},{"court":2,"t1":["P5","P6"],"t2":["P7","P8"]}],"sitting":["P9","P10"]},
  ...${totalRounds} rounds total
]

VERIFICATION: Before returning, mentally count how many times each player ID appears across all t1+t2 arrays. Every player must appear exactly ${TARGET_GAMES} times. Adjust sitting lists until this is true for every player.

Use ONLY the short IDs (P1, P2, P3...) exactly as listed above. CRITICAL: NEVER use "?" or any placeholder — every slot in t1 and t2 must be one of the P-codes from the player list. If unsure, use any valid P-code rather than "?". Return only the JSON array.`;

  try{
    const res=await fetch(AI_URL,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:16000,messages:[{role:'user',content:prompt}]})});
    const data=await res.json();
    const text=data.content?.map(c=>c.text||'').join('')||'';
    let parsed;
    try{
      const clean=text.replace(/```json|```/g,'').trim();
      const s=clean.indexOf('['),e=clean.lastIndexOf(']');
      parsed=JSON.parse(clean.slice(s,e+1));
      // Convert short IDs (P1..PN) back to real IDs, and fix any name-as-ID usage
      const nameToId={};
      pool.forEach(p=>{ nameToId[p.name.toLowerCase().trim()]=p.id; });
      parsed.forEach(rd=>{
        (rd.courts||[]).forEach(ct=>{
          ['t1','t2'].forEach(team=>{
            ct[team]=(ct[team]||[]).map(sid=>{
              if(shortIdRev[sid]) return shortIdRev[sid];            // P1..PN -> real ID
              const byName=nameToId[String(sid).toLowerCase().trim()];
              if(byName) return byName;                               // name -> real ID
              return sid;                                             // pass through (healer will catch)
            });
          });
        });
        rd.sitting=(rd.sitting||[]).map(sid=>{
          if(shortIdRev[sid]) return shortIdRev[sid];
          const byName=nameToId[String(sid).toLowerCase().trim()];
          if(byName) return byName;
          return sid;
        });
      });
    }catch(pe){
      $('week-detail').innerHTML=`<div style="color:var(--loss);font-size:13px;padding:12px;">Couldn't parse AI response — the AI response may have been cut off or malformed. Tap Retry to try again.<br><button onclick="genNight(true)" style="margin-top:10px;padding:8px 18px;background:var(--acc);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">🔄 Retry</button></div>`;
      return;
    }
    // Heal first (fixes '?' and invalid slots), then validate
    console.log('[KotB] Pool IDs:', pool.map(p=>p.id));
    console.log('[KotB] Raw AI slots (pre-heal):', parsed.flatMap(rd=>(rd.courts||[]).flatMap(ct=>[...ct.t1,...ct.t2])));
    parsed=healSchedule(parsed,pool,pCounts,oCounts,TARGET_GAMES);
    console.log('[KotB] Post-heal slots:', parsed.flatMap(rd=>(rd.courts||[]).flatMap(ct=>[...ct.t1,...ct.t2])));
    const hasPlaceholder=parsed.some(rd=>(rd.courts||[]).some(ct=>[...(ct.t1||[]),...(ct.t2||[])].some(id=>!id||id.trim()==='?')));
    if(hasPlaceholder){
      $('week-detail').innerHTML=`<div style="color:var(--loss);font-size:13px;padding:12px;">AI returned placeholder names instead of real players -- tap Retry to regenerate.<br><button onclick="genNight(true)" style="margin-top:10px;padding:8px 18px;background:var(--acc);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">🔄 Retry</button></div>`;
      toast('Schedule had bad slots -- please retry');
      return;
    }
    fbSet(SIDE+'/weeks/'+wid+'/rounds',parsed);
    // Store pending update so Firebase listener re-applies if it fires with stale data
    _pendingRoundsUpdate={side:SIDE,weekId:wid,rounds:parsed,ts:Date.now()};
    setTimeout(()=>{_pendingRoundsUpdate=null;},10000);
    // Update in-memory D immediately so Score tab renders without waiting for Firebase roundtrip
    if(D[SIDE]&&D[SIDE].weeks&&D[SIDE].weeks[wid]) D[SIDE].weeks[wid].rounds=parsed;
    toast('Schedule generated! ✓');
    loadWeekDetail();
  }catch(err){
    console.error(err);
    $('week-detail').innerHTML=`<div style="color:var(--loss);font-size:13px;padding:12px;">Error connecting to AI — check your connection and try again.<br><button onclick="genNight(true)" style="margin-top:10px;padding:8px 18px;background:var(--acc);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">🔄 Retry</button></div>`;
  }
}

// ─── DETERMINISTIC FULL-SEASON GENERATOR (no AI) ───
// Builds every non-skipped week's rounds in one pass from the REGISTERED roster only.
// Even games per night, even season-long sit-outs, partner/opponent variety balanced
// across the whole season by construction. No absence input, no AI, device-independent.
// Subs are handled purely at game time on the Score tab and never touch this schedule.
function _csPv(C,a,b){return (C[a]&&C[a][b])||0;}
function _csChg(C,a,b,d){if(!C[a])C[a]={};if(!C[b])C[b]={};C[a][b]=(C[a][b]||0)+d;C[b][a]=(C[b][a]||0)+d;}
function buildSeasonNight(ids,courts,pC,oC,sitCount,TARGET,weekIdx){
  const n=ids.length,courtsN=Math.min(courts,Math.floor(n/4));
  if(courtsN<1)return null;
  const slots=courtsN*4,sitPer=n-slots;
  const totalRounds=sitPer===0?TARGET:Math.ceil(n*TARGET/slots);
  const gtw={},idx={};ids.forEach((id,i)=>{gtw[id]=0;idx[id]=i;});
  const rounds=[];
  for(let r=1;r<=totalRounds;r++){
    const rotor=(r*5+weekIdx*3);
    const sorted=ids.slice().sort((a,b)=>(gtw[b]-gtw[a])||((sitCount[a]||0)-(sitCount[b]||0))||(((idx[a]+rotor)%n)-((idx[b]+rotor)%n)));
    const sitters=sorted.slice(0,sitPer),active=sorted.slice(sitPer);
    sitters.forEach(id=>sitCount[id]=(sitCount[id]||0)+1);active.forEach(id=>gtw[id]++);
    const rem=active.slice(),teams=[];
    while(rem.length){let bi=0,bj=1,bc=Infinity;for(let i=0;i<rem.length;i++)for(let j=i+1;j<rem.length;j++){const c=_csPv(pC,rem[i],rem[j]);if(c<bc){bc=c;bi=i;bj=j;}}teams.push([rem[bi],rem[bj]]);rem.splice(bj,1);rem.splice(bi,1);}
    const tr=teams.slice(),carr=[];let cn=1;
    while(tr.length>=2){let bi=0,bj=1,bc=Infinity;for(let i=0;i<tr.length;i++)for(let j=i+1;j<tr.length;j++){let c=0;tr[i].forEach(a=>tr[j].forEach(b=>c+=_csPv(oC,a,b)));if(c<bc){bc=c;bi=i;bj=j;}}carr.push({court:cn++,t1:tr[bi].slice(),t2:tr[bj].slice()});tr.splice(bj,1);tr.splice(bi,1);}
    rounds.push({round:r,courts:carr,sitting:sitters.slice()});
  }
  const undo=(c,d)=>{_csChg(pC,c.t1[0],c.t1[1],d);_csChg(pC,c.t2[0],c.t2[1],d);c.t1.forEach(a=>c.t2.forEach(b=>_csChg(oC,a,b,d)));};
  rounds.forEach(rd=>rd.courts.forEach(c=>undo(c,1)));
  const cost=()=>{let s=0;for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const p=_csPv(pC,ids[i],ids[j]),o=_csPv(oC,ids[i],ids[j]);s+=p*p*3+o*o+(p===0?40:0)+(o===0?15:0);}return s;};
  const activeArr=rd=>{const m=[];rd.courts.forEach((c,ci)=>['t1','t2'].forEach(tk=>c[tk].forEach((id,si)=>m.push({id,ci,tk,si}))));return m;};
  let moves=1,guard=0;
  while(moves>0&&guard++<400){
    moves=0;
    for(let r1=0;r1<rounds.length&&moves===0;r1++)for(let r2=0;r2<rounds.length&&moves===0;r2++){
      if(r1===r2)continue;
      const aList=activeArr(rounds[r1]).filter(x=>rounds[r2].sitting.includes(x.id));
      for(const A of aList){
        if(moves)break;
        const bList=activeArr(rounds[r2]).filter(x=>rounds[r1].sitting.includes(x.id));
        for(const B of bList){
          if(A.id===B.id)continue;
          const c1=rounds[r1].courts[A.ci],c2=rounds[r2].courts[B.ci];
          const before=cost();
          undo(c1,-1);undo(c2,-1);
          c1[A.tk][A.si]=B.id;c2[B.tk][B.si]=A.id;
          undo(c1,1);undo(c2,1);
          if(cost()<before){
            rounds[r1].sitting=rounds[r1].sitting.map(x=>x===B.id?A.id:x);
            rounds[r2].sitting=rounds[r2].sitting.map(x=>x===A.id?B.id:x);
            moves=1;break;
          }else{undo(c1,-1);undo(c2,-1);c1[A.tk][A.si]=A.id;c2[B.tk][B.si]=B.id;undo(c1,1);undo(c2,1);}
        }
      }
    }
  }
  return {rounds};
}
function promptGenFullSeason(){
  _pinAction='genseason';_pinEntry='';updatePinDots();
  $('pin-error').textContent='';
  $('pin-modal-title').textContent='Admin PIN — Generate Full Season';
  $('pin-modal').classList.add('on');
}
function doGenSeasonAction(){ genFullSeason(); }
function genFullSeason(){
  const pool=Object.values(D[SIDE].players||{}).filter(p=>p&&p.name&&p.active!==false).map(p=>p.id);
  if(pool.length<4){toast('Need at least 4 active players');return;}
  const weeks=Object.values(D[SIDE].weeks||{}).filter(w=>w&&!w.skipped&&!w.cancelled).sort((a,b)=>a.weekNum-b.weekNum);
  if(!weeks.length){toast('Set up a season first');return;}
  const resultCount=Object.values(D[SIDE].results||{}).length;
  if(resultCount>0){
    alert('Cannot regenerate the season: '+resultCount+' result'+(resultCount===1?' is':'s are')+' already recorded.\n\nRegenerating would break the link between recorded scores and the schedule. Use Close & Archive Season to start fresh.');
    return;
  }
  const hasSchedules=weeks.some(w=>w.rounds&&(Array.isArray(w.rounds)?w.rounds.length:Object.keys(w.rounds).length));
  if(hasSchedules&&!confirm('This replaces the schedule for all '+weeks.length+' weeks. No results are recorded yet, so nothing is lost. Continue?')) return;
  const courts=(D[SIDE].config||{}).courts||2;
  const TARGET=6;
  const pC={},oC={},sitCount={};
  let built=0;
  for(let wi=0;wi<weeks.length;wi++){
    const res=buildSeasonNight(pool,courts,pC,oC,sitCount,TARGET,wi);
    if(!res){toast('Need at least 4 active players for the configured courts');return;}
    const wid=weeks[wi].id;
    fbSet(SIDE+'/weeks/'+wid+'/rounds',res.rounds);
    if(D[SIDE]&&D[SIDE].weeks&&D[SIDE].weeks[wid]) D[SIDE].weeks[wid].rounds=res.rounds;
    built++;
  }
  toast('Full season generated for '+built+' week'+(built===1?'':'s')+' \u2713');
  fillWeekSels();loadWeekDetail();
}

// ─── LIVE SCORING ───

// ─── SCORE TAB INLINE ABSENCE PANEL (localStorage, same-day persistence) ────
function _absKey(){
  const today=td();
  return'kotb_abs_'+SIDE+'_'+today;
}
function getSessionAbsences(){
  try{const v=localStorage.getItem(_absKey());return v?JSON.parse(v):[];}catch(e){return[];}
}
function setSessionAbsences(arr){
  try{localStorage.setItem(_absKey(),JSON.stringify(arr));}catch(e){}
  // Clean up other days
  try{
    Object.keys(localStorage).forEach(k=>{
      if(k.startsWith('kotb_abs_')&&k!==_absKey())localStorage.removeItem(k);
    });
  }catch(e){}
}

function renderScoreAbsencePanel(){
  const panel=$('score-absence-panel');if(!panel)return;
  // UI removal (2026-06-03): the "Tonight's Roster" / absence panel no longer renders on the Score tab.
  // Players should not mark absences here; substitutions are handled via "Edit Players" on each court.
  // UI-only hide — getSessionAbsences/setSessionAbsences/toggleScoreAbsence and the schedule generator's
  // absence labeling are all left intact. Delete these two lines to restore the panel.
  panel.style.display='none'; return;
  if(!liveWeek){panel.style.display='none';return;}
  const week=D[SIDE].weeks[liveWeek];
  if(!week||week.cancelled||week.skipped){panel.style.display='none';return;}
  panel.style.display='block';

  const players=Object.values(D[SIDE].players||{}).filter(p=>p&&p.name&&p.active!==false)
    .sort((a,b)=>a.name.localeCompare(b.name));
  const absences=getSessionAbsences();
  const absentCount=absences.length;
  const hasSchedule=!!(week.rounds&&week.rounds.length);

  // Figure out which sub slots are still unscored (for late arrival)
  const scoredRounds=new Set(
    Object.values(D[SIDE].results||{})
      .filter(r=>r.weekId===liveWeek)
      .map(r=>r.round)
  );

  let h=`<div style="background:var(--sand-bg);border:1px solid var(--sand-border);border-radius:10px;overflow:hidden;">
    <div style="padding:12px 14px;border-bottom:1px solid var(--sand-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer;" onclick="toggleAbsPanel()">
      <div style="font-family:'Bebas Neue';font-size:14px;letter-spacing:1px;color:var(--primary);">👥 Tonight's Roster</div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${absentCount?`<span style="background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;">${absentCount} absent</span>`:'<span style="font-size:12px;color:var(--gray);">All present</span>'}
        <span id="abs-panel-arrow" style="font-size:12px;color:var(--gray);">▾</span>
      </div>
    </div>
    <div id="abs-panel-body" style="display:none;padding:10px 14px;">
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Tap to mark a player absent. Their spot fills as Sub 1, Sub 2, etc. when the schedule generates.</div>`;

  const savedSubs=week.subs||[];
  let subN=0;
  players.forEach(p=>{
    const isAbs=absences.includes(p.id);
    if(isAbs)subN++;
    const subLabel=isAbs?'Sub '+subN:'';
    const roundsLeft=hasSchedule?(week.rounds||[]).filter(rd=>!scoredRounds.has(rd.round)).length:0;
    h+=`<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--sand-border);">
      <div style="flex:1;font-weight:${isAbs?'400':'700'};font-size:14px;color:${isAbs?'var(--gray)':'var(--black)'};text-decoration:${isAbs?'line-through':'none'};">${p.name}</div>
      ${isAbs?`<span style="font-size:11px;color:#92400e;font-weight:600;font-style:italic;white-space:nowrap;">${subLabel}</span>`:''}
      ${isAbs&&hasSchedule&&roundsLeft>0
        ?`<button onclick="lateArrival('${p.id}')" style="background:#d1fae5;color:#065f46;border:none;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">🏃 Arrived</button>`
        :''}
      <button onclick="toggleScoreAbsence('${p.id}')" style="background:${isAbs?'#fee2e2':'var(--gray-lighter)'};color:${isAbs?'#b91c1c':'var(--gray)'};border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">
        ${isAbs?'✕ Absent':'Absent'}
      </button>
    </div>
    ${isAbs?`<div style="padding:6px 0 4px 2px;"><input class="inp" placeholder="Sub name (optional)" value="${savedSubs.find(x=>x.forPlayerId===p.id)?.name||''}" oninput="saveScoreSubName('${p.id}',this.value)" style="font-size:13px;padding:8px 12px;"></div>`:''}`;
  });

  h+=`<div style="padding-top:10px;font-size:12px;color:var(--gray);">${absentCount} absent · ${players.length-absentCount} playing tonight</div>
    </div></div>`;

  panel.innerHTML=h;
  if(window._absPanelOpen){
    const body=$('abs-panel-body'),arrow=$('abs-panel-arrow');
    if(body)body.style.display='block';
    if(arrow)arrow.textContent='▴';
  }
}

function toggleAbsPanel(){
  const body=$('abs-panel-body'),arrow=$('abs-panel-arrow');
  if(!body)return;
  const open=body.style.display==='none';
  body.style.display=open?'block':'none';
  if(arrow)arrow.textContent=open?'▴':'▾';
  window._absPanelOpen=open;
}

function saveScoreSubName(pid, name){
  if(!liveWeek)return;
  const week=D[SIDE].weeks[liveWeek];if(!week)return;
  // Find the old ID this absent player's sub slot has in the current rounds
  const absences=getSessionAbsences();
  let counter=0;
  let oldId=null;
  for(const abPid of absences){
    const prev=(week.subs||[]).find(s=>s.forPlayerId===abPid);
    const prevName=prev&&prev.name?prev.name:'Sub '+(++counter);
    if(abPid===pid){oldId=prevName;break;}
  }
  // Compute new sub counter position for this player (for blank-name fallback)
  let counter2=0;
  let newId=null;
  for(const abPid of absences){
    const prev=(week.subs||[]).find(s=>s.forPlayerId===abPid);
    // In the new state, this player has no named sub if name is blank
    const willHaveName=abPid===pid?name.trim():prev&&prev.name;
    if(!willHaveName)counter2++;
    if(abPid===pid){newId=name.trim()||'Sub '+counter2;break;}
  }
  // Save subs list
  let subs=(week.subs||[]).filter(s=>s.forPlayerId!==pid);
  const trimmed=name.trim();
  if(trimmed) subs.push({name:trimmed,forPlayerId:pid});
  fbSet(SIDE+'/weeks/'+liveWeek+'/subs',subs.length?subs:null);
  // If a schedule exists and the ID changed, patch the rounds live
  if(newId&&week.rounds&&week.rounds.length){
    // Check if oldId exists in rounds; if not, fall back to '?' (legacy AI placeholder)
    const allSlots=week.rounds.flatMap(rd=>(rd.courts||[]).flatMap(ct=>[...(ct.t1||[]),...(ct.t2||[])]));
    const validRegistered=new Set(Object.values(D[SIDE].players||{}).filter(p=>p&&p.name).map(p=>p.id));
    const effectiveOld=allSlots.includes(oldId)?oldId
      :allSlots.find(id=>!validRegistered.has(id)&&id!==newId)||oldId;
    if(effectiveOld&&effectiveOld!==newId){
      const updatedRounds=week.rounds.map(rd=>({
        ...rd,
        courts:(rd.courts||[]).map(ct=>({
          ...ct,
          t1:(ct.t1||[]).map(id=>id===effectiveOld?newId:id),
          t2:(ct.t2||[]).map(id=>id===effectiveOld?newId:id)
        }))
      }));
      fbSet(SIDE+'/weeks/'+liveWeek+'/rounds',updatedRounds);
    }
  }
}

function toggleScoreAbsence(pid){
  if(!liveWeek)return;
  let absences=getSessionAbsences();
  const isAbs=absences.includes(pid);
  if(isAbs) absences=absences.filter(id=>id!==pid);
  else absences.push(pid);
  setSessionAbsences(absences);
  window._absPanelOpen=true;
  renderScoreAbsencePanel();
}

function lateArrival(pid){
  if(!liveWeek)return;
  const week=D[SIDE].weeks[liveWeek];if(!week)return;
  const p=gP(pid);if(!p)return;

  // Find unscored rounds
  const scoredRounds=new Set(
    Object.values(D[SIDE].results||{}).filter(r=>r.weekId===liveWeek).map(r=>r.round)
  );
  const unscoredRounds=(week.rounds||[]).filter(rd=>!scoredRounds.has(rd.round));
  if(!unscoredRounds.length){toast('No remaining rounds to add '+p.name+' to');return;}

  // Find their sub label so we can replace it in rounds
  const absences=getSessionAbsences();
  const abIdx=absences.indexOf(pid);
  const subLabel='Sub '+(abIdx+1);

  // Replace the sub slot in each unscored round
  let changed=0;
  unscoredRounds.forEach(rd=>{
    let updated=false;
    (rd.courts||[]).forEach(c=>{
      ['t1','t2'].forEach(team=>{
        const idx=c[team].indexOf(subLabel);
        if(idx===-1)return;
        c[team][idx]=pid;
        updated=true;
        changed++;
      });
    });
    if(updated) fbSet(SIDE+'/weeks/'+liveWeek+'/rounds',week.rounds);
  });

  // Remove from absences
  const newAbs=absences.filter(id=>id!==pid);
  setSessionAbsences(newAbs);
  window._absPanelOpen=true;
  toast(p.name+' added to '+unscoredRounds.length+' remaining round'+(unscoredRounds.length>1?'s':'')+'!');
  renderScoreAbsencePanel();
  renderRoundPills();
  renderLiveCourts();
}

function loadLive(){
  const wid=$('live-sel').value;
  liveWeek=wid;liveRound=1;
  renderScoreAbsencePanel();
  renderWeekActions();
  renderRoundPills();
  renderLiveCourts();
}

function renderWeekActions(){
  const acts=$('score-week-actions');if(!acts)return;
  const week=D[SIDE].weeks[liveWeek];
  if(!week){acts.style.display='none';return;}
  acts.style.display='block';
  if(week.cancelled){
    acts.innerHTML=`<div style="background:#fee2e2;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-family:'Bebas Neue';font-size:14px;letter-spacing:1px;color:var(--loss);margin-bottom:4px;">Night Cancelled</div><div style="font-size:13px;color:#b91c1c;margin-bottom:10px;">Season extended by 1 week.</div><button onclick="promptUncancelNight()" style="padding:8px 20px;background:#b91c1c;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Uncancel Night</button></div>`;
    return;
  }
  if(week.skipped){
    acts.innerHTML=`<div style="background:var(--gray-lighter);border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-family:'Bebas Neue';font-size:13px;letter-spacing:1px;color:var(--gray);">Scheduled Skip — No Play This Week</div></div>`;
    return;
  }
  const hasSchedule=week.rounds&&week.rounds.length>0;
  acts.innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    +`<button class="btn btn-sm cancel-btn" onclick="promptCancelNight()">🌧 Cancel Night</button>`
    +'</div>';
}

function renderRoundPills(){
  const week=D[SIDE].weeks[liveWeek];
  const rounds=week?week.rounds||[]:[];
  if(!rounds.length){$('round-pills').innerHTML='';return;}
  $('round-pills').innerHTML=rounds.map(rd=>{
    const done=isRoundDone(rd);
    return`<button class="rpill ${liveRound===rd.round?(done?'on done':'on'):(done?'done':'')}" onclick="pickRound(${rd.round})">R${rd.round}${done?' ✓':''}</button>`;
  }).join('');
}

function pickRound(r){liveRound=r;renderRoundPills();renderLiveCourts();}

function isRoundDone(rd){
  const res=Object.values(D[SIDE].results||{});
  const rRes=res.filter(r=>r.weekId===liveWeek&&r.round===rd.round);
  return rRes.length>=(rd.courts||[]).length&&(rd.courts||[]).length>0;
}

function renderLiveCourts(){
  const cont=$('live-courts');
  const week=D[SIDE].weeks[liveWeek];
  if(!week){cont.innerHTML=`<div class="empty"><div class="eico">📅</div><p class="etxt">Select a week to load tonight's games.</p></div>`;return;}
  const rounds=week.rounds||[];
  const rd=rounds.find(r=>r.round===liveRound);
  if(!rd){cont.innerHTML=`<div class="empty"><div class="eico">🤖</div><p class="etxt">No schedule for this week yet.<br>Go to Planner → Generate Tonight's Schedule.</p></div>`;return;}

  const cfg=D[SIDE].config||{};
  const results=Object.values(D[SIDE].results||{});

  // courtSubs: runtime overrides {courtIdx: {pid: subName}}
  if(!window._courtSubs) window._courtSubs = {};

  let h='';
  (rd.courts||[]).forEach((c,idx)=>{
    // Get overridden players for this court (sub swaps done on the score screen)
    const overrides = window._courtSubs[liveWeek+':'+liveRound+':'+idx] || {};

    // Build team arrays with any runtime sub overrides
    const resolveTeam = (team) => team.map(id => {
      const isRegistered=!!(D[SIDE].players||{})[id];
      const baseName=isRegistered?pN(id):id; // subs use their ID as display name
      return {
        id,
        displayName: overrides[id]==='__SUB__' ? baseName : (overrides[id] || baseName),
        isSub: !isRegistered||!!overrides[id]
      };
    });
    const t1r = resolveTeam(c.t1);
    const t2r = resolveTeam(c.t2);

    // Forfeit: both on a team have sub overrides OR are absent scheduled players
    const t1AllSubs = t1r.every(p => p.isSub);
    const t2AllSubs = t2r.every(p => p.isSub);
    const isForfeit = t1AllSubs || t2AllSubs;

    const teamHTML = (team) => team.map(p =>
      p.isSub
        ? `<span style="color:#92400e;font-style:italic;">${p.displayName}*</span>`
        : p.displayName
    ).join(' &amp; ');

    const t1html = teamHTML(t1r);
    const t2html = teamHTML(t2r);

    const existing = results.find(r=>r.weekId===liveWeek&&r.round===liveRound&&r.court===c.court);
    const cls = existing ? (existing.isForfeit ? 'forf' : 'done') : '';

    h += `<div class="scard ${cls}" id="sc-${idx}">`;
    h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-family:'Bebas Neue';font-size:11px;letter-spacing:2px;color:var(--primary);">Round ${rd.round} · Court ${c.court}</div>
      ${!existing ? `<button class="btn btn-g btn-sm" onclick="openSubSwap('${liveWeek}',${liveRound},${idx},'${c.t1.join(',')}','${c.t2.join(',')}')" style="font-size:11px;padding:7px 12px;">✏️ Edit Players</button>` : ''}
    </div>`;

    if(isForfeit && !existing){
      const winHTML = t1AllSubs ? t2html : t1html;
      h += `<div class="forf-banner">🚫 Forfeit — both players are subs.<br>${winHTML} wins 15–10</div>`;
      h += `<div class="matchup" style="margin-bottom:12px;"><div class="tname">${t1html}</div><div class="vs">vs</div><div class="tname right">${t2html}</div></div>`;
      h += `<button class="btn btn-a btn-w" onclick="saveForfeit('${liveWeek}',${liveRound},${c.court},'${c.t1.join(',')}','${c.t2.join(',')}',${t1AllSubs},${idx})">⚡ Record Forfeit (15–10)</button>`;
    } else if(existing){
      const w1 = existing.s1 > existing.s2;
      h += `<div class="done-result">
        <div class="done-name" style="color:${w1?'var(--win)':'var(--loss)'}">${t1html}</div>
        <div class="done-score" style="color:${w1?'var(--win)':'var(--loss)'}">${existing.s1}–${existing.s2}</div>
        <div class="done-name right" style="color:${!w1?'var(--win)':'var(--loss)'}">${t2html}</div>
      </div>`;
      h += `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
        <button class="btn btn-g btn-sm" onclick="openEditResult('${existing.id}')">✏️ Edit</button>
        <button class="btn btn-g btn-sm" onclick="delResult('${existing.id}')">✕ Clear</button>
      </div>`;
    } else {
      const us = lscore[idx]?.us||0, them = lscore[idx]?.them||0;
      h += `<div class="matchup" style="margin-bottom:12px;">
        <div class="tname">${t1html}</div><div class="vs">vs</div><div class="tname right">${t2html}</div>
      </div>`;
      h += `<div class="score-grid">
        <div class="scol">
          <div class="scol-lbl">Score</div>
          <button class="sbtn sbtn-p" onclick="adj(${idx},'us',1)">+</button>
          <input type="number" class="snum" id="su-${idx}" value="${us}" min="0" oninput="setS(${idx},'us',this.value)">
          <button class="sbtn sbtn-m" onclick="adj(${idx},'us',-1)">−</button>
        </div>
        <div class="sdash">—</div>
        <div class="scol">
          <div class="scol-lbl">Score</div>
          <button class="sbtn sbtn-p" onclick="adj(${idx},'them',1)">+</button>
          <input type="number" class="snum" id="st-${idx}" value="${them}" min="0" oninput="setS(${idx},'them',this.value)">
          <button class="sbtn sbtn-m" onclick="adj(${idx},'them',-1)">−</button>
        </div>
      </div>`;
      h += `<button class="btn btn-p btn-w" style="margin-top:12px;" onclick="saveScore('${liveWeek}',${liveRound},${c.court},'${c.t1.join(',')}','${c.t2.join(',')}',${idx})">✓ Save Set</button>`;
    }
    h += `</div>`;
  });

  if(rd.sitting&&rd.sitting.length){
    h += `<div class="card" style="opacity:.65;"><div style="font-size:14px;color:var(--gray);">Sitting out Round ${rd.round}: <strong>${rd.sitting.map(id=>pN(id)).join(', ')}</strong></div></div>`;
  }
  cont.innerHTML = h;
}

// ─── SUB SWAP MODAL ───
// Opens a sheet to replace any scheduled player on a court with a sub name
let _swapCtx = null;
function openSubSwap(weekId, round, idx, t1s, t2s){
  _swapCtx = {weekId, round, idx, t1:t1s.split(',').filter(Boolean), t2:t2s.split(',').filter(Boolean)};
  const overrides = window._courtSubs[weekId+':'+round+':'+idx] || {};
  const allPlayers = [..._swapCtx.t1, ..._swapCtx.t2];

  let h = `<div style="font-family:'Bebas Neue';font-size:12px;letter-spacing:1.5px;color:var(--gray);margin-bottom:14px;">Replace scheduled players with tonight's subs. Leave blank to keep original.</div>`;

  ['Team 1', 'Team 2'].forEach((label, ti) => {
    const team = ti===0 ? _swapCtx.t1 : _swapCtx.t2;
    h += `<div style="font-family:'Bebas Neue';font-size:13px;letter-spacing:1px;color:var(--primary);margin:12px 0 8px;">${label}</div>`;
    team.forEach(pid => {
      const current = overrides[pid] || '';
      const isSub = current === '__SUB__';
      const subName = isSub ? '' : current;
      h += `<div style="padding:10px 0;border-bottom:1px solid var(--sand-border);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="flex:1;">
            <div style="font-weight:700;font-size:14px;">${pN(pid)}</div>
            <div style="font-size:12px;color:var(--gray);">Scheduled player</div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;cursor:pointer;background:${isSub?'var(--primary)':'var(--gray-lighter)'};color:${isSub?'#fff':'var(--gray)'};padding:7px 12px;border-radius:8px;transition:.15s;">
            <input type="checkbox" id="issub-${pid}" ${isSub?'checked':''} onchange="toggleSubMode('${pid}')" style="display:none;">
            👤 Sub
          </label>
        </div>
        <div id="subname-row-${pid}" style="display:${isSub?'none':'block'};">
          <input class="inp" id="swap-${pid}" placeholder="Replace with sub name (optional)" value="${subName}" style="font-size:13px;padding:10px 12px;">
        </div>
      </div>`;
    });
  });

  h += `<div style="margin-top:6px;font-size:12px;color:var(--gray);">💡 If both players on a team are subs, a forfeit button appears automatically.</div>`;

  $('abs-body').innerHTML = h;
  $('abs-modal').querySelector('.mtitle span').textContent = 'Edit Players — Round '+round+' Court '+(idx+1);
  $('abs-modal').querySelector('.btn.btn-p.btn-w').textContent = 'Apply Changes';
  $('abs-modal').querySelector('.btn.btn-p.btn-w').onclick = applySubSwap;
  $('abs-modal').classList.add('on');
}

function toggleSubMode(pid){
  const cb=document.getElementById('issub-'+pid);
  const nameRow=document.getElementById('subname-row-'+pid);
  const lbl=cb?cb.closest('label'):null;
  if(!cb)return;
  if(cb.checked){
    // Mark as sub — hide name input, set hidden value
    if(nameRow)nameRow.style.display='none';
    // Store __SUB__ marker in a hidden field
    let hidden=document.getElementById('swap-'+pid);
    if(!hidden){hidden=document.createElement('input');hidden.id='swap-'+pid;hidden.type='hidden';nameRow.appendChild(hidden);}
    hidden.value='__SUB__';
    if(lbl){lbl.style.background='var(--primary)';lbl.style.color='#fff';}
  }else{
    if(nameRow)nameRow.style.display='block';
    const inp=document.getElementById('swap-'+pid);
    if(inp)inp.value='';
    if(lbl){lbl.style.background='var(--gray-lighter)';lbl.style.color='var(--gray)';}
  }
}

function applySubSwap(){
  if(!_swapCtx) return;
  const key = _swapCtx.weekId+':'+_swapCtx.round+':'+_swapCtx.idx;
  if(!window._courtSubs) window._courtSubs = {};
  const overrides = {};
  [..._swapCtx.t1, ..._swapCtx.t2].forEach(pid => {
    const inp = $('swap-'+pid);
    if(inp && inp.value.trim()) overrides[pid] = inp.value.trim();
  });
  window._courtSubs[key] = overrides;
  $('abs-modal').classList.remove('on');
  // Restore absence modal button for next use
  $('abs-modal').querySelector('.btn.btn-p.btn-w').textContent = 'Save';
  $('abs-modal').querySelector('.btn.btn-p.btn-w').onclick = saveAbsences;
  renderLiveCourts();
  toast('Players updated ✓');
}

function adj(idx,side,d){
  if(!lscore[idx])lscore[idx]={us:0,them:0};
  lscore[idx][side]=Math.max(0,(lscore[idx][side]||0)+d);
  const el=$(('su-'+idx===('su-'+idx)&&side==='us')?'su-'+idx:'st-'+idx);
  const el2=$(side==='us'?'su-'+idx:'st-'+idx);
  if(el2)el2.value=lscore[idx][side];
}

function setS(idx,side,v){if(!lscore[idx])lscore[idx]={us:0,them:0};lscore[idx][side]=Math.max(0,parseInt(v)||0);}

function ratingsSourceForSide(){ return SIDE==='queens' ? 'league_queens' : 'league_kings'; }
function namesForRatedTeam(team, subSlots){
  const ss = new Set(subSlots||[]);
  return (team||[])
    .filter(idOrName => !ss.has(idOrName))
    .map(idOrName => { const p = gP(idOrName); return p ? p.name : null; })
    .filter(Boolean);
}
function applyRatingsLeague(gameId, t1, t2, s1, s2, subSlots){
  if(!window.Ratings || !db) return;
  const team1Names = namesForRatedTeam(t1, subSlots);
  const team2Names = namesForRatedTeam(t2, subSlots);
  if(!team1Names.length || !team2Names.length) return;
  Ratings.applyGame({
    db, dbRoot:'tally_kotb_pickup',
    gameId, source: ratingsSourceForSide(),
    ts: Date.now(), team1Names, team2Names, s1, s2
  }).catch(err => console.warn('rating apply failed', err));
}
function reverseRatingsLeague(gameId, t1, t2, subSlots){
  if(!window.Ratings || !db) return;
  Ratings.reverseGame({
    db, dbRoot:'tally_kotb_pickup', gameId,
    team1Names: namesForRatedTeam(t1, subSlots),
    team2Names: namesForRatedTeam(t2, subSlots)
  }).catch(err => console.warn('rating reverse failed', err));
}

function saveScore(wid,round,court,t1s,t2s,idx){
  if(!_scoreGate()) return;
  const s1=parseInt($('su-'+idx)?.value)||0;
  const s2=parseInt($('st-'+idx)?.value)||0;
  if(s1===s2){toast('Scores cannot be tied');return;}
  const t1=t1s.split(',').filter(Boolean);
  const t2=t2s.split(',').filter(Boolean);
  const id=gi('r');
  const ov=(window._courtSubs&&window._courtSubs[wid+':'+round+':'+idx])||{};
  // For __SUB__ markers: keep original pid but record them in subSlots so stats skip them
  const applyOv=team=>team.map(pid=>ov[pid]&&ov[pid]!=='__SUB__'?ov[pid]:pid);
  const subSlots=[...t1,...t2].filter(pid=>ov[pid]==='__SUB__');
  // Named subs (non-registered): store name string directly
  const namedSubs=[...t1,...t2].filter(pid=>ov[pid]&&ov[pid]!=='__SUB__').map(pid=>ov[pid]);
  const t1Saved=applyOv(t1), t2Saved=applyOv(t2);
  fbSet(SIDE+'/results/'+id,{id,weekId:wid,round,court,t1:t1Saved,t2:t2Saved,s1,s2,isForfeit:false,subSlots:subSlots.length?subSlots:null,namedSubs:namedSubs.length?namedSubs:null,ts:Date.now()});
  applyRatingsLeague(id, t1Saved, t2Saved, s1, s2, subSlots);
  lscore[idx]={us:0,them:0};
  toast((s1>s2?'Win':'Loss')+' · '+s1+'–'+s2+' saved ✓');
  const _sy=window.scrollY;
  setTimeout(()=>{renderRoundPills();renderLiveCourts();window.scrollTo({top:_sy,behavior:'instant'});},400);
}

function saveForfeit(wid,round,court,t1s,t2s,t1forfeit,idx){
  if(!_scoreGate()) return;
  const t1=t1s.split(',').filter(Boolean);
  const t2=t2s.split(',').filter(Boolean);
  const id=gi('r');
  // Apply any sub name overrides to the stored teams
  const overrides=(window._courtSubs&&window._courtSubs[wid+':'+round+':'+(idx||0)])||{};
  const resolveIds=team=>team.map(pid=>overrides[pid]?overrides[pid]:pid);
  const st1=resolveIds(t1),st2=resolveIds(t2);
  const s1=t1forfeit?10:15, s2=t1forfeit?15:10;
  fbSet(SIDE+'/results/'+id,{id,weekId:wid,round,court,t1:st1,t2:st2,s1,s2,isForfeit:true,ts:Date.now()});
  applyRatingsLeague(id, st1, st2, s1, s2, null);
  toast('Forfeit recorded · 15-10');
  const _sf=window.scrollY;
  setTimeout(()=>{renderRoundPills();renderLiveCourts();window.scrollTo({top:_sf,behavior:'instant'});},400);
}

function openEditResult(id){
  if(!_scoreGate()) return;
  const r=((D[SIDE]||{}).results||{})[id];if(!r)return;
  window._editResultId=id;
  // Resolve display names: if value looks like a player ID, get name; else it's already a name
  const resolveName=v=>{const p=gP(v);return p?p.name:v;};
  const allP=Object.values(D[SIDE].players||{}).filter(p=>p&&p.name&&p.active!==false).sort((a,b)=>a.name.localeCompare(b.name));
  function pSelect(fid,val){
    const resolved=resolveName(val);
    let opts='<option value="">— sub / other —</option>'+allP.map(p=>`<option value="${p.id}" ${p.id===val||p.name===resolved?'selected':''}>${p.name}</option>`).join('');
    const isKnown=allP.some(p=>p.id===val||p.name===resolved);
    return `<div style="display:flex;flex-direction:column;gap:4px;flex:1;">
      <select class="inp" id="${fid}-sel" style="font-size:13px;padding:8px;" onchange="document.getElementById('${fid}-txt').style.display=this.value?'none':'block'">${opts}</select>
      <input class="inp" id="${fid}-txt" placeholder="Sub name" style="font-size:13px;padding:8px;display:${isKnown?'none':'block'};" value="${isKnown?'':resolved}">
    </div>`;
  }
  const body=$('edit-result-body');
  body.innerHTML=
    `<div style="display:flex;gap:10px;margin-bottom:14px;align-items:flex-end;">
      <div style="flex:1;"><label style="font-size:11px;font-weight:700;color:var(--gray);display:block;margin-bottom:4px;">COURT</label>
        <input class="inp" type="number" id="er-court" value="${r.court}" min="1" max="8" style="font-size:14px;padding:8px;width:100%;"></div>
      <div style="flex:1;"><label style="font-size:11px;font-weight:700;color:var(--gray);display:block;margin-bottom:4px;">ROUND</label>
        <input class="inp" type="number" id="er-round" value="${r.round}" min="1" max="20" style="font-size:14px;padding:8px;width:100%;"></div>
    </div>
    <div style="font-family:'Bebas Neue';font-size:12px;letter-spacing:1.5px;color:var(--primary);margin-bottom:8px;">TEAM 1</div>
    <div style="display:flex;gap:8px;margin-bottom:14px;">${pSelect('er-t1p1',r.t1[0]||'')}${pSelect('er-t1p2',r.t1[1]||'')}</div>
    <div style="font-family:'Bebas Neue';font-size:12px;letter-spacing:1.5px;color:var(--primary);margin-bottom:8px;">TEAM 2</div>
    <div style="display:flex;gap:8px;margin-bottom:14px;">${pSelect('er-t2p1',r.t2[0]||'')}${pSelect('er-t2p2',r.t2[1]||'')}</div>
    <div style="font-family:'Bebas Neue';font-size:12px;letter-spacing:1.5px;color:var(--primary);margin-bottom:8px;">SCORE</div>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:4px;">
      <input class="inp" type="number" id="er-s1" value="${r.s1}" min="0" style="font-size:20px;font-weight:700;padding:10px;text-align:center;flex:1;">
      <span style="font-family:'Bebas Neue';font-size:18px;color:var(--gray);">—</span>
      <input class="inp" type="number" id="er-s2" value="${r.s2}" min="0" style="font-size:20px;font-weight:700;padding:10px;text-align:center;flex:1;">
    </div>`;
  $('edit-result-modal').classList.add('on');
}

function saveEditResult(){
  const id=window._editResultId;if(!id)return;
  const r=((D[SIDE]||{}).results||{})[id];if(!r)return;
  const resolveSel=pre=>{
    const sel=$(`${pre}-sel`),txt=$(`${pre}-txt`);
    return sel&&sel.value?sel.value:(txt?txt.value.trim():'');
  };
  const court=parseInt($('er-court')?.value)||r.court;
  const round=parseInt($('er-round')?.value)||r.round;
  const t1=[resolveSel('er-t1p1'),resolveSel('er-t1p2')].filter(Boolean);
  const t2=[resolveSel('er-t2p1'),resolveSel('er-t2p2')].filter(Boolean);
  const s1=parseInt($('er-s1')?.value)||0;
  const s2=parseInt($('er-s2')?.value)||0;
  if(!t1.length||!t2.length){toast('Each team needs at least one player');return;}
  if(s1===s2){toast('Scores cannot be tied');return;}
  reverseRatingsLeague(id, r.t1||[], r.t2||[], r.subSlots||null);
  fbSet(SIDE+'/results/'+id,{...r,court,round,t1,t2,s1,s2,isForfeit:false});
  applyRatingsLeague(id, t1, t2, s1, s2, r.subSlots||null);
  $('edit-result-modal').classList.remove('on');
  toast('Result updated ✓');
  setTimeout(()=>{renderRoundPills();renderLiveCourts();},300);
}

function delResult(id){
  if(!_scoreGate()) return;
  const r=((D[SIDE]||{}).results||{})[id];
  if(r) reverseRatingsLeague(id, r.t1||[], r.t2||[], r.subSlots||null);
  fbDel(SIDE+'/results/'+id);
  toast('Result cleared');
  const _sd=window.scrollY;
  setTimeout(()=>{renderRoundPills();renderLiveCourts();window.scrollTo({top:_sd,behavior:'instant'});},400);
}

// ─── ROSTER IMPORT ───
function importRoster(input){
  const file = input.files[0];
  if(!file){return;}
  const preview = $('roster-import-preview');
  preview.innerHTML = '<div style="font-size:13px;color:var(--gray);padding:8px 0;">Reading file...</div>';

  const reader = new FileReader();
  reader.onload = function(e){
    try{
      if(typeof XLSX === 'undefined'){toast('Excel library not loaded');return;}
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

      // Build players[] from columns 0 (Name), 1 (Email), 2 (Phone). Skip blank rows + likely header row.
      const players = [];
      rows.forEach((row, i) => {
        const name  = String(row[0]||'').trim();
        if(!name) return;
        const isHeader = /^(name|player|first|full|#)/i.test(name) && i === 0;
        if(isHeader) return;
        const email = String(row[1]||'').trim();
        const phone = String(row[2]||'').trim();
        players.push({name, email, phone});
      });

      if(!players.length){
        preview.innerHTML = '<div style="color:var(--loss);font-size:13px;padding:8px;">No names found. Make sure names are in the first column.</div>';
        return;
      }

      // Validate emails: every player must have a non-empty, well-formed email. Phone is optional.
      const emailRe = /^\S+@\S+\.\S+$/;
      const invalid = players.filter(p => !p.email || !emailRe.test(p.email));
      if(invalid.length){
        const bad = invalid.map(p => p.name).join(', ');
        preview.innerHTML = `
          <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px;margin-top:8px;font-size:13px;color:#7f1d1d;">
            <div style="font-weight:700;margin-bottom:6px;">These players need a valid email before importing:</div>
            <div>${bad}</div>
            <div style="font-size:11px;margin-top:8px;">Fix the spreadsheet and choose the file again. Phone is optional.</div>
          </div>`;
        return;
      }

      // Preview with confirm button.
      preview.innerHTML = `
        <div style="background:var(--light);border-radius:10px;padding:12px;margin-top:8px;">
          <div style="font-family:'Bebas Neue';font-size:12px;letter-spacing:1px;color:var(--primary);margin-bottom:8px;">
            Found ${players.length} player${players.length!==1?'s':''} — review before importing:
          </div>
          <div style="max-height:200px;overflow-y:auto;margin-bottom:10px;">
            ${players.map((p,i)=>`<div style="padding:7px 0;border-bottom:1px solid var(--sand-border);font-size:14px;"><span style="font-weight:600;">${i+1}. ${p.name}</span> <span style="color:var(--gray);font-size:12px;">· ${p.email}${p.phone?' · '+p.phone:''}</span></div>`).join('')}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-p" style="flex:1;" onclick="confirmRosterImport(${JSON.stringify(players).replace(/"/g,'&quot;')})">
              ✓ Import All
            </button>
            <button class="btn btn-g" onclick="$('roster-import-preview').innerHTML='';$('roster-file').value='';">
              Cancel
            </button>
          </div>
          <div style="font-size:11px;color:var(--gray);margin-top:8px;">
            ⚠️ This adds to your existing roster — it won't delete players already there.
          </div>
        </div>`;
    }catch(err){
      console.error(err);
      preview.innerHTML = '<div style="color:var(--loss);font-size:13px;padding:8px;">Error reading file: '+err.message+'</div>';
    }
  };
  reader.readAsArrayBuffer(file);
  input.value = ''; // reset so same file can be re-selected
}

function confirmRosterImport(players){
  if(!players||!players.length)return;
  // Get existing player names to avoid exact duplicates
  const existing = new Set(
    Object.values(D[SIDE].players||{}).map(p=>p&&p.name?p.name.toLowerCase().trim():'')
  );
  let added = 0, skipped = 0;
  players.forEach(p=>{
    const name  = (p && p.name  ? String(p.name).trim()  : '');
    const email = (p && p.email ? String(p.email).trim() : '');
    const phone = (p && p.phone ? String(p.phone).trim() : '');
    if(!name)return;
    if(existing.has(name.toLowerCase())){skipped++;return;}
    const id = gi('p');
    fbSet(SIDE+'/players/'+id, {id, name, active:true, email, phone});
    added++;
  });
  $('roster-import-preview').innerHTML = `
    <div style="background:#dcfce7;border-radius:10px;padding:12px;margin-top:8px;font-size:14px;">
      ✅ Added <strong>${added}</strong> player${added!==1?'s':''}${skipped?` · Skipped ${skipped} duplicate${skipped!==1?'s':''}`:''}.
    </div>`;
  $('roster-file').value='';
  toast(added+' player'+(added!==1?'s':'')+' imported!');
}

// ─── EXCEL EXPORT ───
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded');return;}
  const wb = XLSX.utils.book_new();
  const side = SIDE;
  const sideName = side==='kings'?'Kings':'Queens';

  // ── Sheet 1: Standings ──
  const players = Object.values(D[side].players||{}).filter(p=>p&&p.name);
  const standRows = players.map(p=>{
    const s = calcStats(p.id);
    return {Player:p.name, GP:s.gp, W:s.w, L:s.l, 'Win%':s.pct, PF:s.pf, PA:s.pa, '+/-':s.diff};
  }).sort((a,b)=>b['+/-']-a['+/-']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(standRows), sideName+' Standings');

  // ── Sheet 2: All Results ──
  const results = Object.values(D[side].results||{}).sort((a,b)=>a.ts-b.ts);
  const resultRows = results.map(r=>{
    const week = D[side].weeks[r.weekId];
    const t1names = (r.t1||[]).map(id=>pN(id)).join(' & ');
    const t2names = (r.t2||[]).map(id=>pN(id)).join(' & ');
    const w1 = r.s1>r.s2;
    return {
      Week: week?('Week '+week.weekNum):(r.weekId||''),
      Date: week?week.date:'',
      Round: r.round,
      Court: r.court,
      'Team 1': t1names,
      'Score 1': r.s1,
      'Score 2': r.s2,
      'Team 2': t2names,
      Winner: w1?t1names:t2names,
      Forfeit: r.isForfeit?'Yes':'No'
    };
  });
  if(resultRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resultRows), sideName+' Results');

  // ── Sheet 3: Partner History ──
  const phRows = [];
  players.forEach(p=>{
    const ph = partnerHistory(p.id);
    Object.entries(ph).forEach(([partnerId,s])=>{
      phRows.push({
        Player: p.name,
        Partner: pN(partnerId),
        GP: s.gp, W: s.w, L: s.l,
        PF: s.pf, PA: s.pa, '+/-': s.pf-s.pa
      });
    });
  });
  if(phRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(phRows), sideName+' Partners');

  // ── Sheet 4: Weekly Schedule ──
  const schedRows = [];
  Object.values(D[side].weeks||{}).sort((a,b)=>a.weekNum-b.weekNum).forEach(week=>{
    (week.rounds||[]).forEach(rd=>{
      (rd.courts||[]).forEach(c=>{
        schedRows.push({
          Week: 'Week '+week.weekNum,
          Date: week.date,
          Round: rd.round,
          Court: c.court,
          'Team 1': (c.t1||[]).map(id=>pN(id)).join(' & '),
          'Team 2': (c.t2||[]).map(id=>pN(id)).join(' & '),
          'Sitting Out': (rd.sitting||[]).map(id=>pN(id)).join(', ')
        });
      });
    });
  });
  if(schedRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(schedRows), sideName+' Schedule');

  const today = td();
  XLSX.writeFile(wb, LC.exportPrefix+'_'+sideName+'_'+today+'.xlsx');
  toast('Exported! Check your Downloads ✓');
}

function downloadRosterTemplate(){
  if(typeof XLSX === 'undefined'){ toast('Excel library not loaded'); return; }
  var aoa = [
    ['Name', 'Email', 'Phone'],
    ['Alex Smith',  'alex@example.com',   '850-555-0101'],
    ['Jordan Lee',  'jordan@example.com', ''],
    ['Sam Rivera',  'sam@example.com',    '850-555-0103']
  ];
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roster');
  XLSX.writeFile(wb, 'KotB_Roster_Template.xlsx');
}

// ─── PIN SYSTEM ───
// --- PDF EXPORT (Schedule / Standings) - mirrors the 4v4 pattern ---
function _sideFullLabel(){ return SIDE==='kings' ? 'King of the Beach (Kings)' : 'Queen of the Beach (Queens)'; }
function _sideColor(){ return SIDE==='kings' ? [26,58,107] : [107,33,168]; }

function exportPdf(includeSchedule, includeStandings){
  const ns = window.jspdf;
  if(!ns || !ns.jsPDF){ toast('PDF library not loaded'); return; }
  const doc = new ns.jsPDF({unit:'pt', format:'letter'});
  if(typeof doc.autoTable !== 'function'){ toast('PDF table plugin missing'); return; }
  const sideName = SIDE==='kings' ? 'Kings' : 'Queens';
  const sideFull = _sideFullLabel();
  const col = _sideColor();
  const today = td();
  const generatedStr = new Date().toLocaleString();
  let kindParts = [];

  // Page 1 header
  doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.text(sideFull, 40, 50);
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.text('Generated: ' + generatedStr, 40, 66);
  let y = 84;

  if(includeSchedule){
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('Season Schedule', 40, y); y += 12;
    const weeks = Object.values(D[SIDE].weeks||{}).filter(w=>w && w.weekNum).sort((a,b)=>a.weekNum-b.weekNum);
    if(!weeks.length){
      doc.setFontSize(10); doc.setFont('helvetica','italic');
      doc.text('(no schedule generated yet)', 40, y+14); y += 30;
    } else {
      weeks.forEach(w=>{
        const rounds = Object.values(w.rounds||[]).filter(Boolean).sort((a,b)=>(a.round||0)-(b.round||0));
        let tag = '';
        if(w.skipped) tag = '  (skipped)';
        else if(w.cancelled) tag = '  (cancelled)';
        const weekHdr = 'Week ' + w.weekNum + (w.date ? '  -  ' + w.date : '') + tag;
        // Week header strip (colored)
        doc.autoTable({
          head: [[weekHdr]], body: [], startY: y, theme:'plain',
          headStyles:{fontSize:11, fontStyle:'bold', fillColor:col, textColor:[255,255,255]},
          margin:{left:40, right:40}, tableWidth:'auto'
        });
        y = doc.lastAutoTable.finalY + 4;
        // Build match rows for the night
        let body = [];
        if(!rounds.length){
          body = [['-','-','(no schedule generated for this week)','','']];
        } else {
          rounds.forEach(rd=>{
            const courts = Object.values(rd.courts||[]).filter(Boolean).sort((a,b)=>(a.court||0)-(b.court||0));
            const sitting = Object.values(rd.sitting||[]).map(id=>pN(id)).filter(Boolean).join(', ');
            if(!courts.length){
              body.push([rd.round||'', '-', '(no courts)', '', sitting]);
            } else {
              courts.forEach((c,ci)=>{
                body.push([
                  ci===0 ? (rd.round||'') : '',
                  c.court||'',
                  (c.t1||[]).map(id=>pN(id)).join(' & '),
                  (c.t2||[]).map(id=>pN(id)).join(' & '),
                  ci===0 ? sitting : ''
                ]);
              });
            }
          });
        }
        doc.autoTable({
          head: [['Round','Court','Team 1','Team 2','Sitting Out']],
          body: body, startY: y, theme:'striped',
          headStyles:{fontSize:10, fontStyle:'bold', fillColor:col, textColor:[255,255,255]},
          bodyStyles:{fontSize:9},
          margin:{left:40, right:40},
          columnStyles:{0:{halign:'center', cellWidth:46}, 1:{halign:'center', cellWidth:46}}
        });
        y = doc.lastAutoTable.finalY + 14;
      });
    }
    kindParts.push('Schedule');
  }

  if(includeStandings){
    if(includeSchedule) doc.addPage();
    let sy = 50;
    doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text(sideFull, 40, sy); sy += 16;
    doc.setFontSize(14);
    doc.text('Standings', 40, sy); sy += 12;
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.text('Generated: ' + generatedStr, 40, sy+4); sy += 22;

    const players = Object.values(D[SIDE].players||{}).filter(p=>p && p.name);
    const rows = players.map(p=>({name:p.name, s:calcStats(p.id)})).sort((a,b)=>b.s.diff-a.s.diff);
    if(!rows.length){
      doc.setFont('helvetica','italic');
      doc.text('(no players yet)', 40, sy);
    } else {
      const body = rows.map((r,i)=>[
        i+1, r.name, r.s.gp, r.s.w, r.s.l, r.s.pct, r.s.pf, r.s.pa,
        r.s.gp>0 ? pm(r.s.diff) : '-'
      ]);
      doc.autoTable({
        head: [['Rank','Player','GP','W','L','Win%','PF','PA','+/-']],
        body: body, startY: sy, theme:'striped',
        headStyles:{fontSize:10, fontStyle:'bold', fillColor:col, textColor:[255,255,255]},
        bodyStyles:{fontSize:9},
        margin:{left:40, right:40},
        columnStyles:{0:{halign:'center'},2:{halign:'center'},3:{halign:'center'},4:{halign:'center'},5:{halign:'center'},6:{halign:'center'},7:{halign:'center'},8:{halign:'center'}}
      });
    }
    kindParts.push('Standings');
  }

  if(!kindParts.length) return;
  const kind = kindParts.length===2 ? 'Full' : kindParts[0];
  doc.save(LC.exportPrefix + '_' + sideName + '_' + kind + '_' + today + '.pdf');
  toast('PDF exported! Check your Downloads.');
}

function runExportPdf(){
  const includeSchedule  = !!($('kotb-exp-schedule')  && $('kotb-exp-schedule').checked);
  const includeStandings = !!($('kotb-exp-standings') && $('kotb-exp-standings').checked);
  if(!includeSchedule && !includeStandings){ toast('Pick at least one section'); return; }
  exportPdf(includeSchedule, includeStandings);
}

let _pinEntry='',_pinAction=null;
let _scoreUnlocked=false;
function _scoreGate(){
  if(_scoreUnlocked) return true;
  _pinAction='score';_pinEntry='';updatePinDots();
  $('pin-error').textContent='';
  $('pin-modal-title').textContent='Admin PIN — Scoring';
  $('pin-modal').classList.add('on');
  return false;
}
function promptCancelNight(){_pinAction='cancel';_pinEntry='';updatePinDots();$('pin-error').textContent='';$('pin-modal-title').textContent='Admin PIN — Cancel Night';$('pin-modal').classList.add('on');}
function pinTap(v){
  if(v==='back')_pinEntry=_pinEntry.slice(0,-1);
  else if(v==='clear')_pinEntry='';
  else if(_pinEntry.length<4)_pinEntry+=v;
  updatePinDots();$('pin-error').textContent='';
  if(_pinEntry.length===4){
    if(_pinEntry===ADMIN_PIN){
      $('pin-modal').classList.remove('on');
      _pinEntry='';updatePinDots();
      if(_pinAction==='clearschedule'){ doClearSchedule(_editCourtCtx.wid); }
      else if(_pinAction==='genschedule') doGenScheduleAction();
      else if(_pinAction==='genseason') doGenSeasonAction();
      else if(_pinAction==='editcourt'){ openEditCourtModal(); }
      else if(_pinAction==='cancel') doCancelNight();
      else if(_pinAction==='uncancel') doUncancelNight();
      else if(_pinAction==='closeseason') doCloseSeason();
      else if(_pinAction==='addplayer') _doAddPlayer();
      else if(_pinAction==='planner') _openPlanner();
      else if(_pinAction==='score'){ _scoreUnlocked=true; toast('Scoring unlocked for this session'); }
    }else{
      $('pin-error').textContent='Incorrect PIN';
      setTimeout(()=>{_pinEntry='';updatePinDots();$('pin-error').textContent='';},700);
    }
  }
}
function _openPlanner(){
  const t=window._pendingTab;
  if(!t)return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.pane').forEach(x=>x.classList.remove('on'));
  t.classList.add('on');
  tab='planner';
  $('pane-planner').classList.add('on');
  refreshTab('planner');
  window._pendingTab=null;
}
function updatePinDots(){for(let i=0;i<4;i++){const d=$('pd'+i);if(d)d.classList.toggle('filled',i<_pinEntry.length);}}
function doCancelNight(){
  if(!liveWeek)return;
  if(!confirm('Are you sure? This will mark the night as cancelled and extend the season by one week. You can undo this with Uncancel Night.'))return;
  const allW=Object.values(D[SIDE].weeks||{}).sort((a,b)=>a.weekNum-b.weekNum);
  const last=allW[allW.length-1];
  let makeupId=null;
  if(last){
    const ld=new Date(last.date+'T12:00:00');ld.setDate(ld.getDate()+7);
    const ds=ld.getFullYear()+'-'+String(ld.getMonth()+1).padStart(2,'0')+'-'+String(ld.getDate()).padStart(2,'0');
    const nid='w'+(last.weekNum+1);
    makeupId=nid;
    fbSet(SIDE+'/weeks/'+nid,{id:nid,weekNum:last.weekNum+1,date:ds,absences:[],subs:null,rounds:null,skipped:false,cancelled:false});
  }
  fbSet(SIDE+'/weeks/'+liveWeek+'/cancelled',true);
  if(makeupId)fbSet(SIDE+'/weeks/'+liveWeek+'/cancelMakeupId',makeupId);
  toast('Night cancelled -- new week added.');
}

function promptUncancelNight(){_pinAction='uncancel';_pinEntry='';updatePinDots();$('pin-modal').style.display='flex';}

function doUncancelNight(){
  if(!liveWeek)return;
  const week=D[SIDE].weeks[liveWeek];
  if(!week||!week.cancelled)return;
  const makeupId=week.cancelMakeupId;
  fbDel(SIDE+'/weeks/'+liveWeek+'/cancelled');
  fbDel(SIDE+'/weeks/'+liveWeek+'/cancelMakeupId');
  if(makeupId)fbDel(SIDE+'/weeks/'+makeupId);
  toast('Night restored!');
}

document.addEventListener('DOMContentLoaded',()=>{
  initTabs();
  initFB();
});
