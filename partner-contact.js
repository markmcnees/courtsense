// Partner contact, shared by /partners/ and the pickup pool roster, so both send
// through the same worker routes with the same compose box: the stored session
// token, POST /partners/me and POST /partners/message. Nothing here touches
// Firebase. Every value, including message text, is set through textContent.
(function(global){
  if(global.CourtSensePartner) return;
  const WORKER = 'https://courtsense-email-worker.markmcnees-479.workers.dev';

  function el(tag, cls, text){
    const n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text != null) n.textContent = text;
    return n;
  }
  function link(cls, text, href){ const a = el('a', cls, text); a.href = href; return a; }
  function btn(cls, text, onClick){
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function threadHref(id){ return '/partners/?thread=' + encodeURIComponent(id); }

  // The worker session token from the stored sign-in, or '' when there is none or it
  // has expired. The worker checks it on every call, so nothing here trusts it.
  function storedToken(){
    for(const store of [localStorage, sessionStorage]){
      try {
        const p = JSON.parse(store.getItem('courtsenseAuth') || 'null');
        if(p && typeof p.sessionToken === 'string' && /^[a-f0-9]{64}$/.test(p.sessionToken)){
          if(typeof p.sessionExpiresAt === 'number' && p.sessionExpiresAt && p.sessionExpiresAt <= Date.now()) continue;
          return p.sessionToken;
        }
      } catch(e){}
    }
    return '';
  }

  // Always resolves to { status, j }; j.error is set to something a player can read.
  async function post(path, data, token){
    try {
      const r = await fetch(WORKER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ sessionToken: token }, data || {})) });
      const j = await r.json().catch(function(){ return null; });
      return { status: r.status, j: j || { ok: false, error: 'Something went wrong. Try again.' } };
    } catch(e){
      return { status: 0, j: { ok: false, error: 'Could not reach CourtSense. Check your connection.' } };
    }
  }

  // { me } when the worker accepts the session, otherwise { me: null, reason, error }:
  //   no_token  nothing stored, so the player needs to sign in (no message needed)
  //   expired   the worker refused the token (401)
  //   error     network, server, or anything else
  // With tid the answer also carries pool: { poolKey: { ref, divs } } for that event,
  // and the Post your team lists (myTeams, matches, clubMatches, clubMembers, teamFits,
  // club), filtered by gender: 'everyone' | 'women' | 'men'.
  async function loadMe(token, tid, gender){
    if(!token) return { me: null, reason: 'no_token' };
    const r = await post('/partners/me', tid ? { tid: tid, gender: gender || 'everyone' } : null, token);
    if(r.status === 200 && r.j.ok) return { me: r.j };
    if(r.status === 401) return { me: null, reason: 'expired', error: 'Your sign-in has expired. Sign in again to message players.' };
    return { me: null, reason: 'error', error: (r.status === 0 ? r.j.error : 'Could not check your sign-in right now. Refresh to try again.') };
  }

  // Text box with a live count, capped at 500 like the worker.
  function textBox(placeholder){
    const ta = el('textarea');
    ta.maxLength = 500;
    ta.placeholder = placeholder;
    const count = el('div', 'count', '0/500');
    ta.addEventListener('input', function(){ count.textContent = ta.value.length + '/500'; });
    return { ta: ta, count: count };
  }
  // The one-time 18+ box, shown only until the worker has a confirmation.
  function adultBox(me){
    if(me && me.adult) return null;
    const lab = el('label', 'chk');
    const cb = el('input'); cb.type = 'checkbox';
    lab.appendChild(cb);
    lab.appendChild(el('span', null, 'I am 18 or older. Partner messaging is for adult players.'));
    return { lab: lab, cb: cb };
  }

  // Compose under a row: Ask to team up with a person (with a division picker) or Ask
  // to join a team. With team forming on the note is optional; it becomes the first
  // message of the conversation. ctx: { me, token, ui: { primary, secondary },
  // onSignIn() } where onSignIn, when given, is offered after a 401.
  function openCompose(host, opts, ctx){
    const existing = host.querySelector('.compose');
    if(existing){ existing.remove(); return null; }
    const ui = ctx.ui || { primary: 'btn btn-p', secondary: 'btn btn-o' };
    const box = el('div', 'compose');
    if(opts.title) box.appendChild(el('div', 'who', opts.title));
    let pick = null;
    if(opts.divs && opts.divs.length > 1){
      box.appendChild(el('label', null, 'Division'));
      pick = el('select');
      opts.divs.forEach(d => { const o = el('option', null, d.label); o.value = d.div; pick.appendChild(o); });
      if(opts.preset && opts.divs.some(d => d.div === opts.preset)) pick.value = opts.preset;
      box.appendChild(pick);
    }
    box.appendChild(el('label', null, opts.prompt));
    const t = textBox(opts.placeholder);
    box.appendChild(t.ta); box.appendChild(t.count);
    const adult = adultBox(ctx.me);
    if(adult) box.appendChild(adult.lab);
    box.appendChild(el('div', 'note', 'Keep it short. Links are removed. Your email and phone are never shared.'));
    const out = el('div');
    const row = el('div', 'btns');
    const send = btn(ui.primary, opts.sendText, async function(){
      out.textContent = '';
      if(!opts.optional && !t.ta.value.trim()){ out.appendChild(el('div', 'msg-err', 'Write a short message first.')); return; }
      if(adult && !adult.cb.checked){ out.appendChild(el('div', 'msg-err', 'Please confirm you are 18 or older.')); return; }
      send.disabled = true;
      const r = await post('/partners/message', { tid: opts.tid, div: pick ? pick.value : (opts.divs && opts.divs[0] ? opts.divs[0].div : ''), ref: opts.ref, text: t.ta.value, adultConfirmed: adult ? adult.cb.checked : undefined }, ctx.token);
      send.disabled = false;
      if(!r.j.ok){
        out.appendChild(el('div', 'msg-err', r.j.error || 'That did not send.'));
        if(r.j.threadId) out.appendChild(link('ext', 'Open the conversation', threadHref(r.j.threadId)));
        if(r.status === 401 && ctx.onSignIn) out.appendChild(btn(ui.secondary, 'Sign in again', ctx.onSignIn));
        return;
      }
      if(ctx.me) ctx.me.adult = true;
      box.textContent = '';
      box.appendChild(el('div', 'msg-ok', 'Sent' + (r.j.linksRemoved ? ' (links removed)' : '') + '. ' + (r.j.request ? 'They will get an email and can answer yes, maybe or no.' : 'They will get an email.')));
      box.appendChild(link('ext', 'Open the conversation', threadHref(r.j.threadId)));
      if(ctx.onSent) ctx.onSent(r.j);
    });
    row.appendChild(send);
    row.appendChild(btn(ui.secondary, 'Cancel', function(){ box.remove(); }));
    box.appendChild(row);
    box.appendChild(out);
    host.appendChild(box);
    t.ta.focus();
    return box;
  }

  // The public partner board, for one tournament or all. fresh skips the browser's
  // cached copy: after a team change the worker has already rebuilt its own, so this
  // shows the change at once. Throws with a message a player can read.
  async function fetchBoard(tid, fresh){
    let r, j = null;
    try {
      r = await fetch(WORKER + '/pickup/partner-board' + (tid ? '?t=' + encodeURIComponent(tid) : ''), fresh ? { cache: 'no-store' } : undefined);
      j = await r.json().catch(function(){ return null; });
    } catch(e){
      throw new Error('Could not reach CourtSense. Check your connection.');
    }
    if(!r.ok || !j || j.ok !== true || !Array.isArray(j.tournaments)) throw new Error((j && j.error) || 'Could not load the partner board. Refresh to try again.');
    return j.tournaments;
  }

  // ── Teams ───────────────────────────────────────────────────────────────────
  // The viewer's active team on each day of one board tournament, found by the team
  // refs /partners/me hands back (selfRefs for that tournament):
  // { day: { div, divLabel, ref, members, need, size, status } }.
  function myTeamsByDay(t, selfRefs){
    const out = {};
    const mine = selfRefs || [];
    (t && t.divisions || []).forEach(d => (d.teams || []).forEach(tm => {
      if(tm.ref && mine.indexOf(tm.ref) !== -1) out[d.day] = { div: d.div, divLabel: d.label, ref: tm.ref, members: tm.members, guests: tm.guests || [], need: tm.need, size: tm.size, status: tm.status };
    }));
    return out;
  }
  // What a free agent's button does for this viewer, from their divisions
  // ([{ div, day, label }]): invite them onto the viewer's forming team (only that
  // team's division), ask them to team up (divisions on days the viewer is free), or
  // null when there is nothing to offer (the viewer's team that day is complete or
  // in another division). The worker decides the same way; this only labels it.
  function contactPlan(t, selfRefs, divs){
    const byDay = myTeamsByDay(t, selfRefs);
    const invite = [], ask = [];
    let team = null;
    (divs || []).forEach(d => {
      const tm = byDay[d.day];
      if(!tm) ask.push(d);
      else if(tm.status !== 'complete' && tm.div === d.div){ invite.push(d); team = team || tm; }
    });
    if(invite.length) return { kind: 'invite', divs: invite, team: team };
    if(ask.length) return { kind: 'ask', divs: ask };
    return null;
  }
  // Everyone on a team: members, then guests ("Mark M. + Sam + Jo").
  function teamNames(tm){ return (tm.members || []).concat(tm.guests || []); }
  // 'Mark M. + Test A., looking for 2 more', or just the names when complete.
  function teamLine(tm){ return teamNames(tm).join(' + ') + (tm.status === 'complete' ? '' : ', looking for ' + tm.need + ' more'); }
  function inviteTitle(name, tm){ return 'Invite ' + name + ' to join ' + teamNames(tm).join(' + ') + ' (looking for ' + tm.need + ' more)'; }
  // Combine teams, from /partners/me combinable: 'Combine Mark M. + Lydia M. with Jake T. + Sam R. (makes 4 of 4)'.
  function combineTitle(cb){ return 'Combine ' + (cb.mineNames || []).join(' + ') + ' with ' + (cb.theirNames || []).join(' + ') + ' (makes ' + cb.filled + ' of ' + cb.size + ')'; }

  // ── Board look, shared by /partners/ and the pickup tournament page ──────────
  // Two sections, always shown: Teams looking for players (teal band, light teal
  // cards) and Players looking for a team (navy band, sand cards). One gold button per
  // card; everything secondary is a quiet text link. Text colors are picked for AA
  // contrast on each tint. Every class starts with pb- so neither page's own styles
  // collide with it.
  const CSS = [
    '.pb-sec{margin:16px 0 0;border-radius:14px;overflow:hidden;background:#fff;border:1px solid #CFE3E3;}',
    '.pb-sec-players{border-color:#EADCC2;}',
    '.pb-band{margin:0;padding:10px 14px;font-family:"Bebas Neue",sans-serif;font-weight:400;font-size:21px;letter-spacing:1.3px;line-height:1.2;color:#fff;}',
    '.pb-sec-teams .pb-band{background:#217F7F;}',
    '.pb-sec-players .pb-band{background:#082A4F;}',
    '.pb-list{padding:10px;display:flex;flex-direction:column;gap:10px;}',
    '.pb-card{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px 14px;border-radius:12px;font-family:Barlow,-apple-system,sans-serif;color:#13243A;text-align:left;}',
    '.pb-team{background:#E6F2F2;border:1px solid #BFDCDC;}',
    '.pb-team.pb-mine{background:#fff;border:2px solid #217F7F;}',
    '.pb-team.pb-complete{background:#F1F3F5;border:1px solid #DCE1E6;}',
    '.pb-player{background:#FDF3E1;border:1px solid #F0DDB8;}',
    '.pb-player.pb-mine{background:#fff;border:2px solid #F2B22E;}',
    '.pb-main{flex:1 1 190px;min-width:0;}',
    '.pb-name{font-weight:700;font-size:16px;line-height:1.3;overflow-wrap:anywhere;}',
    '.pb-sub{font-size:14px;line-height:1.4;color:#3B4A59;margin-top:2px;}',
    '.pb-need{font-weight:700;color:#145757;}',
    '.pb-complete .pb-name,.pb-complete .pb-sub{color:#4A5867;}',
    '.pb-note{font-size:14px;line-height:1.4;font-style:italic;color:#3B4A59;margin-top:4px;overflow-wrap:anywhere;}',
    '.pb-badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:5px;font-family:"Bebas Neue",sans-serif;font-weight:400;font-size:14px;letter-spacing:1px;line-height:1.4;vertical-align:1px;white-space:nowrap;}',
    '.pb-badge-you{background:#082A4F;color:#fff;}',
    '.pb-badge-team{background:#217F7F;color:#fff;}',
    '.pb-badge-done{background:#DCE1E6;color:#3B4A59;}',
    '.pb-badge-rating{background:#082A4F;color:#fff;}',
    '.pb-act{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:0 0 auto;margin-left:auto;}',
    '.pb-gold{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border:none;border-radius:10px;background:#F2B22E;color:#082A4F;font-family:"Bebas Neue",sans-serif;font-weight:400;font-size:18px;letter-spacing:1.2px;line-height:1;text-decoration:none;white-space:nowrap;cursor:pointer;box-shadow:0 1px 0 rgba(8,42,79,.18);}',
    '.pb-gold:hover{background:#E8A71F;}',
    '.pb-gold:disabled{opacity:.55;cursor:not-allowed;}',
    '.pb-quiet{display:inline-flex;align-items:center;min-height:44px;padding:0 4px;border:none;background:none;color:#145757;font-family:Barlow,-apple-system,sans-serif;font-size:14px;font-weight:600;text-decoration:underline;text-underline-offset:3px;cursor:pointer;}',
    '.pb-gold:focus-visible,.pb-quiet:focus-visible,.pb-ans:focus-visible{outline:3px solid #0081AB;outline-offset:2px;}',
    '.pb-box{flex-basis:100%;min-width:0;}',
    '.pb-box:empty{display:none;}',
    '.pb-empty{padding:6px 4px;font-size:15px;line-height:1.45;color:#3B4A59;}',
    '.pb-quiets{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px;margin-top:6px;}',
    '.pb-tag{display:inline-block;padding:2px 9px;border-radius:999px;font-family:Barlow,-apple-system,sans-serif;font-size:13px;font-weight:700;line-height:1.5;}',
    '.pb-tag-soon{background:#FDF1D6;color:#6E4A00;}',
    '.pb-tag-open{background:#DDF1EA;color:#0F5B43;}',
    '.pb-tag-closed{background:#EEF1F4;color:#3B4A59;}',
    '.pb-strip{margin:0 0 14px;padding:12px 14px;border:1px solid #F2B22E;border-left:6px solid #F2B22E;border-radius:12px;background:#FFF5DC;font-family:Barlow,-apple-system,sans-serif;color:#13243A;text-align:left;}',
    '.pb-strip-h{font-family:"Bebas Neue",sans-serif;font-size:19px;letter-spacing:1.2px;color:#082A4F;}',
    '.pb-req{padding:8px 0 0;}',
    '.pb-req+.pb-req{border-top:1px solid #EBD39A;margin-top:6px;}',
    '.pb-req-line{font-size:15px;font-weight:700;line-height:1.4;overflow-wrap:anywhere;}',
    '.pb-req-note{font-weight:400;font-style:italic;}',
    '.pb-req-sub{font-size:13px;color:#4A5867;margin-top:2px;overflow-wrap:anywhere;}',
    '.pb-answers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px;}',
    '.pb-ans{min-height:44px;padding:0 4px;border:1.5px solid #082A4F;border-radius:10px;background:#fff;color:#082A4F;font-family:"Bebas Neue",sans-serif;font-size:17px;letter-spacing:1px;cursor:pointer;}',
    '.pb-ans.pb-yes{background:#F2B22E;border-color:#C98F12;}',
    '.pb-ans.pb-sel{background:#082A4F;border-color:#082A4F;color:#fff;}',
    '.pb-form{margin-top:8px;}',
    '.pb-form label{display:block;font-size:14px;font-weight:600;margin:4px 0;}',
    '.pb-form textarea{width:100%;box-sizing:border-box;min-height:76px;resize:vertical;padding:8px 10px;border:1px solid #D8C9A6;border-radius:8px;background:#fff;color:#13243A;font:inherit;font-size:16px;}',
    '.pb-form .count{font-size:12px;color:#4A5867;text-align:right;}',
    '.pb-form .chk{display:flex;gap:8px;align-items:flex-start;font-size:14px;margin:6px 0;}',
    '.pb-form .chk input{margin-top:3px;width:18px;height:18px;flex:none;}',
    '.pb-ok{font-size:14px;font-weight:700;color:#0F5B43;margin-top:6px;}',
    '.pb-err{font-size:14px;font-weight:700;color:#9B1C1C;margin-top:6px;}',
    '.pb-badge-fit{background:#0F5B43;color:#fff;}',
    '.pb-still{font-weight:700;color:#8A3B00;}',
    '.pb-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
    '.pb-chip{display:inline-block;padding:3px 10px;border-radius:999px;background:#fff;border:1px solid #9CCACA;color:#145757;font-family:Barlow,-apple-system,sans-serif;font-size:13px;font-weight:700;line-height:1.4;}',
    '.pb-chip-fit{background:#DDF1EA;border-color:#8FCBB4;color:#0F5B43;}',
    '.pb-coed{padding:4px 4px 2px;font-size:13px;line-height:1.5;color:#3B4A59;}',
    '.pb-post{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:2px 2px 4px;}',
    '.pb-post-sub{font-size:14px;color:#3B4A59;}',
    '.pb-panel{flex-basis:100%;margin-top:4px;padding:12px;border:1px solid #BFDCDC;border-radius:12px;background:#fff;font-family:Barlow,-apple-system,sans-serif;color:#13243A;}',
    '.pb-panel h4{margin:12px 0 6px;font-family:"Bebas Neue",sans-serif;font-weight:400;font-size:19px;letter-spacing:1.1px;color:#082A4F;}',
    '.pb-panel h4:first-child{margin-top:0;}',
    '.pb-field{margin:10px 0 0;}',
    '.pb-field>label,.pb-field>.pb-lab{display:block;font-size:14px;font-weight:700;margin:0 0 4px;}',
    '.pb-panel select,.pb-panel input[type=text],.pb-panel input[type=number],.pb-panel textarea{width:100%;box-sizing:border-box;min-height:44px;padding:8px 10px;border:1px solid #B9C7D3;border-radius:8px;background:#fff;color:#13243A;font:inherit;font-size:16px;}',
    '.pb-panel textarea{min-height:76px;resize:vertical;}',
    '.pb-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;}',
    '.pb-guest{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;gap:8px;align-items:center;margin-top:6px;}',
    '.pb-gbox{margin-top:8px;padding:8px;border:1px solid #DCE1E6;border-radius:10px;background:#fff;}',
    '.pb-gnames{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;}',
    '.pb-gnames label{display:block;font-size:13px;font-weight:700;margin:0 0 2px;}',
    '.pb-grow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;}',
    '.pb-grow select{flex:1 1 160px;width:auto;}',
    '.pb-gbox .pb-err{margin-top:4px;}',
    '@media (max-width:480px){.pb-gnames{grid-template-columns:minmax(0,1fr);}}',
    '.pb-hint{font-size:13px;line-height:1.45;color:#4A5867;margin-top:4px;}',
    '.pb-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:4px 0 8px;}',
    '.pb-seg button{min-height:44px;border:1.5px solid #082A4F;border-radius:10px;background:#fff;color:#082A4F;font-family:Barlow,-apple-system,sans-serif;font-size:15px;font-weight:700;cursor:pointer;}',
    '.pb-seg button[aria-pressed=true]{background:#082A4F;color:#fff;}',
    '.pb-seg button:focus-visible,.pb-panel select:focus-visible,.pb-panel input:focus-visible,.pb-panel textarea:focus-visible{outline:3px solid #0081AB;outline-offset:2px;}',
    '.pb-fitlist{display:flex;flex-direction:column;gap:8px;}',
    '.pb-panel input[type=search]{width:100%;box-sizing:border-box;min-height:44px;padding:8px 12px;border:1px solid #B9C7D3;border-radius:22px;background:#fff;color:#13243A;font:inherit;font-size:16px;}',
    '.pb-results{display:flex;flex-direction:column;gap:6px;margin-top:6px;}',
    '.pb-res{display:flex;align-items:center;gap:10px;min-height:52px;padding:4px 4px 4px 10px;border:1px solid #DCE1E6;border-radius:10px;background:#fff;}',
    '.pb-res-who{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;}',
    '.pb-res-hint{font-size:13px;color:#4A5867;}',
    '.pb-res .pb-gold{min-width:76px;}',
    '.pb-xchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
    '.pb-xchip{display:inline-flex;align-items:center;gap:2px;min-height:44px;padding:0 4px 0 12px;border-radius:22px;background:#E6F2F2;border:1px solid #9CCACA;color:#13243A;font-family:Barlow,-apple-system,sans-serif;font-size:14px;font-weight:700;}',
    '.pb-xchip.pb-you{padding:0 14px;background:#082A4F;border-color:#082A4F;color:#fff;}',
    '.pb-xchip-name{overflow-wrap:anywhere;}',
    '.pb-divider{display:flex;align-items:center;gap:10px;margin:14px 0 8px;font-family:"Bebas Neue",sans-serif;font-size:18px;letter-spacing:1.1px;color:#082A4F;}',
    '.pb-divider:before,.pb-divider:after{content:"";flex:1;height:1px;background:#BFDCDC;}',
  ].join('\n');
  function ensureStyles(){
    if(document.getElementById('cs-pb-css')) return;
    const s = document.createElement('style');
    s.id = 'cs-pb-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function goldBtn(text, onClick){ return btn('pb-gold', text, onClick); }
  function goldLink(text, href){ return link('pb-gold', text, href); }
  function quietBtn(text, onClick){ return btn('pb-quiet', text, onClick); }
  function quietLink(text, href, external){
    const a = link('pb-quiet', text, href);
    if(external){ a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; }
    return a;
  }
  // A section with its band: kind 'teams' or 'players'. Returns { sec, list }. With no
  // count (still loading) the band shows the title alone.
  function section(kind, title, count){
    ensureStyles();
    const sec = el('section', 'pb-sec pb-sec-' + kind);
    sec.appendChild(el('h3', 'pb-band', title + (count == null ? '' : ' (' + count + ')')));
    const list = el('div', 'pb-list');
    sec.appendChild(list);
    return { sec: sec, list: list };
  }
  function emptyLine(text){ return el('div', 'pb-empty', text); }
  function badge(kind, text){ return el('span', 'pb-badge pb-badge-' + kind, text); }
  // 'a woman', 'a man', or 'a woman and a man'.
  function stillText(list){ return (list || []).map(g => g === 'woman' ? 'a woman' : 'a man').join(' and '); }
  function chips(list, cls){
    const row = el('div', 'pb-chips');
    (list || []).forEach(x => row.appendChild(el('span', 'pb-chip' + (cls ? ' ' + cls : ''), x)));
    return row;
  }
  // One team: o { members, guests, need, status, sub, sizeNote, mine, goodFit, needs,
  // note, avg, stillNeeds }. Returns the card and its slots: act (the button column),
  // out (messages) and box (a compose box).
  function teamCard(o){
    ensureStyles();
    const done = o.status === 'complete';
    const card = el('div', 'pb-card pb-team' + (o.mine ? ' pb-mine' : '') + (done ? ' pb-complete' : ''));
    const main = el('div', 'pb-main');
    const name = el('div', 'pb-name', teamNames(o).join(' + '));
    if(o.mine) name.appendChild(badge('team', 'Your team'));
    if(done) name.appendChild(badge('done', 'Team complete'));
    if(o.goodFit && !done) name.appendChild(badge('fit', 'Good fit'));
    main.appendChild(name);
    if(!done) main.appendChild(el('div', 'pb-sub pb-need', 'Looking for ' + o.need + ' more'));
    if(o.stillNeeds && o.stillNeeds.length) main.appendChild(el('div', 'pb-sub pb-still', 'Still needs ' + stillText(o.stillNeeds)));
    if(o.sub) main.appendChild(el('div', 'pb-sub', o.sub));
    if(o.avg) main.appendChild(el('div', 'pb-sub', 'Avg ' + o.avg.avg + ' (' + o.avg.rated + ' of ' + o.avg.total + ' rated)'));
    if(o.needs && o.needs.length && !done){
      const lab = el('div', 'pb-sub', 'Looking for:');
      main.appendChild(lab);
      main.appendChild(chips(o.needs));
    }
    if(o.note && !done) main.appendChild(el('div', 'pb-note', '“' + o.note + '”'));
    if(o.sizeNote) main.appendChild(el('div', 'pb-sub', o.sizeNote));
    card.appendChild(main);
    const act = el('div', 'pb-act');
    card.appendChild(act);
    const out = el('div', 'pb-box');
    card.appendChild(out);
    const box = el('div', 'pb-box');
    card.appendChild(box);
    return { card: card, main: main, act: act, out: out, box: box };
  }
  // One player: o { name, rating, lines: [string], note, mine }. Same slots.
  function playerCard(o){
    ensureStyles();
    const card = el('div', 'pb-card pb-player' + (o.mine ? ' pb-mine' : ''));
    const main = el('div', 'pb-main');
    const name = el('div', 'pb-name', o.name);
    if(typeof o.rating === 'number') name.appendChild(badge('rating', String(o.rating)));
    if(o.mine) name.appendChild(badge('you', 'You'));
    main.appendChild(name);
    (o.lines || []).forEach(l => main.appendChild(el('div', 'pb-sub', l)));
    if(o.note) main.appendChild(el('div', 'pb-note', '“' + o.note + '”'));
    card.appendChild(main);
    const act = el('div', 'pb-act');
    card.appendChild(act);
    const box = el('div', 'pb-box');
    card.appendChild(box);
    return { card: card, main: main, act: act, box: box };
  }

  // ── Sign-up tags from the board's divisions (reg, opensAt, closesAt) ─────────
  function fmtEastern(ms){
    try { return new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch(e){ return ''; }
  }
  // The tag one division shows, the way the tournament page shows it: its sign-up
  // time when one is set, else Sign-ups not open yet when somebody marked it, else
  // nothing. { kind: 'soon'|'open'|'closed', text } or null.
  function divTag(d, now){
    if(!d) return null;
    now = now || Date.now();
    const o = typeof d.opensAt === 'number' ? d.opensAt : null, c = typeof d.closesAt === 'number' ? d.closesAt : null;
    if(o !== null || c !== null){
      if(o !== null && now < o) return { kind: 'soon', text: 'Sign-ups open ' + fmtEastern(o), at: o };
      if(c !== null && now >= c) return { kind: 'closed', text: 'Sign-ups closed' };
      return { kind: 'open', text: 'Sign-ups open' };
    }
    if(d.reg === 'advertised') return { kind: 'soon', text: 'Sign-ups not open yet' };
    return null;
  }
  // One tag for a whole tournament: open when any division is open, else the
  // soonest opening, else closed when every tagged division is closed.
  function trnTag(divisions, now){
    const tags = (divisions || []).map(d => divTag(d, now)).filter(Boolean);
    if(!tags.length) return null;
    if(tags.some(x => x.kind === 'open')) return { kind: 'open', text: 'Sign-ups open' };
    const soon = tags.filter(x => x.kind === 'soon').sort((a, b) => (a.at || Infinity) - (b.at || Infinity));
    if(soon.length) return soon[0];
    return { kind: 'closed', text: 'Sign-ups closed' };
  }
  function tagEl(tag){ ensureStyles(); return tag ? el('span', 'pb-tag pb-tag-' + tag.kind, tag.text) : null; }

  // ── The request strip ───────────────────────────────────────────────────────
  // The viewer's open requests on one tournament (/partners/me requests[tid]), at the
  // top of its card. Theirs to answer: "Ana B. said maybe: Can we play Upper?" with
  // Yes / Maybe / No / Ignore. Picking one only opens its form; Send posts it. Maybe
  // needs a note; Ignore sends nothing to the other side. Theirs to wait on: "Waiting
  // on Ana B." ctx: { me, token, onDone(result, message) }; message says what
  // happened, for a page that redraws the strip at once.
  const ANSWERS = [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No'], ['ignore', 'Ignore']];
  const SEND_TEXT = { yes: 'Send yes', maybe: 'Send maybe', no: 'Send no thanks', ignore: 'Ignore it' };
  function answerForm(q, ctx, row){
    const wrap = el('div');
    const opts = el('div', 'pb-answers');
    const form = el('div', 'pb-form');
    form.style.display = 'none';
    const lab = el('label');
    const t = textBox('');
    const adult = adultBox(ctx.me);
    const out = el('div');
    let choice = '';
    const send = goldBtn('Send', async function(){
      out.textContent = '';
      if(choice === 'maybe' && !t.ta.value.trim()){ out.appendChild(el('div', 'pb-err', 'Add your question or condition for a maybe.')); return; }
      // Only Yes and Maybe need the 18+ box; No and Ignore never do.
      const needsAdult = choice === 'yes' || choice === 'maybe';
      if(adult && needsAdult && !adult.cb.checked){ out.appendChild(el('div', 'pb-err', 'Please confirm you are 18 or older.')); return; }
      send.disabled = true;
      const x = await post('/partners/team/respond', { reqId: q.id, answer: choice, text: choice === 'ignore' ? '' : t.ta.value, adultConfirmed: adult && needsAdult ? adult.cb.checked : undefined }, ctx.token);
      send.disabled = false;
      if(!x.j.ok){ out.appendChild(el('div', 'pb-err', x.j.error || 'That did not work. Try again.')); return; }
      if(ctx.me && needsAdult) ctx.me.adult = true;
      const said = choice === 'yes' && x.j.combined
        ? (x.j.complete ? 'You said yes. Your teams combined and the team is complete.' : 'You said yes. Your teams combined' + (x.j.need ? ', looking for ' + x.j.need + ' more.' : '.'))
        : choice === 'yes'
        ? (x.j.complete ? 'You said yes. Your team is complete.' : 'You said yes. You are a team' + (x.j.need ? ', looking for ' + x.j.need + ' more.' : '.'))
        : choice === 'maybe' ? 'Sent. It is their turn to answer now.'
          : choice === 'no' ? 'You said no thanks. They have been told.'
            : 'Ignored. Nothing was sent to them.';
      row.textContent = '';
      row.appendChild(el('div', 'pb-ok', said));
      if(ctx.onDone) ctx.onDone(x.j, said);
    });
    function pick(a){
      choice = a;
      out.textContent = '';
      Array.prototype.forEach.call(opts.childNodes, b => {
        b.className = 'pb-ans' + (b.dataset.a === 'yes' ? ' pb-yes' : '') + (b.dataset.a === choice ? ' pb-sel' : '');
        b.setAttribute('aria-pressed', b.dataset.a === choice ? 'true' : 'false');
      });
      const quiet = a === 'ignore';
      lab.textContent = a === 'maybe' ? 'Your question or condition (they see it)' : 'Add a message (optional)';
      t.ta.placeholder = a === 'maybe' ? 'Ask a question or set a condition' : 'Add a message (optional)';
      [lab, t.ta, t.count].forEach(n => { n.style.display = quiet ? 'none' : ''; });
      if(adult) adult.lab.style.display = (a === 'yes' || a === 'maybe') ? '' : 'none';
      send.textContent = SEND_TEXT[a];
      form.style.display = '';
      if(!quiet) t.ta.focus();
    }
    ANSWERS.forEach(a => {
      const b = btn('pb-ans' + (a[0] === 'yes' ? ' pb-yes' : ''), a[1], function(){ pick(a[0]); });
      b.dataset.a = a[0];
      b.setAttribute('aria-pressed', 'false');
      opts.appendChild(b);
    });
    wrap.appendChild(opts);
    form.appendChild(lab); form.appendChild(t.ta); form.appendChild(t.count);
    if(adult) form.appendChild(adult.lab);
    const bs = el('div', 'pb-quiets');
    bs.appendChild(send);
    form.appendChild(bs);
    form.appendChild(out);
    wrap.appendChild(form);
    return wrap;
  }
  function requestRow(q, ctx){
    const row = el('div', 'pb-req');
    const line = el('div', 'pb-req-line');
    if(q.yourTurn){
      line.appendChild(document.createTextNode(q.label + (q.note ? ': ' : '')));
      if(q.note) line.appendChild(el('span', 'pb-req-note', q.note));
    } else {
      // Short names already end in a period ("Ana B.").
      const who = q.waitingOn || 'them';
      line.textContent = 'Waiting on ' + who + (/\.$/.test(who) ? '' : '.');
    }
    row.appendChild(line);
    const sub = [q.yourTurn ? '' : q.label, q.divLabel || ''].filter(Boolean).join(' · ');
    if(sub) row.appendChild(el('div', 'pb-req-sub', sub));
    if(!q.yourTurn && q.note) row.appendChild(el('div', 'pb-req-sub', 'Last note: ' + q.note));
    // Combine teams: who the one team would be.
    if(q.combine) row.appendChild(el('div', 'pb-req-sub', 'Together: ' + (q.combine.toNames || []).concat(q.combine.fromNames || []).join(' + ') + ' (makes ' + q.combine.filled + ' of ' + q.combine.size + ')'));
    if(q.yourTurn) row.appendChild(answerForm(q, ctx, row));
    const links = el('div', 'pb-quiets');
    links.appendChild(quietLink('Open the conversation', threadHref(q.threadId)));
    const out = el('div');
    if(!q.yourTurn && q.canWithdraw){
      links.appendChild(quietBtn('Withdraw request', async function(){
        out.textContent = '';
        const x = await post('/partners/team/withdraw', { reqId: q.id }, ctx.token);
        if(!x.j.ok){ out.appendChild(el('div', 'pb-err', x.j.error || 'That did not work. Try again.')); return; }
        row.textContent = '';
        row.appendChild(el('div', 'pb-ok', 'Request withdrawn.'));
        if(ctx.onDone) ctx.onDone(x.j, 'Request withdrawn.');
      }));
    }
    row.appendChild(links);
    row.appendChild(out);
    return row;
  }
  // null when there is nothing open.
  function requestStrip(list, ctx){
    if(!list || !list.length) return null;
    ensureStyles();
    const strip = el('div', 'pb-strip');
    strip.setAttribute('role', 'region');
    const mineToAnswer = list.filter(q => q.yourTurn).length;
    const head = mineToAnswer ? (mineToAnswer === 1 ? 'Waiting on your answer' : mineToAnswer + ' requests waiting on your answer') : 'Your requests';
    strip.setAttribute('aria-label', head);
    strip.appendChild(el('div', 'pb-strip-h', head));
    // Theirs to answer first, then the ones waiting on someone else.
    list.slice().sort((a, b) => (b.yourTurn ? 1 : 0) - (a.yourTurn ? 1 : 0)).forEach(q => strip.appendChild(requestRow(q, ctx)));
    return strip;
  }

  // ── Teams looking for players, shared by /partners/ and the pickup tournament page ──
  // Post your team, the team cards (members and guests, needs as chips, average rating,
  // Still needs a woman or a man), Edit team for members, Good fit for a viewer who is
  // free that day, and under the viewer's own forming team: a gender filter, Players who
  // fit, Others in the pool and, on club listings, Club members not on a team.
  // Everything comes from the board and /partners/me (with the tournament id); fit is
  // worked out by the worker, never here.
  //
  // ctx: { me, token, extras, mine, signedIn, canMessage, dayLabel(day), signIn(text),
  //        onChanged(message), onGender(g), compose(host, opts, key), reattach(host, key),
  //        threadOf(ref), leave(tm, out), askToJoin(card, d, tm, combine?), eventLink }
  // askToJoin gets combine (a /partners/me combinable entry) for Ask to combine.
  // Open forms live in openForms by key, so a page that redraws (the pickup page does on
  // every data change) puts the same form back, typed values and all.
  const COED_NOTE = 'Coed divisions are not rated. Ratings shown come from men’s and women’s play, so they are not a guide to coed level.';
  const openForms = {};
  function keepForm(key, host, build){
    let f = openForms[key];
    if(f && !f.isConnected && !f._open) { delete openForms[key]; f = null; }
    if(!f){ f = build(); f._open = true; openForms[key] = f; }
    host.appendChild(f);
    return f;
  }
  function closeForm(key){ const f = openForms[key]; if(f){ f._open = false; f.remove(); delete openForms[key]; } }
  function toggleForm(key, host, build){ if(openForms[key]) closeForm(key); else keepForm(key, host, build); }
  // A form drawn before its data arrived (_stale) is built again from rebuild.
  function restoreForm(key, host, rebuild){
    let f = openForms[key];
    if(!f || !f._open) return;
    if(f._stale && rebuild){ f.remove(); f = rebuild(); f._open = true; openForms[key] = f; }
    if(!host.contains(f)) host.appendChild(f);
  }

  function field(labelText, control, hint){
    const f = el('div', 'pb-field');
    const lab = el('label', null, labelText);
    if(control.id) lab.htmlFor = control.id;
    f.appendChild(lab);
    f.appendChild(control);
    if(hint) f.appendChild(el('div', 'pb-hint', hint));
    return f;
  }
  let uid = 0;
  function select(options, value){
    const s = el('select');
    s.id = 'pbf' + (++uid);
    options.forEach(o => { const op = el('option', null, o[1]); op.value = o[0]; s.appendChild(op); });
    if(value != null) s.value = value;
    return s;
  }
  function input(type, value, attrs){
    const i = el('input');
    i.type = type;
    i.id = 'pbf' + (++uid);
    if(value != null) i.value = value;
    Object.keys(attrs || {}).forEach(k => i.setAttribute(k, attrs[k]));
    return i;
  }
  const GUEST_GENDERS = [['unknown', 'Gender not set'], ['woman', 'Woman'], ['man', 'Man']];

  // A guest's names: First name and Last name side by side (stacked on a phone), each
  // required, with its own inline error. Returns { box, first, last, read(), check() }:
  // check() marks what is missing and returns false; read() gives the trimmed values.
  function guestNames(firstVal, lastVal, labelFor){
    const box = el('div', 'pb-gnames');
    const mk = (text, val) => {
      const w = el('div');
      const i = input('text', val || '', { maxlength: '20', autocomplete: 'off', autocapitalize: 'words' });
      const l = el('label', null, text); l.htmlFor = i.id;
      const e = el('div', 'pb-err'); e.style.display = 'none';
      i.setAttribute('aria-label', text + (labelFor ? ' for ' + labelFor : ''));
      i.addEventListener('input', function(){ e.style.display = 'none'; i.removeAttribute('aria-invalid'); });
      w.appendChild(l); w.appendChild(i); w.appendChild(e);
      box.appendChild(w);
      return { i: i, e: e, text: text };
    };
    const first = mk('First name', firstVal), last = mk('Last name', lastVal);
    return { box: box, first: first.i, last: last.i,
      read: function(){ return { firstName: first.i.value.trim(), lastName: last.i.value.trim() }; },
      check: function(){
        let ok = true;
        [first, last].forEach(x => { if(!x.i.value.trim()){ ok = false; x.e.textContent = 'Add a ' + x.text.toLowerCase() + '.'; x.e.style.display = ''; x.i.setAttribute('aria-invalid', 'true'); } });
        return ok;
      } };
  }

  // The needs fields, prefilled from n, in the order players think about them: Gender,
  // Position, Side, Dominant hand, Rating from and to, Note. read() returns the body
  // the worker takes ('either' and blanks mean not stated).
  function needsFields(n){
    n = n || {};
    const wrap = el('div');
    const gen = select([['either', 'Either'], ['woman', 'Woman'], ['man', 'Man']], n.gender || 'either');
    const pos = select([['either', 'Either'], ['blocker', 'Blocker'], ['defender', 'Defender']], n.position || 'either');
    const side = select([['either', 'Either'], ['left', 'Left'], ['right', 'Right']], n.side || 'either');
    const hand = select([['either', 'Either'], ['left', 'Left'], ['right', 'Right']], n.hand || 'either');
    const lo = input('number', n.ratingMin != null ? n.ratingMin : '', { inputmode: 'numeric', min: '0', max: '4000', placeholder: 'Lowest' });
    const hi = input('number', n.ratingMax != null ? n.ratingMax : '', { inputmode: 'numeric', min: '0', max: '4000', placeholder: 'Highest' });
    const note = el('textarea'); note.id = 'pbf' + (++uid); note.maxLength = 300; note.value = n.note || '';
    note.placeholder = 'Anything else players should know (optional)';
    const pair = (a, b) => { const r = el('div', 'pb-two'); r.appendChild(a); r.appendChild(b); return r; };
    wrap.appendChild(pair(field('Gender', gen), field('Position', pos)));
    wrap.appendChild(pair(field('Side', side), field('Dominant hand', hand)));
    wrap.appendChild(pair(field('Rating from', lo), field('Rating to', hi)));
    wrap.appendChild(field('Note', note, 'Up to 300 characters. Links, emails and phone numbers are removed.'));
    return { wrap: wrap, read: function(){
      return { gender: gen.value, position: pos.value, side: side.value, hand: hand.value, ratingMin: lo.value.trim(), ratingMax: hi.value.trim(), note: note.value };
    } };
  }
  function errLine(out, text){ out.textContent = ''; out.appendChild(el('div', 'pb-err', text)); }
  function okLine(out, text){ out.textContent = ''; out.appendChild(el('div', 'pb-ok', text)); }
  function spotsNote(size){ return 'Teams here are ' + size + 's, so you can add up to ' + (size - 1) + ' people.'; }

  // A removable person: "Ana B." with a Remove button (a full 44px target).
  function xchip(text, btnText, onRemove, label){
    const c = el('div', 'pb-xchip');
    c.appendChild(el('span', 'pb-xchip-name', text));
    const b = quietBtn(btnText, onRemove);
    b.setAttribute('aria-label', label || (btnText + ' ' + text));
    c.appendChild(b);
    return c;
  }

  // Search CourtSense players by name (POST /partners/search). Each result is a row
  // with Add. getDiv(): the division searched for; taken(ref): already added.
  function searchBox(t, getDiv, ctx, onAdd, taken){
    const box = el('div', 'pb-search');
    const q = input('search', '', { placeholder: 'Search by name', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search CourtSense players by name' });
    box.appendChild(q);
    const list = el('div', 'pb-results');
    list.setAttribute('role', 'status');
    box.appendChild(list);
    let timer = null, seq = 0;
    async function run(){
      const text = q.value.trim();
      const my = ++seq;
      list.textContent = '';
      if(text.replace(/[^A-Za-z]/g, '').length < 2){ if(text) list.appendChild(el('div', 'pb-hint', 'Type at least 2 letters of their name.')); return; }
      list.appendChild(el('div', 'pb-hint', 'Searching...'));
      const r = await post('/partners/search', { tid: t.id, div: getDiv(), q: text }, ctx.token);
      if(my !== seq) return;
      list.textContent = '';
      if(!r.j.ok){ list.appendChild(el('div', 'pb-err', r.j.error || 'Search did not work. Try again.')); return; }
      const hits = r.j.results || [];
      if(!hits.length){ list.appendChild(el('div', 'pb-hint', 'No players found. They may already be on a team that day, or not on CourtSense yet (add them as a guest).')); return; }
      hits.forEach(h => {
        const row = el('div', 'pb-res');
        const who = el('div', 'pb-res-who');
        who.appendChild(el('span', 'pb-name', h.display));
        if(h.hint) who.appendChild(el('span', 'pb-res-hint', h.hint));
        row.appendChild(who);
        if(taken(h.ref)) row.appendChild(el('span', 'pb-res-hint', 'Added'));
        else row.appendChild(goldBtn('Add', function(){ onAdd(h, row); }));
        list.appendChild(row);
      });
    }
    q.addEventListener('input', function(){ clearTimeout(timer); timer = setTimeout(run, 300); });
    q.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); clearTimeout(timer); run(); } });
    return { box: box, input: q, clear: function(){ q.value = ''; list.textContent = ''; } };
  }

  // ── Post your team ─────────────────────────────────────────────────────────
  // Three steps. 1 Your team: the poster, always on it. 2 Add people you are already
  // playing with: CourtSense players by search (each gets "<Name> added you to their
  // team" and joins only after Yes) and guests by first name. 3 Who you need. Pool
  // players are never listed here and nobody is contacted unless a member adds or
  // invites them; Players who fit shows under the team once it is posted.
  function postForm(t, divs, ctx, key){
    const f = el('div', 'pb-panel');
    f.setAttribute('role', 'group');
    f.setAttribute('aria-label', 'Post your team');
    let div = divs[0];
    const added = [];  // { ref, display }
    const guests = []; // { name, gender }
    const spots = () => div.size - 1;
    const used = () => added.length + guests.length;
    const out = el('div');
    const room = el('div', 'pb-hint');

    f.appendChild(el('h4', null, '1. Your team'));
    const pickDiv = divs.length > 1 ? select(divs.map(d => [d.div, ctx.dayLabel(d.day) + ': ' + d.label + ' (' + d.size + 's)']), div.div) : null;
    if(pickDiv) f.appendChild(field('Division', pickDiv));
    else f.appendChild(el('div', 'pb-post-sub', ctx.dayLabel(div.day) + ': ' + div.label + ' (' + div.size + 's)'));
    const youRow = el('div', 'pb-xchips');
    youRow.appendChild(el('div', 'pb-xchip pb-you', 'You (' + ((ctx.me && ctx.me.display) || 'you') + ')'));
    f.appendChild(youRow);

    f.appendChild(el('h4', null, '2. Add people you are already playing with'));
    f.appendChild(el('div', 'pb-hint', 'Find them on CourtSense. They get a message that you added them, and they join once they say yes.'));
    const chips = el('div', 'pb-xchips');
    const s = searchBox(t, () => div.div, ctx, function(h, row){
      out.textContent = '';
      if(used() >= spots()){ errLine(out, spotsNote(div.size)); return; }
      added.push({ ref: h.ref, display: h.display });
      row.lastChild.replaceWith(el('span', 'pb-res-hint', 'Added'));
      draw();
    }, ref => added.some(a => a.ref === ref));
    f.appendChild(s.box);
    f.appendChild(chips);
    const guestsBox = el('div', 'pb-field');
    f.appendChild(guestsBox);

    function guestRow(g){
      const r = el('div', 'pb-gbox');
      const n = guestNames(g.firstName, g.lastName, 'guest ' + (guests.indexOf(g) + 1));
      g.check = n.check;
      n.first.addEventListener('input', function(){ g.firstName = n.first.value; });
      n.last.addEventListener('input', function(){ g.lastName = n.last.value; });
      r.appendChild(n.box);
      const row = el('div', 'pb-grow');
      const gen = select(GUEST_GENDERS, g.gender);
      gen.setAttribute('aria-label', 'Guest gender');
      gen.addEventListener('change', function(){ g.gender = gen.value; });
      row.appendChild(gen);
      row.appendChild(quietBtn('Remove', function(){ guests.splice(guests.indexOf(g), 1); draw(); }));
      r.appendChild(row);
      return r;
    }
    function draw(){
      chips.textContent = '';
      added.forEach(a => chips.appendChild(xchip(a.display + ' (gets an invite)', 'Remove', function(){ added.splice(added.indexOf(a), 1); s.clear(); draw(); }, 'Remove ' + a.display)));
      guestsBox.textContent = '';
      guestsBox.appendChild(el('div', 'pb-lab', 'Not on CourtSense?'));
      guests.forEach(g => guestsBox.appendChild(guestRow(g)));
      guestsBox.appendChild(quietBtn('Add a guest', function(){
        out.textContent = '';
        if(used() >= spots()){ errLine(out, spotsNote(div.size)); return; }
        guests.push({ firstName: '', lastName: '', gender: 'unknown' });
        draw();
        const last = guestsBox.querySelectorAll('input[type=text]');
        if(last.length) last[last.length - 1].focus();
      }));
      guestsBox.appendChild(el('div', 'pb-hint', 'Guests fill a spot right away and are never messaged. Other players see a guest as first name and last initial.'));
      const left = div.size - 1 - guests.length;
      room.textContent = left > 0 ? 'After posting, your team is looking for ' + left + ' more' + (added.length ? ' until your invites say yes.' : '.') : 'Your team is full with your guests.';
    }
    if(pickDiv) pickDiv.addEventListener('change', function(){
      div = divs.filter(d => d.div === pickDiv.value)[0] || divs[0];
      added.length = 0;
      while(guests.length > spots()) guests.pop();
      s.clear();
      draw();
    });

    f.appendChild(el('h4', null, '3. Who you need'));
    const nf = needsFields(null);
    f.appendChild(nf.wrap);
    const adult = adultBox(ctx.me);
    if(adult) f.appendChild(adult.lab);
    f.appendChild(room);
    const bs = el('div', 'pb-quiets');
    const send = goldBtn('Post your team', async function(){
      out.textContent = '';
      if(adult && !adult.cb.checked){ errLine(out, 'Please confirm you are 18 or older.'); return; }
      const bad = guests.filter(g => g.check && !g.check()).length;
      if(bad){ errLine(out, 'Add a first and last name for each guest, or remove the empty one.'); return; }
      send.disabled = true;
      const r = await post('/partners/team/start', { tid: t.id, div: div.div, guests: guests.map(g => ({ firstName: (g.firstName || '').trim(), lastName: (g.lastName || '').trim(), gender: g.gender })), addRefs: added.map(a => a.ref), needs: nf.read(), adultConfirmed: adult ? adult.cb.checked : undefined }, ctx.token);
      send.disabled = false;
      if(!r.j.ok){ errLine(out, r.j.error || 'That did not post. Try again.'); return; }
      if(ctx.me) ctx.me.adult = true;
      const res = r.j.invites || [];
      const sent = [], failed = [];
      added.forEach((a, i) => { const x = res[i] || {}; if(x.ok) sent.push(a.display); else failed.push(a.display + ': ' + (x.error || 'not sent')); });
      const msg = 'Your team is posted.' + (sent.length ? ' ' + sent.join(', ') + ' got your invite.' : '');
      closeForm(key);
      if(failed.length) ctx.onChanged(msg + ' Not sent: ' + failed.join('; '), true);
      else ctx.onChanged(msg);
    });
    bs.appendChild(send);
    bs.appendChild(quietBtn('Cancel', function(){ closeForm(key); }));
    f.appendChild(bs);
    f.appendChild(out);
    draw();
    return f;
  }

  // ── Edit team: add people by search, guests and needs, by any member ────────
  function editForm(t, tm, ctx, key){
    const X = ctx.extras || {};
    const detail = (X.myTeams || {})[tm.ref];
    const f = el('div', 'pb-panel');
    f.setAttribute('role', 'group');
    f.setAttribute('aria-label', 'Edit team');
    if(!detail){ f.appendChild(el('div', 'pb-hint', 'Loading your team...')); f._stale = true; return f; }
    const out = el('div');
    const edit = async function(body, done){
      out.textContent = '';
      const r = await post('/partners/team/edit', Object.assign({ tid: t.id, teamRef: tm.ref }, body), ctx.token);
      if(!r.j.ok){ errLine(out, r.j.error || 'That did not save. Try again.'); return false; }
      const inv = (r.j.invites || [])[0];
      if(inv && !inv.ok){ errLine(out, inv.error || 'That invite did not go out.'); return false; }
      // Drawn again from the refreshed team on the next redraw.
      f._stale = true;
      okLine(out, done);
      ctx.onChanged(done);
      return true;
    };
    const room = () => detail.size - detail.filled;
    f.appendChild(el('h4', null, 'Add people you are already playing with'));
    if(room() > 0){
      const s = searchBox(t, () => detail.div, ctx, async function(h, row){
        row.lastChild.disabled = true;
        const ok = await edit({ addRefs: [h.ref] }, h.display + ' got your invite.');
        if(ok){ row.lastChild.replaceWith(el('span', 'pb-res-hint', 'Invited')); s.clear(); }
        else row.lastChild.disabled = false;
      }, ref => false);
      f.appendChild(s.box);
    } else f.appendChild(el('div', 'pb-hint', 'Your team is full.'));
    f.appendChild(el('div', 'pb-lab', 'Guests'));
    (detail.guests || []).forEach(g => {
      const r = el('div', 'pb-gbox');
      const first = g.firstName || g.name || '';
      // A guest saved before last names were asked: the last name comes first.
      const legacy = !g.lastName;
      const n = legacy ? guestNames(first, '', first) : null;
      if(n){ r.appendChild(n.box); r.appendChild(el('div', 'pb-hint', 'Add a last name for ' + first + ' to save any change.')); }
      else r.appendChild(el('div', 'pb-name', (first + ' ' + g.lastName).trim()));
      const row = el('div', 'pb-grow');
      const gen = select(GUEST_GENDERS, g.gender || 'unknown');
      gen.setAttribute('aria-label', 'Gender for ' + first);
      const save = function(extra){
        if(n && !n.check()){ gen.value = g.gender || 'unknown'; return; }
        const up = Object.assign({ key: g.key }, extra || {});
        if(n) Object.assign(up, n.read());
        edit({ guestUpdate: up }, 'Guest updated.');
      };
      gen.addEventListener('change', function(){ save({ gender: gen.value }); });
      row.appendChild(gen);
      if(n) row.appendChild(quietBtn('Save name', function(){ save({}); }));
      row.appendChild(quietBtn('Remove', function(){ edit({ removeGuest: g.key }, first + ' removed.'); }));
      r.appendChild(row);
      f.appendChild(r);
    });
    if(!(detail.guests || []).length) f.appendChild(el('div', 'pb-hint', 'No guests yet.'));
    if(room() > 0){
      const r = el('div', 'pb-gbox');
      const n = guestNames('', '', 'the new guest');
      r.appendChild(n.box);
      const row = el('div', 'pb-grow');
      const gen = select(GUEST_GENDERS, 'unknown');
      gen.setAttribute('aria-label', 'New guest gender');
      row.appendChild(gen);
      row.appendChild(quietBtn('Add guest', function(){
        if(!n.check()) return;
        edit({ addGuest: Object.assign(n.read(), { gender: gen.value }) }, 'Guest added.');
      }));
      r.appendChild(row);
      f.appendChild(r);
    }
    f.appendChild(el('h4', null, 'Who you need'));
    const nf = needsFields(detail.needs);
    f.appendChild(nf.wrap);
    const bs = el('div', 'pb-quiets');
    const save = goldBtn('Save', async function(){
      save.disabled = true;
      const ok = await edit({ needs: nf.read() }, 'Team updated.');
      save.disabled = false;
      if(ok) closeForm(key);
    });
    bs.appendChild(save);
    bs.appendChild(quietBtn('Close', function(){ closeForm(key); }));
    f.appendChild(bs);
    f.appendChild(out);
    return f;
  }

  // Invited and not answered yet, on the member's own card only: "Invited: Ana B."
  // with Cancel. The public board never has these.
  function invitedRow(t, tm, ctx, out){
    const detail = ((ctx.extras || {}).myTeams || {})[tm.ref];
    const list = (detail && detail.pending) || [];
    if(!list.length) return null;
    const wrap = el('div');
    wrap.appendChild(el('div', 'pb-sub', 'Invited, waiting for a yes:'));
    const row = el('div', 'pb-xchips');
    list.forEach(p => row.appendChild(xchip('Invited: ' + p.name, 'Cancel', async function(){
      out.textContent = '';
      const r = await post('/partners/team/edit', { tid: t.id, teamRef: tm.ref, cancelInvite: p.reqId }, ctx.token);
      if(!r.j.ok){ errLine(out, r.j.error || 'That did not cancel. Try again.'); return; }
      ctx.onChanged('Invite to ' + p.name + ' cancelled.');
    }, 'Cancel the invite to ' + p.name)));
    wrap.appendChild(row);
    return wrap;
  }

  // ── Who fits the viewer's own forming team ─────────────────────────────────
  function matchCard(m, tm, d, t, ctx){
    const c = playerCard({ name: m.display, rating: m.rating });
    if(m.badges && m.badges.length) c.main.appendChild(chips(m.badges, 'pb-chip-fit'));
    const key = 'm:' + tm.ref + ':' + m.ref;
    if(ctx.canMessage) c.act.appendChild(goldBtn('Invite to your team', function(){
      ctx.compose(c.box, { tid: t.id, ref: m.ref, divs: [{ div: m.div, label: d.label }], optional: true, title: inviteTitle(m.display, tm), prompt: 'Add a note (optional)', placeholder: 'Say hi and why they would fit the team.', sendText: 'Send invite' }, key);
    }));
    ctx.reattach(c.box, key);
    return c.card;
  }
  function fitPanel(t, d, tm, ctx){
    const X = ctx.extras || {};
    const p = el('div', 'pb-panel');
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', 'Players for your team');
    p.appendChild(el('div', 'pb-lab', 'Show'));
    const seg = el('div', 'pb-seg');
    [['everyone', 'Everyone'], ['women', 'Women'], ['men', 'Men']].forEach(o => {
      const b = btn('', o[1], function(){ if((X.gender || 'everyone') !== o[0]) ctx.onGender(o[0]); });
      b.setAttribute('aria-pressed', (X.gender || 'everyone') === o[0] ? 'true' : 'false');
      seg.appendChild(b);
    });
    p.appendChild(seg);
    const list = (X.matches || {})[tm.ref] || [];
    const fit = list.filter(m => m.goodFit), others = list.filter(m => !m.goodFit);
    p.appendChild(el('h4', null, 'Players who fit'));
    const a = el('div', 'pb-fitlist');
    if(!fit.length) a.appendChild(emptyLine(tm.needs && tm.needs.length ? 'No one in the pool fits every need yet.' : 'Add what your team needs (Edit team) to see who fits best.'));
    fit.forEach(m => a.appendChild(matchCard(m, tm, d, t, ctx)));
    p.appendChild(a);
    p.appendChild(el('h4', null, 'Others in the pool'));
    const b2 = el('div', 'pb-fitlist');
    if(!others.length) b2.appendChild(emptyLine('No one else in the pool is looking in this division.'));
    others.forEach(m => b2.appendChild(matchCard(m, tm, d, t, ctx)));
    p.appendChild(b2);
    if(X.club){
      p.appendChild(el('div', 'pb-divider', 'Club members not on a team'));
      const cl = (X.clubMatches || {})[tm.ref] || [];
      const c3 = el('div', 'pb-fitlist');
      if(!cl.length) c3.appendChild(emptyLine('No other ' + X.club.label + ' members are free for this one.'));
      cl.forEach(m => c3.appendChild(matchCard(m, tm, d, t, ctx)));
      p.appendChild(c3);
    }
    return p;
  }

  function teamsSection(t, ctx){
    ensureStyles();
    const X = ctx.extras || {};
    const fits = X.teamFits || {};
    const mine = ctx.mine || [];
    const rows = [];
    (t.divisions || []).forEach(d => (d.teams || []).forEach(tm => rows.push([d, tm])));
    // The viewer's own forming team first (its fit lists sit under it), then good fits
    // for the viewer, then other forming teams, complete teams last.
    const rank = (r) => (r[1].status === 'complete' ? 3 : mine.indexOf(r[1].ref) !== -1 ? 0 : (fits[r[1].ref] && fits[r[1].ref].goodFit ? 1 : 2));
    rows.sort((a, b) => rank(a) - rank(b));
    const s = section('teams', 'Teams looking for players', rows.length);

    // Post your team, for a signed-in player free on at least one day here.
    const byDay = myTeamsByDay(t, mine);
    const today = new Date().toISOString().slice(0, 10);
    const free = (t.divisions || []).filter(d => !byDay[d.day] && d.day >= today);
    const postKey = 'post:' + t.id;
    if(ctx.signedIn && ctx.canMessage && ctx.me && ctx.me.teamsEnabled && free.length){
      const bar = el('div', 'pb-post');
      bar.appendChild(goldBtn('Post your team', function(){ toggleForm(postKey, slot, () => postForm(t, free, ctx, postKey)); }));
      bar.appendChild(el('span', 'pb-post-sub', 'Have a partner or two already? Post your team and say who you need.'));
      s.list.appendChild(bar);
      const slot = el('div');
      s.list.appendChild(slot);
      restoreForm(postKey, slot);
    } else if(!ctx.signedIn && ctx.signIn){
      const bar = el('div', 'pb-post');
      bar.appendChild(ctx.signIn('Sign in to post your team'));
      s.list.appendChild(bar);
    }
    if(!rows.length) s.list.appendChild(emptyLine('No teams yet. Post your team, or ask a player to team up.'));
    rows.forEach(([d, tm]) => {
      const mineTm = !!(tm.ref && mine.indexOf(tm.ref) !== -1);
      const fit = !mineTm && tm.ref ? fits[tm.ref] : null;
      const c = teamCard({
        members: tm.members, guests: tm.guests, need: tm.need, status: tm.status, mine: mineTm,
        goodFit: !!(fit && fit.goodFit), needs: tm.needs, note: tm.note, avg: tm.avg, stillNeeds: tm.stillNeeds,
        sub: ctx.dayLabel(d.day) + ': ' + d.label + ' (' + tm.size + 's)',
        sizeNote: tm.sizeChanged ? 'Formed as ' + tm.size + 's. The event now lists ' + t.teamSize + 's.' : '',
      });
      if(fit && fit.badges && fit.badges.length && tm.status !== 'complete'){
        c.main.appendChild(el('div', 'pb-sub', 'You fit:'));
        c.main.appendChild(chips(fit.badges, 'pb-chip-fit'));
      }
      if(mineTm){
        const th = ctx.threadOf ? ctx.threadOf(tm.ref) : '';
        if(th) c.act.appendChild(quietLink('Team conversation', threadHref(th)));
        if(ctx.signedIn){
          const editKey = 'edit:' + t.id + ':' + tm.ref;
          c.act.appendChild(quietBtn('Edit team', function(){ toggleForm(editKey, c.box, () => editForm(t, tm, ctx, editKey)); }));
          c.act.appendChild(ctx.leave(tm, c.out));
          const inv = invitedRow(t, tm, ctx, c.out);
          if(inv) c.main.appendChild(inv);
          restoreForm(editKey, c.box, () => editForm(t, tm, ctx, editKey));
        }
        if(tm.status === 'complete' && ctx.eventLink) c.act.appendChild(quietLink('Register', ctx.eventLink, true));
      } else if(tm.status === 'complete'){
        if(ctx.eventLink) c.act.appendChild(quietLink('Register', ctx.eventLink, true));
      } else if(tm.ref){
        // On a team that day already: only teams that fit with it get Ask to combine
        // (from /partners/me combinable); the rest get no button.
        const cb = (X.combinable || {})[tm.ref];
        if(!ctx.signedIn){ if(ctx.signIn) c.act.appendChild(ctx.signIn('Sign in to ask')); }
        else if(!(ctx.canMessage && ctx.me && ctx.me.teamsEnabled)){ /* nothing to offer */ }
        else if(byDay[d.day]){ if(cb) c.act.appendChild(goldBtn('Ask to combine', function(){ ctx.askToJoin(c, d, tm, cb); })); }
        else c.act.appendChild(goldBtn('Ask to join', function(){ ctx.askToJoin(c, d, tm); }));
      }
      if(tm.ref) ctx.reattach(c.box, 'team:' + tm.ref);
      s.list.appendChild(c.card);
      if(mineTm && tm.status !== 'complete' && ctx.signedIn && X.matches) s.list.appendChild(fitPanel(t, d, tm, ctx));
    });
    if((t.divisions || []).some(d => /^Coed/.test(d.label || ''))) s.list.appendChild(el('div', 'pb-coed', COED_NOTE));
    return s.sec;
  }

  global.CourtSensePartner = {
    storedToken, post, loadMe, textBox, adultBox, openCompose, threadHref, fetchBoard, myTeamsByDay, contactPlan, teamLine, teamNames, inviteTitle, combineTitle,
    ensureStyles, section, emptyLine, teamCard, playerCard, goldBtn, goldLink, quietBtn, quietLink, badge, divTag, trnTag, tagEl, requestStrip,
    teamsSection, COED_NOTE,
  };
})(window);
