/* CourtSense shared site nav
 *
 * One small dependency-free script, loaded by absolute path the same way
 * /auth.js, /identity.js and /ratings.js are. Renders a consistent set of
 * site links (Home, Pickup, Profile) plus an auth control (Log In / Log Out),
 * and mounts into an existing page header so it never stacks a second bar.
 *
 * Page config (set BEFORE the nav.js script tag, all optional):
 *   window.COURTSENSE_NAV = {
 *     variant: 'full' | 'home-only',  // default 'full'
 *     authControl: true | false,      // default true; ignored by 'home-only'
 *     tournaments: true | false       // default false; adds the Tournaments link
 *   }
 *
 * Mount priority:
 *   1. an element with id "cs-nav" (explicit page-chosen placement)
 *   2. the first .hdr-inner, else the first .hdr (append into the page header)
 *   3. fallback: a minimal bar injected at the top of <body>
 *
 * Auth control:
 *   - CourtSenseAuth present AND currentPlayer() truthy -> "Log Out"
 *       (calls the page's doLogout() if defined, else CourtSenseAuth.logout())
 *   - CourtSenseAuth present, logged out -> "Log In" (CourtSenseAuth.showLogin())
 *   - no CourtSenseAuth on the page -> "Log In" linking to /community/profile/
 *   Refresh with window.CourtSenseNav.refresh() (pages can call it from their
 *   onLogin/onLogout). Also re-checks on window focus as a best-effort fallback.
 *
 * Feature-detecting and null-safe: must never throw on a page without auth.js.
 */
