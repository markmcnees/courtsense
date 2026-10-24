// First-party sign-up source. A link such as courtsense.app/pickup/?src=fb-orlando
// (a Facebook group post) tells CourtSense where a new player came from. This script
// reads src once, keeps the FIRST one seen for 30 days in this browser's localStorage,
// and takes src out of the address bar so a copied link does not carry it. auth.js
// sends it with a new account (signupSource, signupSourceAt) and the worker stores it
// once. No cookie, no third party, nothing sent until an account is made. fbclid and
// every other parameter are left alone.
(function(){
  var KEY = 'cs_signup_source';
  var TTL = 30 * 86400000;
  var RE = /^[a-z0-9-]{1,40}$/;

  // The stored first visit, or null when missing, malformed or older than 30 days.
  function stored(now){
    try {
      var raw = localStorage.getItem(KEY);
      if(!raw) return null;
      var v = JSON.parse(raw);
      if(v && typeof v.src === 'string' && RE.test(v.src) && typeof v.at === 'number' && v.at <= now && now - v.at <= TTL) return v;
      localStorage.removeItem(KEY);
    } catch(e){}
    return null;
  }

  // The query string without any src parameter; every other part kept byte for byte.
  function withoutSrc(search){
    var parts = String(search || '').replace(/^\?/, '').split('&').filter(function(p){ return p && p.split('=')[0] !== 'src'; });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function capture(){
    var search = '', src = null;
    try { search = location.search || ''; src = new URLSearchParams(search).get('src'); } catch(e){ return; }
    if(src === null) return;
    var now = Date.now();
    if(RE.test(src) && !stored(now)){
      try { localStorage.setItem(KEY, JSON.stringify({ src: src, at: now })); } catch(e){}
    }
    try { history.replaceState(history.state, '', location.pathname + withoutSrc(search) + location.hash); } catch(e){}
  }

  capture();
  window.csSignupSource = {
    // { signupSource, signupSourceAt } for a new account, or null.
    get: function(){ var v = stored(Date.now()); return v ? { signupSource: v.src, signupSourceAt: v.at } : null; },
    _withoutSrc: withoutSrc
  };
})();
