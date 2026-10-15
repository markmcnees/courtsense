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
  // With tid the answer also carries pool: { poolKey: { ref, divs } } for that event.
  async function loadMe(token, tid){
    if(!token) return { me: null, reason: 'no_token' };
    const r = await post('/partners/me', tid ? { tid: tid } : null, token);
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
      if(tm.ref && mine.indexOf(tm.ref) !== -1) out[d.day] = { div: d.div, divLabel: d.label, ref: tm.ref, members: tm.members, need: tm.need, size: tm.size, status: tm.status };
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
  // 'Mark M. + Test A., looking for 2 more', or just the names when complete.
  function teamLine(tm){ return tm.members.join(' + ') + (tm.status === 'complete' ? '' : ', looking for ' + tm.need + ' more'); }
  function inviteTitle(name, tm){ return 'Invite ' + name + ' to join ' + tm.members.join(' + ') + ' (looking for ' + tm.need + ' more)'; }

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
  // One team: o { members, need, status, sub, sizeNote, mine }. Returns the card and
  // its slots: act (the button column), out (messages) and box (a compose box).
  function teamCard(o){
    ensureStyles();
    const done = o.status === 'complete';
    const card = el('div', 'pb-card pb-team' + (o.mine ? ' pb-mine' : '') + (done ? ' pb-complete' : ''));
    const main = el('div', 'pb-main');
    const name = el('div', 'pb-name', o.members.join(' + '));
    if(o.mine) name.appendChild(badge('team', 'Your team'));
    if(done) name.appendChild(badge('done', 'Team complete'));
    main.appendChild(name);
    if(!done) main.appendChild(el('div', 'pb-sub pb-need', 'Looking for ' + o.need + ' more'));
    if(o.sub) main.appendChild(el('div', 'pb-sub', o.sub));
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
      if(adult && choice !== 'ignore' && !adult.cb.checked){ out.appendChild(el('div', 'pb-err', 'Please confirm you are 18 or older.')); return; }
      send.disabled = true;
      const x = await post('/partners/team/respond', { reqId: q.id, answer: choice, text: choice === 'ignore' ? '' : t.ta.value, adultConfirmed: adult ? adult.cb.checked : undefined }, ctx.token);
      send.disabled = false;
      if(!x.j.ok){ out.appendChild(el('div', 'pb-err', x.j.error || 'That did not work. Try again.')); return; }
      if(ctx.me && choice !== 'ignore') ctx.me.adult = true;
      const said = choice === 'yes'
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
      if(adult) adult.lab.style.display = quiet ? 'none' : '';
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

  global.CourtSensePartner = {
    storedToken, post, loadMe, textBox, adultBox, openCompose, threadHref, fetchBoard, myTeamsByDay, contactPlan, teamLine, inviteTitle,
    ensureStyles, section, emptyLine, teamCard, playerCard, goldBtn, goldLink, quietBtn, quietLink, badge, divTag, trnTag, tagEl, requestStrip,
  };
})(window);
