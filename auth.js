/* CourtSense shared auth module
 *
 * Ported from the Leon school login pattern, simplified to player-only.
 * Coach actions on CourtSense happen via admin-players.html, which is
 * separately PIN-gated.
 *
 * Pattern:
 *   CourtSenseAuth.init({ firebaseDb, rosterPath, onLogin, onLogout })
 *   CourtSenseAuth.showLogin() / hideLogin() / currentPlayer()
 *   CourtSenseAuth.logout()
 *   CourtSenseAuth.changePassword(oldPw, newPw) -> Promise<{ok:true} | {ok:false, code}>
 *     codes: 'wrong_password' | 'no_account' | 'same_password' | 'failed'
 *     On ok:true the player's passwordHash + updatedAt are written and a
 *     'password_changed' row is queued in tally_kotb_pickup/email_queue.
 *   CourtSenseAuth.createPlayer({ email, password, displayName, city, skillLevel })
 *     -> Promise<{ok:true, playerKey} | {ok:false, error}>
 *     Self-serve community signup. Writes verified:false player record at
 *     {rosterPath}/{snake_case_displayName}, queues a 'welcome' email with
 *     generated_password:null (user picked their own), and sets sessionStorage
 *     so the new player is logged in immediately. Phase D will add email
 *     verification gating against the verified flag.
 *
 * Storage: passwordHash lives at {rosterPath}/{playerId}/passwordHash.
 * Hashing happens in admin-players.html at approval time (cost 10).
 * Verifying happens here at login time. Plaintext is never persisted;
 * it only lives in the welcome email payload.
 *
 * Session: sessionStorage 'courtsenseAuth' = { playerId, ts }. Survives
 * navigation, clears on browser close. autoLogin restores on init.
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
.cs-auth-input{width:100%;padding:13px 12px;border:1.5px solid #d1d5db;border-radius:10px;font-family:'Barlow',sans-serif;font-size:15px;color:#111827;background:#fff;margin-bottom:10px;min-height:48px;}
.cs-auth-input:focus{outline:none;border-color:#1a3a6b;}
select.cs-auth-input{-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:36px;}
.cs-auth-err{color:#dc2626;font-size:13px;font-weight:600;min-height:18px;margin:2px 2px 8px;}
.cs-auth-btn{display:block;width:100%;padding:14px 18px;border-radius:10px;border:none;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1.5px;cursor:pointer;background:#1a3a6b;color:#fff;min-height:50px;}
.cs-auth-btn:active{filter:brightness(.9);}
.cs-auth-btn:disabled{opacity:.5;cursor:not-allowed;}
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
        <select class="cs-auth-input" id="cs-auth-player">
          <option value="">— Choose Player —</option>
        </select>
        <input type="password" class="cs-auth-input" id="cs-auth-pw" placeholder="Enter Password" autocomplete="current-password">
        <div class="cs-auth-err" id="cs-auth-err"></div>
        <button class="cs-auth-btn" id="cs-auth-go">Log In</button>
        <div class="cs-auth-foot">Forgot password? <a href="${ADMIN_MAIL}">Contact admin.</a></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cs-auth-go').addEventListener('click', handleLoginClick);
    overlay.querySelector('#cs-auth-pw').addEventListener('keydown', e => {
      if(e.key === 'Enter') handleLoginClick();
    });
    _overlayBuilt = true;
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

  async function populatePlayerSelect(){
    const sel = document.getElementById('cs-auth-player');
    if(!sel) return;
    const cur = sel.value;
    try {
      const snap = await _db.ref(_rosterPath).once('value');
      const players = snap.val() || {};
      const list = Object.entries(players)
        .filter(([, p]) => p && p.passwordHash && !p.blocked)
        .map(([id, p]) => ({ id, name: displayNameOf(p, id), lastName: lastNameOf(p) }))
        .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '') || a.name.localeCompare(b.name));
      sel.innerHTML = '<option value="">— Choose Player —</option>' +
        list.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
      if(cur) sel.value = cur;
    } catch(e) {
      console.error('CourtSenseAuth: failed to load roster', e);
    }
  }

  async function attemptLogin(playerId, password){
    if(!playerId) return { success: false, error: 'Select your name' };
    if(!password) return { success: false, error: 'Enter your password' };

    let player;
    try {
      const snap = await _db.ref(_rosterPath + '/' + playerId).once('value');
      player = snap.val();
    } catch(e) {
      console.error(e);
      return { success: false, error: 'Network error. Try again.' };
    }
    if(!player) return { success: false, error: 'Player not found' };
    if(!player.passwordHash) return { success: false, error: 'No password set. Contact admin.' };

    let bcrypt;
    try { bcrypt = await loadBcrypt(); }
    catch(e) { console.error(e); return { success: false, error: 'Could not load login. Refresh and try again.' }; }

    let ok = false;
    try { ok = bcrypt.compareSync(password, player.passwordHash); }
    catch(e) { console.error(e); return { success: false, error: 'Login failed. Try again.' }; }
    if(!ok) return { success: false, error: 'Incorrect password' };

    sessionStorage.setItem(SS_KEY, JSON.stringify({ playerId, ts: Date.now() }));
    _currentPlayer = Object.assign({ id: playerId }, player);
    delete _currentPlayer.passwordHash;
    return { success: true, player: _currentPlayer };
  }

  async function handleLoginClick(){
    const sel = document.getElementById('cs-auth-player');
    const pw  = document.getElementById('cs-auth-pw');
    const err = document.getElementById('cs-auth-err');
    const btn = document.getElementById('cs-auth-go');
    if(!sel || !pw || !err || !btn) return;
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Logging in...';
    try {
      const res = await attemptLogin(sel.value, pw.value);
      if(!res.success){
        err.textContent = res.error || 'Login failed';
        return;
      }
      pw.value = '';
      hideLogin();
      if(typeof _onLogin === 'function') _onLogin(res.player);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  }

  async function autoLogin(){
    let v;
    try { v = sessionStorage.getItem(SS_KEY); } catch(e) { return null; }
    if(!v) return null;
    let parsed;
    try { parsed = JSON.parse(v); } catch(e) { return null; }
    if(!parsed || !parsed.playerId) return null;
    try {
      const snap = await _db.ref(_rosterPath + '/' + parsed.playerId).once('value');
      const player = snap.val();
      if(!player || !player.passwordHash || player.blocked){
        sessionStorage.removeItem(SS_KEY);
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
    populatePlayerSelect();
    const err = document.getElementById('cs-auth-err'); if(err) err.textContent = '';
    const pw = document.getElementById('cs-auth-pw'); if(pw) pw.value = '';
  }

  function hideLogin(){
    const overlay = document.getElementById('cs-auth-overlay');
    if(overlay) overlay.classList.remove('on');
  }

  function currentPlayer(){ return _currentPlayer; }

  function logout(){
    try { sessionStorage.removeItem(SS_KEY); } catch(e) {}
    _currentPlayer = null;
    if(typeof _onLogout === 'function') _onLogout();
    showLogin();
  }

  async function changePassword(oldPw, newPw){
    if(!_currentPlayer) return { ok:false, code:'no_account' };
    if(!oldPw) return { ok:false, code:'wrong_password' };
    if(!newPw || newPw.length < 6) return { ok:false, code:'failed' };
    if(newPw === oldPw) return { ok:false, code:'same_password' };
    let bcrypt;
    try { bcrypt = await loadBcrypt(); } catch(e) { return { ok:false, code:'failed' }; }
    let player;
    try {
      const snap = await _db.ref(_rosterPath + '/' + _currentPlayer.id).once('value');
      player = snap.val();
    } catch(e) { return { ok:false, code:'failed' }; }
    if(!player || !player.passwordHash) return { ok:false, code:'no_account' };
    let verified = false;
    try { verified = bcrypt.compareSync(oldPw, player.passwordHash); } catch(e) { return { ok:false, code:'failed' }; }
    if(!verified) return { ok:false, code:'wrong_password' };
    let newHash;
    try { newHash = bcrypt.hashSync(newPw, 10); } catch(e) { return { ok:false, code:'failed' }; }

    const now = Date.now();
    const eid = 'em' + now.toString(36) + Math.random().toString(36).slice(2, 5);
    const updates = {};
    updates[_rosterPath + '/' + _currentPlayer.id + '/passwordHash'] = newHash;
    updates[_rosterPath + '/' + _currentPlayer.id + '/updatedAt'] = now;
    updates['tally_kotb_pickup/email_queue/' + eid] = {
      type: 'password_changed',
      to: player.email || null,
      data: {
        player_name: player.name || null,
        player_email: player.email || null,
        changed_at_iso: new Date(now).toISOString()
      },
      relatedRegistration: null,
      status: 'queued',
      createdAt: now
    };
    try { await _db.ref().update(updates); }
    catch(e) { return { ok:false, code:'failed' }; }
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

    let bcrypt;
    try { bcrypt = await loadBcrypt(); }
    catch(e){
      console.error('CourtSenseAuth.createPlayer: bcrypt load failed', e);
      return { ok:false, error:'Could not load signup. Refresh and try again.' };
    }

    let passwordHash;
    try { passwordHash = bcrypt.hashSync(password, 10); }
    catch(e){
      console.error('CourtSenseAuth.createPlayer: hash failed', e);
      return { ok:false, error:'Signup failed. Try again.' };
    }

    const now = Date.now();
    const eid = 'em' + now.toString(36) + Math.random().toString(36).slice(2, 5);
    const emailLower = email.toLowerCase();
    const playerRecord = {
      email: emailLower,
      passwordHash: passwordHash,
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

    // Set session so the new account is immediately logged in.
    try { sessionStorage.setItem(SS_KEY, JSON.stringify({ playerId: playerKey, ts: now })); }
    catch(e){ console.warn('CourtSenseAuth.createPlayer: sessionStorage write failed', e); }

    _currentPlayer = Object.assign({ id: playerKey }, playerRecord);
    delete _currentPlayer.passwordHash;

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
