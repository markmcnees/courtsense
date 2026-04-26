/* Tally KotB shared identity + profile module
 *
 * Loaded by /kotb (league) and /kotb-pickup. Provides:
 *   - localStorage-backed "current player" identity
 *   - first-run / switch picker modal (search + pick from rated players, or type a new name)
 *   - profile modal (email, notification toggle, mute-until, switch)
 *
 * Storage: tally_kotb_pickup/players/{nameKey}/
 *   { name, email, notificationsEnabled, muteUntil, blocked, blockedReason, blockedAt, updatedAt }
 *
 * Depends on Ratings.nameKey if available (loaded from /ratings.js); falls back to a local impl.
 */
(function(global){
  if(global.Identity) return;

  const STORAGE_KEY = 'kotb_identity_v1';

  const STYLE = `
.idy-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;align-items:center;justify-content:center;padding:16px;font-family:'Barlow',sans-serif;}
.idy-overlay.on{display:flex;}
.idy-modal{background:#fff;border-radius:16px;padding:20px 18px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2);color:#111827;}
.idy-title{font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1.5px;color:#1a3a6b;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;}
.idy-close{background:none;border:none;font-size:22px;color:#6b7280;cursor:pointer;padding:6px 8px;}
.idy-row{display:flex;align-items:center;gap:10px;padding:11px 8px;border-bottom:1px solid #e5e7eb;cursor:pointer;}
.idy-row:hover{background:#f3f4f6;}
.idy-row .name{flex:1;font-weight:600;font-size:14px;}
.idy-row .meta{font-size:12px;color:#6b7280;}
.idy-input{width:100%;padding:11px 12px;border:1.5px solid #d1d5db;border-radius:10px;font-size:14px;font-family:'Barlow',sans-serif;color:#111827;background:#fff;}
.idy-input:focus{outline:none;border-color:#1a3a6b;}
.idy-input:disabled{background:#f3f4f6;color:#9ca3af;}
.idy-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 18px;border-radius:10px;border:none;font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1.2px;cursor:pointer;min-height:44px;}
.idy-btn-p{background:#1a3a6b;color:#fff;}
.idy-btn-p:active{filter:brightness(.9);}
.idy-btn-g{background:transparent;border:1.5px solid #d1d5db;color:#6b7280;}
.idy-btn-w{width:100%;}
.idy-btn:disabled{opacity:.5;cursor:not-allowed;}
.idy-lbl{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:5px;}
.idy-section{margin-bottom:14px;}
.idy-toggle{display:flex;align-items:center;gap:10px;padding:6px 0;}
.idy-toggle input{width:18px;height:18px;}
.idy-toggle label{font-size:14px;font-weight:600;cursor:pointer;}
.idy-msg{font-size:12px;color:#6b7280;margin-top:6px;line-height:1.45;}
.idy-blocked{background:#fee2e2;color:#7f1d1d;border:1px solid #fca5a5;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:14px;line-height:1.45;}
.idy-list-wrap{max-height:320px;overflow-y:auto;border-top:1px solid #e5e7eb;border-radius:0;}
.idy-empty{padding:14px;color:#6b7280;text-align:center;font-size:13px;}
`;

  function injectStyle(){
    if(document.getElementById('idy-style')) return;
    const s = document.createElement('style');
    s.id = 'idy-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function nameKey(n){
    if(global.Ratings && global.Ratings.nameKey) return global.Ratings.nameKey(n);
    return String(n||'').toLowerCase().trim().replace(/[.#$/[\]]/g,'').replace(/\s+/g,'_');
  }

  function escHTML(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function getCurrent(){
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v ? JSON.parse(v) : null;
    } catch(e){ return null; }
  }
  function setCurrent(name){
    const trimmed = String(name||'').trim();
    if(!trimmed) return null;
    const obj = { name: trimmed, key: nameKey(trimmed), setAt: Date.now() };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch(e){}
    return obj;
  }
  function clearCurrent(){
    try { localStorage.removeItem(STORAGE_KEY); } catch(e){}
  }

  function showOverlay(html, opts){
    injectStyle();
    const overlay = document.createElement('div');
    overlay.className = 'idy-overlay on';
    overlay.innerHTML = `<div class="idy-modal">${html}</div>`;
    overlay.addEventListener('click', e => {
      if(e.target===overlay && (!opts || opts.dismissable!==false)) close();
    });
    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    document.body.appendChild(overlay);
    return { overlay, close };
  }

  // Pick or switch identity. Returns Promise<{name,key} | null>.
  // db: Firebase DB ref (used to read tally_kotb_pickup/ratings for suggestions). Optional.
  // dismissable: true if user can close without picking (default true).
  function openPicker(opts){
    opts = opts || {};
    const dismissable = opts.dismissable !== false;
    return new Promise(resolve => {
      let names = [];
      function builder(ratings){
        names = Object.values(ratings||{})
          .filter(r => r && r.name)
          .map(r => ({ name: r.name, rating: r.rating ?? 1500, gp: r.gamesPlayed||0 }))
          .sort((a,b) => a.name.localeCompare(b.name));
        render('');
      }
      if(opts.db){
        opts.db.ref('tally_kotb_pickup/ratings').once('value')
          .then(s => builder(s.val()||{}))
          .catch(() => builder({}));
      } else {
        builder({});
      }

      let modalCtl = null;
      let resolved = false;

      function render(filter){
        const f = (filter||'').toLowerCase().trim();
        const list = names.filter(n => !f || n.name.toLowerCase().includes(f));
        const html = `
          <div class="idy-title"><span>${opts.title || "Who are you?"}</span>${dismissable?'<button class="idy-close" id="idy-pick-close">✕</button>':''}</div>
          <p class="idy-msg" style="margin-bottom:12px;">Pick your name from the list or type a new one. This stays on this device.</p>
          <input class="idy-input" id="idy-search" placeholder="Search or type a new name..." style="margin-bottom:10px;" value="${escHTML(filter||'')}">
          <div class="idy-list-wrap" id="idy-list">
            ${list.length ? list.map(n=>`
              <div class="idy-row" data-name="${escHTML(n.name)}">
                <div class="name">${escHTML(n.name)}</div>
                <div class="meta">${Math.round(n.rating)} rating, ${n.gp} GP</div>
              </div>`).join('') : '<div class="idy-empty">No matches.</div>'}
          </div>
          <button class="idy-btn idy-btn-p idy-btn-w" id="idy-add" style="margin-top:12px;">${f ? 'Use "'+escHTML(f)+'"' : 'Add as new player'}</button>
        `;
        if(modalCtl){
          modalCtl.overlay.querySelector('.idy-modal').innerHTML = html;
        } else {
          modalCtl = showOverlay(html, { dismissable });
        }
        wire();
        const inp = modalCtl.overlay.querySelector('#idy-search');
        if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      }

      function wire(){
        const search = modalCtl.overlay.querySelector('#idy-search');
        const addBtn = modalCtl.overlay.querySelector('#idy-add');
        const closeBtn = modalCtl.overlay.querySelector('#idy-pick-close');
        if(search) search.addEventListener('input', () => render(search.value));
        if(addBtn) addBtn.addEventListener('click', () => {
          const v = (search && search.value || '').trim();
          if(!v){ if(search) search.focus(); return; }
          finalize(v);
        });
        if(closeBtn) closeBtn.addEventListener('click', () => {
          if(resolved) return;
          resolved = true; modalCtl.close(); resolve(null);
        });
        modalCtl.overlay.querySelectorAll('.idy-row').forEach(r => {
          r.addEventListener('click', () => finalize(r.dataset.name));
        });
        if(search){
          search.addEventListener('keydown', e=>{
            if(e.key==='Enter'){
              const list = modalCtl.overlay.querySelectorAll('.idy-row');
              if(list.length){ finalize(list[0].dataset.name); return; }
              const v = search.value.trim(); if(v) finalize(v);
            }
          });
        }
      }

      function finalize(name){
        if(resolved) return;
        resolved = true;
        const id = setCurrent(name);
        modalCtl.close();
        resolve(id);
      }
    });
  }

  // Open profile editor for the current identity. If no identity yet,
  // prompts picker first.
  async function openProfile(opts){
    opts = opts || {};
    const db = opts.db || null;
    let identity = getCurrent();
    if(!identity){
      identity = await openPicker({ db, dismissable: true });
      if(!identity) return;
    }

    let profile = {};
    let rating = null;
    if(db){
      try {
        const snap = await db.ref('tally_kotb_pickup/players/'+identity.key).once('value');
        profile = snap.val() || {};
      } catch(e){ console.warn('profile read failed', e); }
      try {
        const rSnap = await db.ref('tally_kotb_pickup/ratings/'+identity.key).once('value');
        rating = rSnap.val();
      } catch(e){}
    }

    const isBlocked = !!profile.blocked;
    const muted = profile.muteUntil && profile.muteUntil > Date.now();
    const muteISO = profile.muteUntil ? new Date(profile.muteUntil).toISOString().slice(0,10) : '';

    const html = `
      <div class="idy-title"><span>My Profile</span><button class="idy-close" id="idy-pclose">✕</button></div>
      <div class="idy-section" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;line-height:1.1;">${escHTML(identity.name)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">${rating ? Math.round(rating.rating)+' rating, '+(rating.gamesPlayed||0)+' games' : 'No rating yet'}</div>
        </div>
        <button class="idy-btn idy-btn-g" id="idy-switch">Switch</button>
      </div>
      ${isBlocked ? `<div class="idy-blocked"><strong>Account blocked.</strong>${profile.blockedReason ? ' '+escHTML(profile.blockedReason)+'.' : ''} Contact the admin to update.</div>` : ''}
      <div class="idy-section">
        <label class="idy-lbl" for="idy-email">Email for invites</label>
        <input class="idy-input" id="idy-email" type="email" placeholder="you@example.com" value="${escHTML(profile.email||'')}" ${isBlocked?'disabled':''}>
        <div class="idy-msg">${isBlocked ? 'Email is locked while your account is blocked.' : 'Used for pickup invites and 24-hour reminders. Only the admin can see this.'}</div>
      </div>
      <div class="idy-section">
        <div class="idy-toggle">
          <input type="checkbox" id="idy-notif" ${profile.notificationsEnabled!==false?'checked':''} ${isBlocked?'disabled':''}>
          <label for="idy-notif">Send me invites</label>
        </div>
      </div>
      <div class="idy-section">
        <label class="idy-lbl" for="idy-mute">Mute notifications until</label>
        <input class="idy-input" id="idy-mute" type="date" value="${muteISO}" ${isBlocked?'disabled':''}>
        <div class="idy-msg">${muted ? 'Currently muted until '+new Date(profile.muteUntil).toLocaleDateString() : 'Leave blank to keep notifications on.'}</div>
      </div>
      <button class="idy-btn idy-btn-p idy-btn-w" id="idy-save" ${isBlocked?'disabled':''}>Save Profile</button>
      <button class="idy-btn idy-btn-g idy-btn-w" id="idy-cancel" style="margin-top:8px;">Close</button>
    `;

    const ctl = showOverlay(html);
    ctl.overlay.querySelector('#idy-pclose').onclick = ctl.close;
    ctl.overlay.querySelector('#idy-cancel').onclick = ctl.close;
    ctl.overlay.querySelector('#idy-switch').onclick = async () => {
      ctl.close();
      const newId = await openPicker({ db, dismissable: true });
      if(newId) openProfile(opts);
    };

    if(!isBlocked){
      ctl.overlay.querySelector('#idy-save').onclick = async () => {
        const email = ctl.overlay.querySelector('#idy-email').value.trim();
        if(email && !/^\S+@\S+\.\S+$/.test(email)){
          alert('That email looks off. Try again.');
          return;
        }
        const notif = ctl.overlay.querySelector('#idy-notif').checked;
        const muteVal = ctl.overlay.querySelector('#idy-mute').value;
        const muteUntil = muteVal ? new Date(muteVal+'T23:59:59').getTime() : null;
        const updates = {
          name: identity.name,
          email: email || null,
          notificationsEnabled: !!notif,
          muteUntil: muteUntil,
          updatedAt: Date.now()
        };
        if(db){
          try {
            await db.ref('tally_kotb_pickup/players/'+identity.key).update(updates);
          } catch(e){
            console.error(e);
            alert("Couldn't save profile, try again.");
            return;
          }
        }
        ctl.close();
      };
    }
  }

  global.Identity = {
    getCurrent, setCurrent, clear: clearCurrent,
    openPicker, openProfile,
    nameKey
  };
})(typeof window !== 'undefined' ? window : globalThis);
