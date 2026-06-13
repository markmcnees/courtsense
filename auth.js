/* CourtSense shared auth module
 *
 * Email + password sign-in for the pickup app. Coach actions on CourtSense
 * happen via admin-players.html, which is separately PIN-gated.
 *
 * Pattern:
 *   CourtSenseAuth.init({ firebaseDb, rosterPath, onLogin, onLogout })
 *   CourtSenseAuth.showLogin() / hideLogin() / currentPlayer()
 *   CourtSenseAuth.logout()
 *   CourtSenseAuth.changePassword(oldPw, newPw) -> Promise<{ok:true} | {ok:false, code}>
 *     codes: 'wrong_password' | 'no_account' | 'same_password' | 'failed'
 *     On ok:true the player's passwordHash + updatedAt are written and a
 *     'password_changed' row is queued in tally_kotb_pickup/email_queue.
 *   CourtSenseAuth.createPlayer({ email, password, displayName, city, skillLevel, keepSignedIn })
 *     -> Promise<{ok:true, playerKey} | {ok:false, error}>
 *     Self-serve community signup. Writes verified:false player record at
 *     {rosterPath}/{snake_case_displayName}, queues a 'welcome' email with
 *     generated_password:null (user picked their own), and signs the new
 *     player in immediately. keepSignedIn (default false) controls whether
 *     the session persists across browser close. Phase D will add email
 *     verification gating against the verified flag.
 *
 * Storage: passwordHash lives at {rosterPath}/{playerId}/passwordHash.
 * Hashing happens here (cost 10) at signup time and at admin-players.html
 * approval time. Verifying happens here at login time. Plaintext is never
 * persisted; it only lives in the welcome email payload.
 *
 * Session: a single key 'courtsenseAuth' = { playerId, ts[, exp] }. Lives
 * in sessionStorage by default (clears on browser close). When "Keep me
 * signed in on this device" is checked at login or signup, lives in
 * localStorage with exp = now + 75 days instead. autoLogin prefers
 * localStorage, then falls back to sessionStorage; expired localStorage
 * entries are dropped. Logout clears both stores.
 *
 * No password reset email flow in v1: admin resets via admin-players.html
 * and texts the new plaintext to the player.
 */
