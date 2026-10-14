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

  global.CourtSensePartner = { storedToken, post, loadMe, textBox, adultBox, openCompose, threadHref, fetchBoard, myTeamsByDay, contactPlan, teamLine, inviteTitle };
})(window);