(function(global){
  if(global.CourtSenseNav) return;

  var PROFILE = '/community/profile/';
  var LINKS = [
    { key: 'home',    label: 'Home',    href: '/community/' },
    { key: 'pickup',  label: 'Pickup',  href: '/pickup/' },
    { key: 'profile', label: 'Profile', href: PROFILE }
  ];

  // Opt-in extra, NOT part of the shared set. The tournament directory lives
  // inside the pickup app rather than at a path of its own, so this link carries
  // a query the pickup page reads on load. It is only useful on pickup surfaces,
  // and on a pre-account page (signup, reset, activate) it is pure noise, so
  // pages request it explicitly with COURTSENSE_NAV.tournaments = true.
  var TOURNAMENTS_LINK = { key: 'tournaments', label: 'Tournaments', href: '/pickup/?view=tournaments' };

  // Every link isCurrent may need to reason about, including the opt-in one.
  // isCurrent has to know about the query-bearing sibling even on a page that
  // does not render it, or a plain /pickup/ link could wrongly highlight.
  var ALL_LINKS = LINKS.concat([TOURNAMENTS_LINK]);

  var STYLE = ''
    + '.cs-nav-wrap{display:inline-flex;align-items:center;gap:14px;flex-wrap:wrap;color:inherit;}'
    + '.cs-nav-link{color:inherit;text-decoration:none;font-family:inherit;font-size:13px;'
    +   'letter-spacing:1px;opacity:.85;cursor:pointer;background:none;border:none;padding:0;'
    +   'line-height:1.2;}'
    + '.cs-nav-link:hover{opacity:1;text-decoration:underline;}'
    + '.cs-nav-link.cs-nav-current{opacity:1;font-weight:600;}'
    + '.cs-nav-bar{display:flex;justify-content:center;gap:14px;padding:8px 16px;'
    +   'background:#0f2347;color:#fff;}';

  function injectStyle(){
    if(document.getElementById('cs-nav-style')) return;
    var s = document.createElement('style');
    s.id = 'cs-nav-style';
    s.textContent = STYLE;
    (document.head || document.documentElement).appendChild(s);
  }

  function cfg(){
    var c = global.COURTSENSE_NAV || {};
    return {
      variant: c.variant === 'home-only' ? 'home-only' : 'full',
      // authControl defaults to true; explicit false suppresses the Log In/Out
      // control (e.g. pickup, which already provides its own Log Out button).
      authControl: c.authControl !== false,
      // tournaments defaults to FALSE: opt in, never opt out. Honoured by both
      // variants, because pickup/join is home-only and still wants the link.
      tournaments: c.tournaments === true
    };
  }

  function isCurrent(href){
    try {
      var path = location.pathname;
      var q = location.search || '';
      var qs = href.indexOf('?');
      // A link that carries a query is current only when that query is actually
      // present. Without this, two links sharing a pathname (/pickup/ and
      // /pickup/?view=tournaments) would both resolve as current.
      if(qs !== -1){
        var base = href.slice(0, qs);
        var want = href.slice(qs + 1);
        return path.indexOf(base) === 0 && q.indexOf(want) !== -1;
      }
      if(href === '/community/') return path === '/community/' || path === '/community';
      // A plain link loses to its own query-bearing sibling: on
      // /pickup/?view=tournaments the current tab is Tournaments, not Pickup.
      if(path.indexOf(href) === 0 && q){
        for(var i = 0; i < ALL_LINKS.length; i++){
          var o = ALL_LINKS[i].href;
          var oq = o.indexOf('?');
          if(oq === -1 || o.slice(0, oq) !== href) continue;
          if(q.indexOf(o.slice(oq + 1)) !== -1) return false;
        }
      }
      return path.indexOf(href) === 0;
    } catch(e){ return false; }
  }

  // Resolve what the auth control should show right now. Pure read; no side effects.
  function authState(){
    if(global.CourtSenseAuth){
      var p = null;
      try { p = global.CourtSenseAuth.currentPlayer && global.CourtSenseAuth.currentPlayer(); }
      catch(e){ p = null; }
      if(p) return { label: 'Log Out', kind: 'logout' };
      return { label: 'Log In', kind: 'showlogin' };
    }
    return { label: 'Log In', kind: 'link', href: PROFILE };
  }

  function doAuthAction(kind, href){
    try {
      if(kind === 'logout'){
        if(typeof global.doLogout === 'function') global.doLogout();
        else if(global.CourtSenseAuth && global.CourtSenseAuth.logout) global.CourtSenseAuth.logout();
      } else if(kind === 'showlogin'){
        if(global.CourtSenseAuth && global.CourtSenseAuth.showLogin) global.CourtSenseAuth.showLogin();
      } else if(kind === 'link'){
        location.href = href || PROFILE;
      }
    } catch(e){ /* never let the nav throw */ }
  }

  var _authBtn = null; // the live auth control element, so refresh can update it

  function buildAuthControl(){
    var st = authState();
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cs-nav-link cs-nav-auth';
    b.textContent = st.label;
    b.dataset.kind = st.kind;
    if(st.href) b.dataset.href = st.href;
    b.addEventListener('click', function(){
      doAuthAction(b.dataset.kind, b.dataset.href);
    });
    return b;
  }

  // Re-evaluate only the auth control (label + behavior). Safe to call anytime.
  function refresh(){
    if(!_authBtn) return;
    var st = authState();
    _authBtn.textContent = st.label;
    _authBtn.dataset.kind = st.kind;
    if(st.href) _authBtn.dataset.href = st.href; else delete _authBtn.dataset.href;
  }

  function findMount(){
    var byId = document.getElementById('cs-nav');
    if(byId) return byId;
    var inner = document.querySelector('.hdr-inner');
    if(inner) return inner;
    var hdr = document.querySelector('.hdr');
    if(hdr) return hdr;
    return null; // caller injects a fallback bar
  }

  function render(){
    var c = cfg();
    injectStyle();

    var wrap = document.createElement('nav');
    wrap.className = 'cs-nav-wrap';

    // The rendered set: the shared links for this variant, plus Tournaments when
    // the page asked for it. Built here rather than baked into LINKS so the
    // shared set stays the same on every page.
    var links;
    if(c.variant === 'home-only'){
      // Minimal: a single Home link, no Pickup/Profile, no auth control.
      links = [LINKS[0]];
      if(c.tournaments) links.push(TOURNAMENTS_LINK);
    } else {
      links = LINKS.slice();
      // Sits after Pickup, before Profile: it is a pickup surface, not an account one.
      if(c.tournaments) links.splice(2, 0, TOURNAMENTS_LINK);
    }

    if(c.variant === 'home-only'){
      links.forEach(function(l){
        var a0 = document.createElement('a');
        a0.className = 'cs-nav-link' + (isCurrent(l.href) ? ' cs-nav-current' : '');
        a0.href = l.href;
        a0.textContent = l.label;
        wrap.appendChild(a0);
      });
    } else {
      links.forEach(function(l){
        var a = document.createElement('a');
        a.className = 'cs-nav-link' + (isCurrent(l.href) ? ' cs-nav-current' : '');
        a.href = l.href;
        a.textContent = l.label;
        wrap.appendChild(a);
      });
      if(c.authControl){
        _authBtn = buildAuthControl();
        wrap.appendChild(_authBtn);
      }
    }

    var mount = findMount();
    if(mount){
      // Adapt link color to the header we mounted into: copy the mount's
      // effective text color onto the wrapper so links stay legible on a dark
      // header (pickup) and a light header (community) alike, with no hardcoded
      // color. color:inherit alone proved unreliable for the injected structure,
      // so we pin the resolved color explicitly and let the links inherit it.
      try {
        var mc = global.getComputedStyle ? getComputedStyle(mount).color : '';
        if(mc) wrap.style.color = mc;
      } catch(e){}
      mount.appendChild(wrap);
    } else {
      // No header on this page: inject a minimal top bar so the page is not a
      // dead end. Neutral dark bar; pages with their own header never reach here.
      var bar = document.createElement('div');
      bar.className = 'cs-nav-bar';
      bar.appendChild(wrap);
      if(document.body) document.body.insertBefore(bar, document.body.firstChild);
    }
  }

  function start(){
    try { render(); } catch(e){ /* nav is best-effort; never break the page */ }
    // Best-effort refresh: pages that wire onLogin/onLogout can call refresh()
    // directly; window focus catches the common tab-switch login case otherwise.
    try { global.addEventListener('focus', refresh); } catch(e){}
  }

  global.CourtSenseNav = { render: render, refresh: refresh };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);
