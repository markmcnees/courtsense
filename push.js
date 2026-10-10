/*
 * CourtSense phone notifications (Web Push), shared by any page that includes it.
 *
 * Registers /sw.js at scope "/" (push only, no caching; see the note in sw.js) and
 * exposes window.CourtSensePush:
 *
 *   status()                 -> Promise<{ supported, needsInstall, permission,
 *                               signedIn, configured, subscribed, count, hsBlocked }>
 *   subscribe(adultConfirmed) -> Promise<{ ok, code?, error? }>
 *   unsubscribe()            -> Promise<{ ok }>
 *   sendTest()               -> Promise<{ ok, sent?, code?, error? }>
 *
 * The player is identified by CourtSenseAuth.getSessionToken() (a worker-verified
 * session), and the worker repeats every check: 18 or older, not high school
 * linked. Notification permission is only ever requested inside subscribe(), which
 * pages call from a button tap, never on load.
 *
 * iPhone: Safari only allows web push for a site added to the Home Screen and opened
 * from there (iOS 16.4+). needsInstall is true on an iPhone or iPad that is not
 * running the installed app, and the page shows install steps instead of a button.
 */
(function(global){
  'use strict';
  var WORKER = 'https://courtsense-email-worker.markmcnees-479.workers.dev';
  var _reg = null;
  var _regPromise = null;
  var _publicKey = null;

  function supported(){
    return 'serviceWorker' in navigator && 'PushManager' in global && 'Notification' in global;
  }
  function isIOS(){
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone(){
    try { if(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) return true; } catch(e){}
    return navigator.standalone === true;
  }
  function needsInstall(){ return isIOS() && !isStandalone(); }

  function register(){
    if(_regPromise) return _regPromise;
    if(!('serviceWorker' in navigator)){ _regPromise = Promise.resolve(null); return _regPromise; }
    _regPromise = navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function(r){ _reg = r; return r; })
      .catch(function(e){ console.warn('CourtSensePush: service worker registration failed', e && e.message); return null; });
    return _regPromise;
  }

  function token(){
    var A = global.CourtSenseAuth;
    return (A && A.isVerified && A.isVerified() && A.getSessionToken) ? A.getSessionToken() : null;
  }

  function post(path, payload){
    return fetch(WORKER + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){ j = j || {}; j._status = r.status; return j; });
    });
  }

  function publicKey(){
    if(_publicKey) return Promise.resolve(_publicKey);
    return fetch(WORKER + '/push/public-key').then(function(r){ return r.json(); }).then(function(j){
      if(!j || j.ok !== true || !j.publicKey) throw new Error('not_configured');
      _publicKey = j.publicKey;
      return _publicKey;
    });
  }

  function keyBytes(b64){
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    s += '==='.slice((s.length + 3) % 4);
    var bin = atob(s), out = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function localSubscription(){
    return register().then(function(r){ return r && r.pushManager ? r.pushManager.getSubscription() : null; });
  }

  function status(){
    var base = {
      supported: supported(),
      needsInstall: needsInstall(),
      permission: ('Notification' in global) ? Notification.permission : 'unsupported',
      signedIn: !!token(),
      configured: true,
      subscribed: false,
      count: 0,
      hsBlocked: false
    };
    if(!base.signedIn) return Promise.resolve(base);
    var subP = base.supported ? localSubscription().catch(function(){ return null; }) : Promise.resolve(null);
    return subP.then(function(sub){
      return post('/push/status', { sessionToken: token(), endpoint: sub ? sub.endpoint : '' }).then(function(j){
        if(j._status === 401){ base.signedIn = false; return base; }
        if(j.ok !== true) throw new Error('status ' + j._status);
        base.configured = j.configured !== false;
        base.subscribed = !!(sub && j.subscribed);
        base.count = j.count || 0;
        base.hsBlocked = !!j.hsBlocked;
        return base;
      });
    });
  }

  // Call from a tap handler. requestPermission runs first, before any other await,
  // because Safari only honors it as the direct result of a user gesture.
  function subscribe(adultConfirmed){
    if(!supported()) return Promise.resolve({ ok: false, code: 'unsupported' });
    if(adultConfirmed !== true) return Promise.resolve({ ok: false, code: 'adult_required' });
    var tok = token();
    if(!tok) return Promise.resolve({ ok: false, code: 'unauthorized' });
    var permP = Notification.requestPermission();
    return Promise.resolve(permP).then(function(perm){
      if(perm !== 'granted') return { ok: false, code: perm === 'denied' ? 'denied' : 'dismissed' };
      return Promise.all([register(), publicKey()]).then(function(v){
        var r = v[0], key = v[1];
        if(!r || !r.pushManager) return { ok: false, code: 'unsupported' };
        return r.pushManager.getSubscription().then(function(existing){
          return existing || r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
        }).then(function(sub){
          return post('/push/subscribe', { sessionToken: tok, subscription: sub.toJSON(), adultConfirmed: true }).then(function(j){
            if(j.ok === true) return { ok: true };
            // The worker refused: do not leave a browser subscription nobody can reach.
            sub.unsubscribe().catch(function(){});
            return { ok: false, code: j.code || ('http_' + j._status), error: j.error };
          });
        });
      });
    }).catch(function(e){
      return { ok: false, code: (e && e.message === 'not_configured') ? 'not_configured' : 'failed' };
    });
  }

  function unsubscribe(){
    var tok = token();
    return localSubscription().then(function(sub){
      if(!sub) return { ok: true };
      var endpoint = sub.endpoint;
      return sub.unsubscribe().catch(function(){}).then(function(){
        return tok ? post('/push/unsubscribe', { sessionToken: tok, endpoint: endpoint }) : {};
      }).then(function(){ return { ok: true }; });
    }).catch(function(){ return { ok: false }; });
  }

  function sendTest(){
    var tok = token();
    if(!tok) return Promise.resolve({ ok: false, code: 'unauthorized' });
    return post('/push/test', { sessionToken: tok }).then(function(j){
      return j.ok === true ? { ok: true, sent: j.sent || 0, gone: j.gone || 0 } : { ok: false, code: j.code, error: j.error };
    }).catch(function(){ return { ok: false, code: 'failed' }; });
  }

  if(supported()) register();

  global.CourtSensePush = { status: status, subscribe: subscribe, unsubscribe: unsubscribe, sendTest: sendTest, needsInstall: needsInstall };
})(window);
