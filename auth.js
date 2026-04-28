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
 *   CourtSenseAuth.changePassword(oldPw, newPw) -> Promise<bool>
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
    if(!_currentPlayer) return false;
    if(!oldPw || !newPw) return false;
    if(newPw.length < 6) return false;
    let bcrypt;
    try { bcrypt = await loadBcrypt(); } catch(e) { return false; }
    let player;
    try {
      const snap = await _db.ref(_rosterPath + '/' + _currentPlayer.id).once('value');
      player = snap.val();
    } catch(e) { return false; }
    if(!player || !player.passwordHash) return false;
    let ok = false;
    try { ok = bcrypt.compareSync(oldPw, player.passwordHash); } catch(e) { return false; }
    if(!ok) return false;
    let newHash;
    try { newHash = bcrypt.hashSync(newPw, 10); } catch(e) { return false; }
    try { await _db.ref(_rosterPath + '/' + _currentPlayer.id + '/passwordHash').set(newHash); }
    catch(e) { return false; }
    return true;
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
    _initialized = true;

    buildOverlay();

    const restored = await autoLogin();
    if(restored){
      hideLogin();
      if(_onLogin) _onLogin(restored);
      return restored;
    }
    showLogin();
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
    changePassword
  };
})(typeof window !== 'undefined' ? window : globalThis);