(function(global){
  if(global.CourtSenseAuth) return;

  const SS_KEY = 'courtsenseAuth';
  const BCRYPT_URL = 'https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/dist/bcrypt.min.js';
  const LOGO_URL = '/logo.png';
  const ADMIN_MAIL = 'mailto:mark@markmcnees.com';
  // Cloudflare worker that verifies passwords server-side, so the client never
  // reads passwordHash from the roster. See courtsense-email-worker /auth/verify.
  const AUTH_WORKER = 'https://courtsense-email-worker.markmcnees-479.workers.dev';

  let _db = null;
  let _rosterPath = '';
  let _onLogin = null;
  let _onLogout = null;
  let _currentPlayer = null;
  let _initialized = false;
  let _overlayBuilt = false;

  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // League auto-link helper. On createPlayer, scan the Tally KotB kings + queens
  // rosters for a case-insensitive trimmed name match on the new signup's
  // displayName. Returns { side, playerId } on match, null on no match or read
  // failure. Hardcoded to the Tally KotB league for Phase A.5; multi-tenant
  // matching via window.LEAGUE_CONFIG.dbRoot is deferred to a later phase.
  async function findLeagueMatch(name){
    const target = String(name == null ? '' : name).trim().toLowerCase();
    if(!target) return null;
    const sides = ['kings', 'queens'];
    for(let i = 0; i < sides.length; i++){
      const side = sides[i];
      try {
        const snap = await _db.ref('tally_kotb/' + side + '/players').once('value');
        const players = snap.val() || {};
        for(const pid in players){
          const p = players[pid] || {};
          const pname = String(p.name == null ? '' : p.name).trim().toLowerCase();
          if(pname && pname === target){
            return { side: side, playerId: pid };
          }
        }
      } catch(e){
        console.warn('CourtSenseAuth.createPlayer: league lookup failed for ' + side, e);
      }
    }
    return null;
  }

  // bcryptjs is loaded lazily (login screens are rare; no need to ship it eagerly).
  let _bcryptPromise = null;
  function loadBcrypt(){
    if(_bcryptPromise) return _bcryptPromise;
    _bcryptPromise = new Promise((resolve, reject) => {
      const existing = (global.dcodeIO && global.dcodeIO.bcrypt) || global.bcrypt;
      if(existing) return resolve(existing);
      const s = document.createElement('script');
      s.src = BCRYPT_URL;
      s.onload = () => {
        const lib = (global.dcodeIO && global.dcodeIO.bcrypt) || global.bcrypt;
        lib ? resolve(lib) : reject(new Error('bcrypt loaded but global missing'));
      };
      s.onerror = () => reject(new Error('Failed to load bcryptjs'));
      document.head.appendChild(s);
    });
    return _bcryptPromise;
  }

  const STYLE = `
.cs-auth-overlay{display:none;position:fixed;inset:0;background:linear-gradient(150deg,#0f2347 0%,#1a3a6b 100%);z-index:9500;align-items:flex-start;justify-content:center;padding:48px 16px 16px;overflow-y:auto;font-family:'Barlow',sans-serif;color:#111827;}
.cs-auth-overlay.on{display:flex;}
.cs-auth-box{background:#fff;border-radius:18px;padding:28px 22px 22px;width:100%;max-width:420px;box-shadow:0 12px 40px rgba(0,0,0,.35);}
.cs-auth-logo{display:block;width:100%;max-width:240px;height:auto;margin:0 auto 6px;}
.cs-auth-sub{text-align:center;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1.5px;color:#1a3a6b;margin-bottom:18px;}
.cs-auth-view{display:none;}
.cs-auth-view.on{display:block;}
.cs-auth-input{width:100%;padding:13px 12px;border:1.5px solid #d1d5db;border-radius:10px;font-family:'Barlow',sans-serif;font-size:15px;color:#111827;background:#fff;margin-bottom:10px;min-height:48px;}
.cs-auth-input:focus{outline:none;border-color:#1a3a6b;}
.cs-auth-keep{display:flex;align-items:center;gap:8px;font-size:14px;color:#374151;margin:2px 2px 14px;cursor:pointer;user-select:none;}
.cs-auth-keep input{width:18px;height:18px;cursor:pointer;}
.cs-auth-err{color:#dc2626;font-size:13px;font-weight:600;min-height:18px;margin:2px 2px 8px;}
.cs-auth-btn{display:block;width:100%;padding:14px 18px;border-radius:10px;border:none;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1.5px;cursor:pointer;background:#1a3a6b;color:#fff;min-height:50px;}
.cs-auth-btn:active{filter:brightness(.9);}
.cs-auth-btn:disabled{opacity:.5;cursor:not-allowed;}
.cs-auth-toggle{display:block;width:100%;text-align:center;background:none;border:none;color:#1a3a6b;font-family:'Barlow',sans-serif;font-size:14px;font-weight:600;padding:12px 8px 4px;cursor:pointer;}
.cs-auth-toggle:hover{text-decoration:underline;}
.cs-auth-foot{text-align:center;font-size:12px;color:#6b7280;margin-top:14px;line-height:1.5;}
.cs-auth-foot a{color:#1a3a6b;text-decoration:none;font-weight:600;}
.cs-auth-foot a:hover{text-decoration:underline;}
`;

  function injectStyle(){
    if(document.getElementById('cs-auth-style')) return;
    const s = document.createElement('style');
    s.id = 'cs-auth-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function buildOverlay(){
    if(_overlayBuilt) return;
    injectStyle();
    const overlay = document.createElement('div');
    overlay.className = 'cs-auth-overlay';
    overlay.id = 'cs-auth-overlay';
    overlay.innerHTML = `
      <div class="cs-auth-box">
        <img src="${LOGO_URL}" alt="CourtSense" class="cs-auth-logo" onerror="this.style.display='none'">
        <div class="cs-auth-sub">2026 Beach Volleyball Season</div>

        <div class="cs-auth-view on" id="cs-auth-view-login">
          <input type="email" class="cs-auth-input" id="cs-auth-email" placeholder="Email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false">
          <input type="password" class="cs-auth-input" id="cs-auth-pw" placeholder="Password" autocomplete="current-password">
          <label class="cs-auth-keep"><input type="checkbox" id="cs-auth-keep" checked> Keep me signed in on this device</label>
          <div class="cs-auth-err" id="cs-auth-err"></div>
          <button class="cs-auth-btn" id="cs-auth-go">Log In</button>
          <button type="button" class="cs-auth-toggle" id="cs-auth-show-register">New here? Create an account</button>
          <div class="cs-auth-foot">Forgot password? <a href="${ADMIN_MAIL}">Contact admin.</a></div>
        </div>

        <div class="cs-auth-view" id="cs-auth-view-register">
          <input type="email" class="cs-auth-input" id="cs-auth-reg-email" placeholder="Email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false">
          <input type="password" class="cs-auth-input" id="cs-auth-reg-pw" placeholder="Password (at least 8 characters)" autocomplete="new-password">
          <input type="password" class="cs-auth-input" id="cs-auth-reg-pw2" placeholder="Confirm password" autocomplete="new-password">
          <input type="text" class="cs-auth-input" id="cs-auth-reg-name" placeholder="Display name" autocomplete="nickname" maxlength="40">
          <label class="cs-auth-keep"><input type="checkbox" id="cs-auth-reg-keep" checked> Keep me signed in on this device</label>
          <div class="cs-auth-err" id="cs-auth-reg-err"></div>
          <button class="cs-auth-btn" id="cs-auth-reg-go">Create account</button>
          <button type="button" class="cs-auth-toggle" id="cs-auth-show-login">Already have an account? Sign in</button>
          <div class="cs-auth-foot">Forgot password? <a href="${ADMIN_MAIL}">Contact admin.</a></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Login view wiring
    overlay.querySelector('#cs-auth-go').addEventListener('click', handleLoginClick);
    overlay.querySelector('#cs-auth-email').addEventListener('keydown', e => {
      if(e.key === 'Enter') handleLoginClick();
    });
    overlay.querySelector('#cs-auth-pw').addEventListener('keydown', e => {
      if(e.key === 'Enter') handleLoginClick();
    });
    overlay.querySelector('#cs-auth-show-register').addEventListener('click', () => showView('register'));

    // Register view wiring
    overlay.querySelector('#cs-auth-reg-go').addEventListener('click', handleRegisterClick);
    ['#cs-auth-reg-email','#cs-auth-reg-pw','#cs-auth-reg-pw2','#cs-auth-reg-name'].forEach(sel => {
      overlay.querySelector(sel).addEventListener('keydown', e => {
        if(e.key === 'Enter') handleRegisterClick();
      });
    });
    overlay.querySelector('#cs-auth-show-login').addEventListener('click', () => showView('login'));

    _overlayBuilt = true;
  }

  function showView(which){
    const lv = document.getElementById('cs-auth-view-login');
    const rv = document.getElementById('cs-auth-view-register');
    if(!lv || !rv) return;
    if(which === 'register'){
      lv.classList.remove('on');
      rv.classList.add('on');
      const f = document.getElementById('cs-auth-reg-email');
      if(f) setTimeout(() => { try { f.focus(); } catch(e){} }, 0);
    } else {
      rv.classList.remove('on');
      lv.classList.add('on');
      const f = document.getElementById('cs-auth-email');
      if(f) setTimeout(() => { try { f.focus(); } catch(e){} }, 0);
    }
  }

  function lastNameOf(p){
    if(p && p.lastName) return String(p.lastName);
    const n = String((p && p.name) || '').trim();
    if(!n) return '';
    const parts = n.split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : n;
  }
  function displayNameOf(p, key){
    if(p && p.firstName && p.lastName) return p.firstName + ' ' + p.lastName;
    if(p && p.name) return p.name;
    return key;
  }

  async function attemptLogin(email, password){
    if(!email) return { success: false, error: 'Enter your email' };
    if(!password) return { success: false, error: 'Enter your password' };

    // Password verification happens server-side in the worker so the client never
    // reads passwordHash. The worker returns { ok:true, player } (player.id set,
    // passwordHash stripped) or { ok:false, code, error } with a generic message.
    let res;
    try {
      const r = await fetch(AUTH_WORKER + '/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rosterPath: _rosterPath,
          email: String(email).trim().toLowerCase(),
          password: password
        })
      });
      res = await r.json();
    } catch(e) {
      console.error('CourtSenseAuth verify failed', e);
      return { success: false, error: 'Network error. Try again.' };
    }

    if(!res || res.ok !== true){
      return { success: false, error: (res && res.error) || 'Login failed' };
    }

    _currentPlayer = res.player;
    return { success: true, player: _currentPlayer, playerId: res.player.id };
  }

  async function handleLoginClick(){
    const emailEl = document.getElementById('cs-auth-email');
    const pwEl    = document.getElementById('cs-auth-pw');
    const keepEl  = document.getElementById('cs-auth-keep');
    const errEl   = document.getElementById('cs-auth-err');
    const btnEl   = document.getElementById('cs-auth-go');
    if(!emailEl || !pwEl || !errEl || !btnEl) return;
    errEl.textContent = '';
    btnEl.disabled = true;
    btnEl.textContent = 'Logging in...';
    try {
      const res = await attemptLogin(emailEl.value, pwEl.value);
      if(!res.success){
        errEl.textContent = res.error || 'Login failed';
        return;
      }
      persistSession(res.playerId, !!(keepEl && keepEl.checked));
      pwEl.value = '';
      hideLogin();
      if(typeof _onLogin === 'function') _onLogin(res.player);
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = 'Log In';
    }
  }

  async function handleRegisterClick(){
    const emailEl = document.getElementById('cs-auth-reg-email');
    const pwEl    = document.getElementById('cs-auth-reg-pw');
    const pw2El   = document.getElementById('cs-auth-reg-pw2');
    const nameEl  = document.getElementById('cs-auth-reg-name');
    const keepEl  = document.getElementById('cs-auth-reg-keep');
    const errEl   = document.getElementById('cs-auth-reg-err');
    const btnEl   = document.getElementById('cs-auth-reg-go');
    if(!emailEl || !pwEl || !nameEl || !errEl || !btnEl) return;
    errEl.textContent = '';
    if(pw2El && pwEl.value !== pw2El.value){
      errEl.textContent = 'Passwords do not match';
      return;
    }
    btnEl.disabled = true;
    btnEl.textContent = 'Creating account...';
    try {
      // City and skillLevel are required by createPlayer's validators; the minimal
      // signup form doesn't ask for them, so pass sensible placeholders that pass
      // validation. A profile screen can let players edit these later.
      const res = await createPlayer({
        email: emailEl.value,
        password: pwEl.value,
        displayName: nameEl.value,
        city: 'Not set',
        skillLevel: 'Recreational',
        keepSignedIn: !!(keepEl && keepEl.checked)
      });
      if(!res.ok){
        errEl.textContent = res.error || 'Could not create account';
        return;
      }
      // createPlayer wrote the session and fired onLogin; just close the overlay.
      pwEl.value = '';
      if(pw2El) pw2El.value = '';
      nameEl.value = '';
      hideLogin();
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = 'Create account';
    }
  }

  // Remember-me: localStorage with exp (75 days). Default: sessionStorage,
  // which clears on browser close. Writing one always clears the other so
  // there is exactly one source of truth for the active session.
  function persistSession(playerId, keepSignedIn){
    const now = Date.now();
    if(keepSignedIn){
      const exp = now + 75 * 24 * 60 * 60 * 1000;
      try { localStorage.setItem(SS_KEY, JSON.stringify({ playerId, ts: now, exp })); } catch(e){}
      try { sessionStorage.removeItem(SS_KEY); } catch(e){}
    } else {
      try { sessionStorage.setItem(SS_KEY, JSON.stringify({ playerId, ts: now })); } catch(e){}
      try { localStorage.removeItem(SS_KEY); } catch(e){}
    }
  }

  async function autoLogin(){
    // Prefer localStorage (keep-signed-in) over sessionStorage. Expired
    // localStorage entries are dropped and we fall through to sessionStorage.
    let parsed = null;
    try {
      const raw = localStorage.getItem(SS_KEY);
      if(raw){
        const p = JSON.parse(raw);
        if(p && p.playerId){
          if(typeof p.exp === 'number' && p.exp <= Date.now()){
            try { localStorage.removeItem(SS_KEY); } catch(e){}
          } else {
            parsed = p;
          }
        }
      }
    } catch(e){ /* fall through */ }
    if(!parsed){
      try {
        const raw = sessionStorage.getItem(SS_KEY);
        if(raw) parsed = JSON.parse(raw);
      } catch(e){ return null; }
    }
    if(!parsed || !parsed.playerId) return null;
    try {
      const snap = await _db.ref(_rosterPath + '/' + parsed.playerId).once('value');
      const player = snap.val();
      if(!player || player.blocked){
        try { localStorage.removeItem(SS_KEY); } catch(e){}
        try { sessionStorage.removeItem(SS_KEY); } catch(e){}
        return null;
      }
      _currentPlayer = Object.assign({ id: parsed.playerId }, player);
      delete _currentPlayer.passwordHash;
      return _currentPlayer;
    } catch(e) {
      console.warn('CourtSenseAuth autoLogin read failed', e);
      return null;
    }
  }

  function showLogin(){
    if(!_overlayBuilt) buildOverlay();
    const overlay = document.getElementById('cs-auth-overlay');
    if(overlay) overlay.classList.add('on');
    // Always open in the login view; clear inputs and errors on both views.
    showView('login');
    ['cs-auth-err','cs-auth-reg-err'].forEach(id => {
      const el = document.getElementById(id); if(el) el.textContent = '';
    });
    const pw  = document.getElementById('cs-auth-pw');      if(pw)  pw.value = '';
    const rpw = document.getElementById('cs-auth-reg-pw');  if(rpw) rpw.value = '';
    const rpw2 = document.getElementById('cs-auth-reg-pw2'); if(rpw2) rpw2.value = '';
    const keep  = document.getElementById('cs-auth-keep');     if(keep)  keep.checked = true;
    const rkeep = document.getElementById('cs-auth-reg-keep'); if(rkeep) rkeep.checked = true;
  }

  function hideLogin(){
    const overlay = document.getElementById('cs-auth-overlay');
    if(overlay) overlay.classList.remove('on');
  }

  function currentPlayer(){ return _currentPlayer; }

  function logout(){
    try { sessionStorage.removeItem(SS_KEY); } catch(e) {}
    try { localStorage.removeItem(SS_KEY); } catch(e) {}
    _currentPlayer = null;
    if(typeof _onLogout === 'function') _onLogout();
    showLogin();
  }

  async function changePassword(oldPw, newPw){
    if(!_currentPlayer) return { ok:false, code:'no_account' };
    if(!oldPw) return { ok:false, code:'wrong_password' };
    if(!newPw || newPw.length < 8) return { ok:false, code:'failed' };
    if(newPw === oldPw) return { ok:false, code:'same_password' };

    const email = _currentPlayer.email || (_currentPlayer.emails && _currentPlayer.emails.primary) || '';

    // Verify the old password and write the new hash server-side. The worker
    // writes only to the locked-down credentials node; the client never touches
    // passwordHash.
    let res;
    try {
      const r = await fetch(AUTH_WORKER + '/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterPath: _rosterPath, email: email, oldPassword: oldPw, newPassword: newPw })
      });
      res = await r.json();
    } catch(e) {
      console.error('CourtSenseAuth changePassword failed', e);
      return { ok:false, code:'failed' };
    }
    if(!res || res.ok !== true){
      // Map worker codes onto the codes the UI already understands.
      return { ok:false, code: (res && res.code === 'invalid') ? 'wrong_password' : 'failed' };
    }

    // Queue the password_changed notification (the worker only writes the hash).
    // Best-effort: the password change already succeeded if we reached here.
    try {
      const now = Date.now();
      const eid = 'em' + now.toString(36) + Math.random().toString(36).slice(2, 5);
      await _db.ref('tally_kotb_pickup/email_queue/' + eid).set({
        type: 'password_changed',
        to: email || null,
        data: {
          player_name: _currentPlayer.name || null,
          player_email: email || null,
          changed_at_iso: new Date(now).toISOString()
        },
        relatedRegistration: null,
        status: 'queued',
        createdAt: now
      });
    } catch(e) {
      console.warn('CourtSenseAuth changePassword: notification enqueue failed', e);
    }
    return { ok:true };
  }

  // ── createPlayer: self-serve community signup ────────────────────────────
  // Validates input, reserves a snake_case key under {rosterPath}, hashes the
  // user-chosen password (cost 10), writes the player record with verified:false,
  // queues a 'welcome' email (generated_password:null since the user picked it),
  // and sets sessionStorage so the new account is immediately logged in.
  async function createPlayer(opts){
    const o = opts || {};
    const email = String(o.email == null ? '' : o.email).trim();
    const password = o.password == null ? '' : String(o.password);
    const displayName = String(o.displayName == null ? '' : o.displayName).trim();
    const city = String(o.city == null ? '' : o.city).trim();
    const skillLevel = o.skillLevel == null ? '' : String(o.skillLevel);

    if(!email) return { ok:false, error:'Email is required.' };
    if(!/^\S+@\S+\.\S+$/.test(email)) return { ok:false, error:"That email doesn't look right." };
    if(!password || password.length < 8) return { ok:false, error:'Password must be at least 8 characters.' };
    if(!displayName) return { ok:false, error:'Display name is required.' };
    if(displayName.length > 40) return { ok:false, error:'Display name must be 40 characters or fewer.' };
    if(!city) return { ok:false, error:'City is required.' };
    const VALID_SKILLS = ['Recreational','BB','A','AA','Open'];
    if(VALID_SKILLS.indexOf(skillLevel) === -1) return { ok:false, error:'Pick a skill level.' };

    if(!_db || !_rosterPath){
      return { ok:false, error:'Auth not initialized. Reload the page.' };
    }

    // Email-based dedup, runs FIRST (before the snake_case-key check below). A
    // pre-created league player (keyed by stable_id) or any prior signup may
    // already own this email under a DIFFERENT key than snake_case(displayName),
    // so the key check alone would miss them and create a duplicate. Scan the
    // roster once and match the SAME way attemptLogin and the join page do:
    // top-level email OR emails.primary, both lowercased. On a match, route them
    // to claim / log in instead of creating a second record. Read-only; this
    // adds no write path (createPlayer still has exactly one write below).
    const emailTarget = email.toLowerCase();
    let roster;
    try {
      const snap = await _db.ref(_rosterPath).once('value');
      roster = snap.val() || {};
    } catch(e){
      console.error('CourtSenseAuth.createPlayer: email dedup scan failed', e);
      return { ok:false, error:'Network error. Try again.' };
    }
    for(const id in roster){
      const p = roster[id];
      if(!p) continue;
      const e1 = typeof p.email === 'string' ? p.email.toLowerCase() : null;
      const e2 = (p.emails && typeof p.emails.primary === 'string') ? p.emails.primary.toLowerCase() : null;
      if((e1 && e1 === emailTarget) || (e2 && e2 === emailTarget)){
        return { ok:false, code:'EMAIL_EXISTS', error:'It looks like you already have an account. Head to the join page to claim it or log in.' };
      }
    }

    // Snake-case key matches Ratings.nameKey convention: lowercase, strip
    // Firebase-forbidden chars, collapse whitespace to underscore.
    const playerKey = displayName.toLowerCase().replace(/[.#$/[\]]/g,'').replace(/\s+/g,'_');
    if(!playerKey) return { ok:false, error:'Display name produces an invalid key. Use letters and numbers.' };

    let existing;
    try {
      const snap = await _db.ref(_rosterPath + '/' + playerKey).once('value');
      existing = snap.val();
    } catch(e){
      console.error('CourtSenseAuth.createPlayer: existence check failed', e);
      return { ok:false, error:'Network error. Try again.' };
    }
    if(existing){
      return { ok:false, error:'Display name already taken. Try a variation.' };
    }

    // League auto-link runs before bcrypt so we can write a single atomic
    // update below. A read failure here returns null (not blocking) so signup
    // still succeeds when the league roster is unreachable.
    const leagueMatch = await findLeagueMatch(displayName);

    const now = Date.now();
    const eid = 'em' + now.toString(36) + Math.random().toString(36).slice(2, 5);
    const emailLower = email.toLowerCase();
    // No passwordHash here: the password is set server-side via /auth/register
    // below, which writes the hash to the locked-down credentials node.
    const playerRecord = {
      email: emailLower,
      displayName: displayName,
      name: displayName, // legacy field used by the login picker (auth.js displayNameOf)
      city: city,
      profile: { skillLevel: skillLevel },
      leaguePlayerId: leagueMatch, // { side, playerId } if name matched a league roster, else null
      verified: false,
      createdAt: now,
      updatedAt: now
    };
    const updates = {};
    updates[_rosterPath + '/' + playerKey] = playerRecord;
    updates['tally_kotb_pickup/email_queue/' + eid] = {
      type: 'welcome',
      to: emailLower,
      data: {
        player_name: displayName,
        player_email: emailLower,
        generated_password: null // user picked their own password during signup
      },
      relatedRegistration: null,
      createdAt: now,
      status: 'queued'
    };

    try { await _db.ref().update(updates); }
    catch(e){
      console.error('CourtSenseAuth.createPlayer: write failed', e);
      return { ok:false, error:'Could not create account. Try again.' };
    }

    // Set the password server-side: the worker hashes it and writes to the
    // locked-down credentials node, so the hash is never written from the client.
    let regOk = false;
    try {
      const rr = await fetch(AUTH_WORKER + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterPath: _rosterPath, playerId: playerKey, password: password })
      });
      const reg = await rr.json();
      regOk = !!(reg && reg.ok === true);
    } catch(e){
      console.error('CourtSenseAuth.createPlayer: register failed', e);
    }
    if(!regOk){
      // Clean undo: remove the just-written record AND its welcome email so a
      // retry sees no existing account/email and proceeds cleanly.
      try {
        const undo = {};
        undo[_rosterPath + '/' + playerKey] = null;
        undo['tally_kotb_pickup/email_queue/' + eid] = null;
        await _db.ref().update(undo);
      } catch(e){ console.warn('CourtSenseAuth.createPlayer: undo failed', e); }
      return { ok:false, error:'Could not finish creating your account. Please try again.', code:'REGISTER_FAILED' };
    }

    // Set session so the new account is immediately logged in. keepSignedIn
    // defaults to false to preserve prior behavior for callers that omit it;
    // the in-overlay register flow passes the checkbox value explicitly.
    persistSession(playerKey, !!o.keepSignedIn);

    _currentPlayer = Object.assign({ id: playerKey }, playerRecord);

    if(typeof _onLogin === 'function'){
      try { _onLogin(_currentPlayer); }
      catch(e){ console.warn('CourtSenseAuth.createPlayer: onLogin handler threw', e); }
    }

    return { ok:true, playerKey: playerKey, autoLinked: leagueMatch !== null };
  }

  async function init(opts){
    if(_initialized) return _currentPlayer;
    if(!opts || !opts.firebaseDb || !opts.rosterPath){
      throw new Error('CourtSenseAuth.init requires firebaseDb and rosterPath');
    }
    _db = opts.firebaseDb;
    _rosterPath = opts.rosterPath;
    _onLogin = typeof opts.onLogin === 'function' ? opts.onLogin : null;
    _onLogout = typeof opts.onLogout === 'function' ? opts.onLogout : null;
    // autoShowLogin defaults to true (gating apps like kotb-pickup). Browse
    // surfaces like /community pass false so the page stays public unless
    // the user explicitly opens the login overlay.
    const autoShow = opts.autoShowLogin !== false;
    _initialized = true;

    buildOverlay();

    const restored = await autoLogin();
    if(restored){
      hideLogin();
      if(_onLogin) _onLogin(restored);
      return restored;
    }
    if(autoShow) showLogin();
    // Warm bcrypt in the background so the first login click is snappy.
    loadBcrypt().catch(() => {});
    return null;
  }

  global.CourtSenseAuth = {
    init,
    showLogin,
    hideLogin,
    currentPlayer,
    logout,
    changePassword,
    createPlayer
  };
})(typeof window !== 'undefined' ? window : globalThis);
