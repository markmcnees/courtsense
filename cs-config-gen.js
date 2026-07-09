/* CourtSense shared config generation.
   Pure functions: take a plain data object, return config text.
   Used by the onboarding review screen (approve flow) and the standalone generator.
   No DOM access here; callers pass the data in. */
(function(global){
  'use strict';

  function slugify(s){
    return (s||'').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }
  function shortSlug(name){
    var full=slugify(name);
    if(!full) return '';
    var filler={beach:1,volleyball:1,vball:1,'high':1,'highschool':1,school:1,program:1,team:1};
    var parts=full.split('-').filter(Boolean);
    var kept=parts.filter(function(w){return !filler[w];});
    if(kept.length===0) kept=parts;
    return kept.join('-');
  }
  function nodeBase(slug){ return (slug||'').replace(/-/g,'_'); }

  function clampHex(h){
    h=(h||'').trim();
    if(/^#[0-9a-fA-F]{6}$/.test(h)) return h;
    if(/^#[0-9a-fA-F]{3}$/.test(h)) return '#'+h[1]+h[1]+h[2]+h[2]+h[3]+h[3];
    return null;
  }
  function hexToRgb(h){ h=clampHex(h)||'#000000'; return {r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)}; }
  function rgbToHex(r,g,b){ var f=function(n){n=Math.max(0,Math.min(255,Math.round(n)));return n.toString(16).padStart(2,'0');}; return '#'+f(r)+f(g)+f(b); }
  function shade(hex,amt){ var c=hexToRgb(hex); if(amt<0){var k=1+amt;return rgbToHex(c.r*k,c.g*k,c.b*k);} var t=amt; return rgbToHex(c.r+(255-c.r)*t,c.g+(255-c.g)*t,c.b+(255-c.b)*t); }
  function tint(hex){ var c=hexToRgb(hex); return rgbToHex(c.r+(255-c.r)*0.9,c.g+(255-c.g)*0.9,c.b+(255-c.b)*0.9); }

  // Derive the three school nodes from a slug. Profiles uses _profiles so the
  // $school_node rules wildcard governs it.
  function derivedNodes(slug){
    var base=nodeBase(slug||'school');
    return { slug:slug, root:base, matches:base+'_matches', profiles:base+'_profiles', passwords:base+'_passwords' };
  }

  function q(s){ return "'"+String(s==null?'':s).replace(/'/g,"\\'")+"'"; }

  /* buildConfig(data): data is an object with:
     required: slug, coachPin, schoolName
     optional: shortName, abbrev, displayName, teamEmoji, color1, color2,
               homeVenue, standingsKey, defaultPw, maxPrepsUrl, logo
     Returns the full <script> SCHOOL_CONFIG block as text. */
  function buildConfig(data){
    var d=data||{};
    var slug=d.slug||slugify(d.schoolName)||'school';
    var n=derivedNodes(slug);
    var prim=clampHex(d.color1)||'#0E7A3B';
    var bg=clampHex(d.color2)? tint(clampHex(d.color1)||'#0E7A3B') : tint(prim);
    var shortName=d.shortName||d.schoolName||'';
    var displayName=d.displayName||shortName;
    var lines=[];
    lines.push("<script>");
    lines.push("window.SCHOOL_CONFIG = {");
    lines.push("  schoolName:      "+q(d.schoolName)+",");
    lines.push("  shortName:       "+q(shortName)+",");
    lines.push("  abbrev:          "+q(d.abbrev||'')+",");
    lines.push("  displayName:     "+q(displayName)+",");
    lines.push("  title:           "+q((d.schoolName||'')+' Volleyball Tracker')+",");
    lines.push("  coachPin:        "+q(d.coachPin)+",");
    lines.push("  defaultPw:       "+q(d.defaultPw||'Beach2026')+",");
    lines.push("  fbConfig:{apiKey:'AIzaSyC8Ue06XPvGXo1XTloewPvDRBWtK5tDAj8',authDomain:'leon-beach-volleyball.firebaseapp.com',databaseURL:'https://leon-beach-volleyball-default-rtdb.firebaseio.com',projectId:'leon-beach-volleyball',storageBucket:'leon-beach-volleyball.firebasestorage.app',messagingSenderId:'937804799976',appId:'1:937804799976:web:02121e68655b4febeb8e5d'},");
    lines.push("  dbRoots:{matches:"+q(n.matches)+",profiles:"+q(n.profiles)+",passwords:"+q(n.passwords)+"},");
    lines.push("  logo:            "+q(d.logo||'')+",");
    lines.push("  logoAlt:         "+q(shortName||d.abbrev||'')+",");
    lines.push("  colors:{primary:'"+prim+"',primaryDark:'"+shade(prim,-0.2)+"',primaryDeeper:'"+shade(prim,-0.38)+"',primaryLight:'"+shade(prim,0.3)+"',primaryBg:'"+bg+"'},");
    lines.push("  aiProxyUrl:      'https://beach-volleyball-ai.markmcnees-479.workers.dev',");
    lines.push("  maxPrepsUrl:     "+q(d.maxPrepsUrl||'')+",");
    lines.push("  courtsenseUrl:   '/quiz/',");
    lines.push("  myStandingsKey:  "+q(d.standingsKey||shortName)+",");
    lines.push("  homeVenue:       "+q(d.homeVenue||'')+",");
    lines.push("  teamEmoji:       "+q(d.teamEmoji||'🏐')+",");
    lines.push("  exportPrefix:    "+q(n.root+'_')+",");
    lines.push("  legacyMigration: false");
    lines.push("};");
    lines.push("<\/script>");
    return lines.join("\n");
  }

  function buildKeyMap(data){
    var d=data||{};
    var slug=d.slug||slugify(d.schoolName)||'school';
    var n=derivedNodes(slug);
    var shortName=d.shortName||d.schoolName||'';
    var std=d.standingsKey||shortName||'School';
    var disp=d.displayName||shortName||std;
    var out=[];
    out.push("// Add inside SCHOOL_KEY_MAP in app.js. Both the standings name");
    out.push("// and the display name map to the matches node.");
    out.push("'"+std+"': '"+n.matches+"',");
    if(disp && disp!==std) out.push("'"+disp+"': '"+n.matches+"',");
    return out.join("\n");
  }

  function buildChecklist(data){
    var d=data||{};
    var slug=d.slug||slugify(d.schoolName)||'school';
    var n=derivedNodes(slug);
    var logo=d.logo||'(logo file)';
    return [
      "[ ] 1. Create folder  courtsense/"+slug+"/",
      "[ ] 2. Save index.html there with the SCHOOL_CONFIG above,",
      "       followed by  <script src=\"/app.js?v=CURRENT\"><\/script>",
      "[ ] 3. Drop the logo file  "+logo+"  in that same folder",
      "[ ] 4. Paste the SCHOOL_KEY_MAP snippet into app.js",
      "[ ] 5. git add courtsense/"+slug+"/  (explicit path, new dir)",
      "[ ] 6. Commit app.js via deploy.sh so the key map ships too",
      "[ ] 7. Phone test:  courtsense.app/"+slug+"/  loads, empty roster,",
      "       coach PIN opens the coach view",
      "[ ] 8. Send the coach their welcome email (URL + their PIN + guide link)",
      "",
      "Node starts empty. First coach save creates "+n.matches+".",
      "The three nodes ("+n.matches+", "+n.profiles+", "+n.passwords+")",
      "are governed by the $school_node rules wildcard, no rules edit needed."
    ].join("\n");
  }

  global.CSConfigGen = {
    slugify:slugify, shortSlug:shortSlug, nodeBase:nodeBase,
    clampHex:clampHex, derivedNodes:derivedNodes,
    buildConfig:buildConfig, buildKeyMap:buildKeyMap, buildChecklist:buildChecklist
  };
})(typeof window!=='undefined'?window:this);
