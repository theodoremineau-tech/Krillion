/* The Trench — client. Talks to /api (Netlify Function). */
(function () {
  'use strict';
  const FX = window.TrenchFX;
  const root = document.getElementById('app');
  const MAX_DEPTH = 10935;
  const TIER = {
    plankton: { name: 'Plankton', pts: 10 }, clever: { name: 'Too Clever', pts: 15 }, schooler: { name: 'Schooler', pts: 30 },
    rare: { name: 'Rare', pts: 60 }, deep: { name: 'Deep Cut', pts: 85 }, one: { name: 'One in a Million', pts: 100 },
    timeout: { name: 'Out of air', pts: 0 },
  };
  const TIER_LINES = {
    plankton: ['Everyone had that one.', 'Floating at the surface.', 'Safe, and shallow.'],
    clever: ['Clever. Just not rare.', 'Too clever by half.'],
    schooler: ['Swimming with the school.', 'A few fathoms down.'],
    rare: ['Now we’re descending.', 'Rare find.', 'Into the dark.'],
    deep: ['Deep cut.', 'The lights are going out.', 'Pressure’s building.'],
    one: ['One in a million.', 'Nobody saw that coming.', 'Bottom of the sea.'],
  };
  const ZONES = [[0, 'Surface'], [200, 'Sunlight zone'], [1000, 'Twilight zone'], [4000, 'Midnight zone'], [6000, 'Abyssal zone'], [MAX_DEPTH + 1, 'Hadal zone']];
  const zoneFor = m => { if (m <= 0) return 'Surface'; for (let i = 1; i < ZONES.length; i++) if (m <= ZONES[i][0]) return ZONES[i][1]; return 'Hadal zone'; };

  const PRACTICE = window.TRENCH_PRACTICE || null;   // practice build: in-page server, nothing saved
  let token = null;
  if (!PRACTICE) { try { token = localStorage.getItem('trench.token'); } catch (e) { /* storage blocked */ } }
  let me = null, st = null, board = null, boardTab = 'today', timer = null, runId = 0;

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function mount(...nodes) { stopTimer(); root.replaceChildren(...nodes); window.scrollTo(0, 0); }
  function toast(msg, kind) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }
  function setToken(t) {
    token = t;
    if (PRACTICE) return;
    try { if (t) localStorage.setItem('trench.token', t); else localStorage.removeItem('trench.token'); } catch (e) { /* ignore */ }
  }
  function prettyDay(d) {
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  function addDays(d, n) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }
  const depthOf = (score, max) => Math.round((score / (max || 1000)) * MAX_DEPTH);

  async function api(method, path, body, tries = 2) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch('/api' + path, {
          method,
          headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (attempt < tries) { await sleep(600 * (attempt + 1)); continue; }
        throw new Error('Can’t reach the server. Check your connection and try again.');
      }
      let data = {};
      try { data = await res.json(); } catch (e) { /* empty */ }
      if (res.status === 401 && path !== '/login') { setToken(null); me = null; authScreen('login', data.error); throw Object.assign(new Error(data.error || 'Logged out'), { handled: true }); }
      if (res.status >= 500 && attempt < tries) { await sleep(700 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      return data;
    }
  }

  // ---------- depth backdrop (shared by every screen) ----------
  const SURFACE = [40, 167, 186], ABYSS = [3, 13, 26];
  function setDepth(frac) {
    const f = Math.max(0, Math.min(1, frac));
    const e = Math.pow(f, 0.45);
    const mix = t => SURFACE.map((v, i) => Math.round(v + (ABYSS[i] - v) * Math.min(1, t)));
    document.body.style.setProperty('--sea-top', `rgb(${mix(e * 0.95)})`);
    document.body.style.setProperty('--sea-bot', `rgb(${mix(e * 0.95 + 0.4)})`);
    document.body.style.setProperty('--glow', String(Math.min(1, f * 1.4)));
  }

  function soundButton() {
    const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sound', 'aria-pressed': String(FX.sound.on), title: 'Sound' }, FX.sound.on ? speakerOn() : speakerOff());
    b.addEventListener('click', () => { const on = FX.sound.toggle(); b.replaceChildren(on ? speakerOn() : speakerOff()); b.setAttribute('aria-pressed', String(on)); });
    return b;
  }
  function svg(markup) { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = markup; return s; }
  const speakerOn = () => svg('<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>');
  const speakerOff = () => svg('<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>');
  const sub = (cls) => svg(`<svg class="${cls || ''}" viewBox="0 0 64 64" width="44" height="44"><defs><radialGradient id="hull" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".55" stop-color="#f2b94a"/><stop offset="1" stop-color="#b9761d"/></radialGradient></defs><line x1="32" y1="0" x2="32" y2="10" stroke="#cfe" stroke-opacity=".5" stroke-width="1.5"/><circle cx="32" cy="34" r="22" fill="url(#hull)" stroke="#5a3a0e" stroke-width="2"/><circle cx="32" cy="34" r="10" fill="#0b2a3a" stroke="#5a3a0e" stroke-width="3"/><circle cx="28.5" cy="30.5" r="3" fill="#bdf5ff" fill-opacity=".8"/><circle cx="12" cy="34" r="2" fill="#5a3a0e"/><circle cx="52" cy="34" r="2" fill="#5a3a0e"/><circle cx="32" cy="14" r="2" fill="#5a3a0e"/></svg>`);

  function topbar(extra) {
    return h('header', { class: 'topbar' },
      h('button', { class: 'wordmark', type: 'button', onclick: () => homeScreen() }, 'The Trench'),
      h('div', { class: 'topbar-right' }, extra, soundButton(),
        PRACTICE ? h('button', { class: 'link-btn', type: 'button', onclick: practiceNewSet }, 'New set')
          : me ? h('button', { class: 'link-btn', type: 'button', onclick: logout }, 'Log out') : null));
  }
  async function practiceNewSet() {
    runId++; stopTimer();
    PRACTICE.nextSet();
    toast('Fresh set of prompts loaded.');
    await homeScreen();
  }
  async function logout() {
    try { await api('POST', '/logout'); } catch (e) { /* ignore */ }
    setToken(null); me = null; authScreen('login');
  }

  // =====================================================================
  // AUTH
  // =====================================================================
  function authScreen(mode, notice) {
    setDepth(0);
    FX.stopSnow();
    const joining = mode === 'join';
    const err = h('p', { class: 'form-error', role: 'alert' }, notice || '');
    const name = h('input', { id: 'f-name', type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', maxlength: 16, required: true });
    const pw = h('input', { id: 'f-pw', type: 'password', autocomplete: joining ? 'new-password' : 'current-password', required: true });
    const invite = joining ? h('input', { id: 'f-inv', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', required: true }) : null;
    const btn = h('button', { class: 'btn primary wide', type: 'submit' }, joining ? 'Create account' : 'Log in');
    const form = h('form', { class: 'auth-form', novalidate: true, onsubmit: async e => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      FX.sound.unlock();
      try {
        const body = { username: name.value.trim(), password: pw.value, invite: invite ? invite.value.trim() : undefined };
        const r = await api('POST', joining ? '/signup' : '/login', body, 0);
        setToken(r.token); me = r.user;
        await homeScreen();
      } catch (ex) { if (!ex.handled) { err.textContent = ex.message; btn.disabled = false; } }
    } },
      h('label', { for: 'f-name' }, 'Name'), name,
      h('label', { for: 'f-pw' }, 'Password'), pw,
      joining ? [h('label', { for: 'f-inv' }, 'Invite code'), invite] : null,
      err, btn,
      h('p', { class: 'swap' }, joining ? 'Already diving? ' : 'New here? ',
        h('button', { type: 'button', class: 'link-btn', onclick: () => authScreen(joining ? 'login' : 'join') }, joining ? 'Log in' : 'Create an account')));

    mount(h('main', { class: 'auth' },
      h('section', { class: 'surface' },
        h('div', { class: 'sun', 'aria-hidden': 'true' }),
        h('h1', { class: 'title' }, 'The Trench'),
        h('p', { class: 'tagline' }, 'Ten prompts a day. Obvious answers float. Rare ones sink.'),
        waves()),
      h('section', { class: 'auth-card' }, form)));
    setTimeout(() => name.focus(), 50);
  }
  function waves() {
    const s = document.createElement('div');
    s.className = 'waves';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 1200 60" preserveAspectRatio="none"><path class="w1" d="M0 30 Q 75 10 150 30 T 300 30 T 450 30 T 600 30 T 750 30 T 900 30 T 1050 30 T 1200 30 V60 H0Z"/><path class="w2" d="M0 38 Q 75 22 150 38 T 300 38 T 450 38 T 600 38 T 750 38 T 900 38 T 1050 38 T 1200 38 V60 H0Z"/></svg>';
    return s;
  }

  // =====================================================================
  // HOME / LOBBY
  // =====================================================================
  async function homeScreen() {
    runId++;
    setDepth(0.04);
    FX.stopSnow();
    try { st = await api('GET', '/state'); me = st.user; }
    catch (e) { if (!e.handled) mount(errorScreen(e.message, homeScreen)); return; }

    const d = st.dive, max = st.settings.maxScore;
    let hero;
    if (d && d.finished) {
      hero = h('section', { class: 'lobby-hero done' },
        h('p', { class: 'dive-no' }, `Dive ${st.no} · ${prettyDay(st.today)}`),
        h('div', { class: 'depth-read' }, h('span', { class: 'depth-num' }, fmt(d.depth)), h('span', { class: 'depth-unit' }, 'm')),
        h('p', { class: 'zone' }, `${d.zone} · ${fmt(d.score)} points`),
        pipRow(d.answers, d.total),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => resultsScreen(d) }, 'See your dive'),
          shareButton(d)),
        PRACTICE ? h('button', { class: 'btn ghost', type: 'button', onclick: practiceNewSet, style: 'margin-top:14px' }, 'Play a new set')
          : h('p', { class: 'fine' }, 'Next dive opens at midnight Eastern.'));
    } else {
      const started = d && d.answers.length > 0 || st.current;
      hero = h('section', { class: 'lobby-hero' },
        h('p', { class: 'dive-no' }, `Dive ${st.no} · ${prettyDay(st.today)}`),
        h('h1', { class: 'lobby-title' }, started ? 'Your dive is waiting' : 'Today’s dive is open'),
        h('p', { class: 'lobby-sub' }, started
          ? `${d ? d.answers.length : 0} of ${st.settings.perDay} prompts answered. Your progress is saved to your account.`
          : `${st.settings.perDay} prompts, ${st.settings.seconds} seconds each, one attempt. The rarer your answer, the deeper you sink.`),
        h('button', { class: 'btn primary big', type: 'button', onclick: () => { FX.sound.unlock(); playScreen(); } }, started ? 'Resume dive' : 'Begin descent'),
        h('button', { class: 'link-btn how', type: 'button', onclick: howTo }, 'How scoring works'));
    }
    const boardBox = h('section', { class: 'board-wrap' }, h('p', { class: 'fine' }, 'Loading the depth chart…'));
    mount(h('div', { class: 'page lobby' }, topbar(h('span', { class: 'who' }, me.username)), h('main', { class: 'lobby-main' }, hero, boardBox)));
    loadBoard(boardBox);
  }

  function pipRow(answers, total) {
    const pips = [];
    for (let i = 0; i < total; i++) {
      const a = answers.find(x => x.index === i);
      pips.push(h('span', { class: 'pip ' + (a ? (a.tier || 'timeout') : 'empty'), title: a ? (TIER[a.tier] || TIER.timeout).name : 'Not answered' }));
    }
    return h('div', { class: 'pips', 'aria-label': 'Your tiers' }, pips);
  }

  function howTo() {
    const rows = ['plankton', 'clever', 'schooler', 'rare', 'deep', 'one'].map(k =>
      h('li', {}, h('span', { class: 'chip ' + k }, TIER[k].name), h('span', { class: 'how-pts' }, `${TIER[k].pts} pts`)));
    const close = () => dlg.remove();
    const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How scoring works', onclick: e => { if (e.target === dlg) close(); } },
      h('div', { class: 'modal-card' },
        h('h2', {}, 'How scoring works'),
        h('p', {}, 'Every prompt has an answer sheet. Type something that fits: the more obvious it is, the fewer points; the more obscure (but still right), the deeper you sink.'),
        h('ul', { class: 'tier-list' }, rows),
        h('p', {}, 'Typos, plurals, missing spaces and extras like “Mount” or “Lake” are forgiven. If an answer isn’t on the sheet it won’t lock in, so try another while the clock runs.'),
        h('p', { class: 'fine' }, 'A perfect day is 1,000 points: the bottom of the Mariana Trench. Leaving mid-prompt doesn’t pause the clock.'),
        h('button', { class: 'btn primary', type: 'button', onclick: close }, 'Got it')));
    document.body.append(dlg);
    dlg.querySelector('button').focus();
    dlg.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function shareText(d) {
    const sq = { plankton: '⬜', clever: '🟪', schooler: '🟦', rare: '🟩', deep: '🟨', one: '🟥', timeout: '⬛' };
    const row = Array.from({ length: d.total }, (_, i) => { const a = d.answers.find(x => x.index === i); return sq[(a && a.tier) || 'timeout']; }).join('');
    return `The Trench · Dive ${d.no}\n${fmt(d.depth)} m · ${d.zone}\n${row}\n${location.origin}`;
  }
  function shareButton(d) {
    return h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      const text = shareText(d);
      try {
        if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) await navigator.share({ text });
        else { await navigator.clipboard.writeText(text); toast('Result copied. Paste it in the group chat.'); }
      } catch (e) { if (e.name !== 'AbortError') toast('Couldn’t copy. Select and copy:\n' + text); }
    } }, 'Share result');
  }

  // ---------- leaderboard ----------
  async function loadBoard(box) {
    try { board = await api('GET', '/leaderboard'); }
    catch (e) { if (!e.handled) box.replaceChildren(h('p', { class: 'form-error' }, e.message)); return; }
    renderBoard(box);
  }
  function computeBoard(tab) {
    const today = board.today;
    const since = tab === 'week' ? addDays(today, -6) : tab === 'today' ? today : '0000';
    const until = tab === 'today' ? today : '9999';
    const rows = [];
    for (const p of board.players) {
      let total = 0, days = 0, best = 0, live = false, finishedToday = false;
      for (const [day, v] of Object.entries(p.days || {})) {
        if (day < since || day > until) continue;
        total += v.score; days += 1; best = Math.max(best, v.score);
        if (day === today && !v.finished) live = true;
        if (day === today && v.finished) finishedToday = true;
      }
      if (tab === 'today' || days > 0) rows.push({ name: p.username, total, days, best, live, finishedToday, played: days > 0 });
    }
    rows.sort((a, b) => b.total - a.total || b.best - a.best || a.name.localeCompare(b.name));
    return rows;
  }
  function renderBoard(box) {
    const tabs = [['today', 'Today'], ['week', 'Last 7 days'], ['all', 'All time']];
    const rows = computeBoard(boardTab);
    const top = Math.max(1, ...rows.map(r => r.total));
    const perDayMax = board.maxScore || 1000;
    const list = rows.length
      ? h('ol', { class: 'board' }, rows.map((r, i) => {
          const frac = boardTab === 'today' ? r.total / perDayMax : r.total / top;
          const meta = boardTab === 'today'
            ? (r.live ? 'diving now' : r.finishedToday ? `${fmt(depthOf(r.total, perDayMax))} m · ${zoneFor(depthOf(r.total, perDayMax))}` : 'hasn’t dived yet')
            : `${r.days} ${r.days === 1 ? 'dive' : 'dives'} · best ${fmt(r.best)}`;
          return h('li', { class: (r.name === me.username ? 'me ' : '') + (r.played ? '' : 'idle') },
            h('span', { class: 'rank' }, r.played ? String(i + 1) : '–'),
            h('div', { class: 'who-col' },
              h('span', { class: 'name' }, r.name, r.live ? h('span', { class: 'live-dot', title: 'Diving now' }) : null),
              h('span', { class: 'meta' }, meta),
              h('span', { class: 'line', style: `--w:${Math.max(0.015, Math.min(1, frac))}` })),
            h('span', { class: 'score' }, fmt(r.total)));
        }))
      : h('p', { class: 'fine' }, 'Nobody has dived yet. Be first in.');
    box.replaceChildren(
      h('div', { class: 'board-head' },
        h('h2', {}, 'Depth chart'),
        h('div', { class: 'seg', role: 'tablist' }, tabs.map(([k, label]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': String(boardTab === k), class: boardTab === k ? 'on' : '', onclick: () => { boardTab = k; renderBoard(box); } }, label)))),
      list,
      h('button', { class: 'link-btn refresh', type: 'button', onclick: () => loadBoard(box) }, 'Refresh'));
  }

  // =====================================================================
  // PLAY
  // =====================================================================
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  async function playScreen() {
    const my = ++runId;
    const max = st.settings.maxScore, total = st.settings.perDay;
    let score = st.dive ? st.dive.score : 0;
    const answers = st.dive ? st.dive.answers.slice() : [];

    // persistent stage: the sea column stays mounted while prompts change
    const pips = h('div', { class: 'pips game-pips' });
    const scoreEl = h('span', { class: 'score-num' }, fmt(score));
    const depthLabel = h('span', { class: 'depth-label' });
    const marker = h('div', { class: 'sub-marker' }, sub(), depthLabel);
    const ruler = h('div', { class: 'ruler', 'aria-hidden': 'true' },
      [0, 1000, 4000, 6000, 10935].map(m => h('span', { class: 'tick', style: `--p:${m / MAX_DEPTH}` }, m === 0 ? '0 m' : m === 10935 ? '10,935' : fmt(m))),
      marker);
    const stage = h('div', { class: 'stage' });
    const snow = h('canvas', { class: 'snow', 'aria-hidden': 'true' });
    mount(h('div', { class: 'page play' },
      snow,
      topbar(h('span', { class: 'score-chip' }, scoreEl, h('span', { class: 'score-of' }, ' pts'))),
      h('div', { class: 'play-grid' },
        h('main', { class: 'play-main' }, pips, stage),
        ruler)));
    FX.startSnow(snow);

    const renderPips = () => pips.replaceChildren(...Array.from({ length: total }, (_, i) => {
      const a = answers.find(x => x.index === i);
      return h('span', { class: 'pip ' + (a ? (a.tier || 'timeout') : 'empty') });
    }));
    const placeSub = (instant) => {
      const m = depthOf(score, max);
      if (instant) marker.classList.add('no-anim');
      marker.style.setProperty('--p', String(m / MAX_DEPTH));
      depthLabel.textContent = `${fmt(m)} m`;
      setDepth(m / MAX_DEPTH);
      if (instant) requestAnimationFrame(() => marker.classList.remove('no-anim'));
    };
    renderPips(); placeSub(true);

    if (!answers.length && !st.current) {
      // descent intro
      stage.replaceChildren(h('div', { class: 'intro' }, h('p', { class: 'intro-big' }, 'Descending'), h('p', { class: 'fine' }, 'First prompt in a moment.')));
      FX.sound.start(); FX.rush();
      await sleep(1300);
      if (my !== runId) return;
    }

    for (;;) {
      if (my !== runId) return;
      let r;
      try { r = await api('POST', '/next'); }
      catch (e) { if (!e.handled) { stage.replaceChildren(errorBlock(e.message, () => playScreen())); } return; }
      if (my !== runId) return;
      if (r.finished) { st.dive = r.dive; await sleep(300); return resultsScreen(r.dive, true); }
      const res = await askOne(r.question, stage, my);
      if (my !== runId || !res) return;
      answers.push({ index: r.question.index, tier: res.tier, pts: res.pts });
      const before = score;
      score = res.score;
      renderPips();
      if (res.pts > 0) { FX.countUp(scoreEl, before, score, 900); placeSub(false); FX.rush(); }
      await sleep(res.pts >= 85 ? 2300 : 1800);
      if (my !== runId) return;
      if (res.finished && res.dive) { st.dive = res.dive; return resultsScreen(res.dive, true); }
    }
  }

  /** One prompt. Resolves with { tier, pts, score, finished, dive } once scored. */
  function askOne(q, stage, my) {
    return new Promise(resolve => {
      const secs = Math.round((q.deadline - q.startedAt) / 1000);
      const skew = q.serverNow - Date.now();          // server clock minus ours
      const localDeadline = q.deadline - skew;
      const fill = h('div', { class: 'air-fill' });
      const clock = h('span', { class: 'air-num' }, String(secs));
      const msg = h('p', { class: 'msg', 'aria-live': 'polite' });
      const input = h('input', { class: 'answer', type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', maxlength: 80, 'aria-label': 'Your answer', enterkeyhint: 'go', placeholder: 'Type an answer' });
      const go = h('button', { class: 'btn primary lock', type: 'submit' }, 'Lock in');
      const card = h('section', { class: 'prompt-card' },
        h('div', { class: 'prompt-meta' }, h('span', {}, `${q.index + 1} of ${q.total}`), q.cat ? h('span', { class: 'cat' }, q.cat) : null),
        h('h2', { class: 'prompt' }, q.prompt),
        h('div', { class: 'air', role: 'timer', 'aria-label': 'Time left' }, h('div', { class: 'air-track' }, fill), clock),
        h('form', { class: 'answer-row', onsubmit: submit }, input, go),
        msg);
      stage.replaceChildren(card);
      requestAnimationFrame(() => card.classList.add('in'));
      input.focus();

      let busy = false, done = false, lastTick = -1;
      const finish = (res) => { done = true; stopTimer(); resolve(res); };

      function tickClock() {
        if (my !== runId) { stopTimer(); return; }
        const left = Math.max(0, localDeadline - Date.now());
        fill.style.transform = `scaleX(${left / (secs * 1000)})`;
        const s = Math.ceil(left / 1000);
        clock.textContent = String(s);
        if (left < 6000) card.classList.add('low');
        if (s <= 5 && s !== lastTick && s > 0) { lastTick = s; FX.sound.tick(s <= 3); }
        if (left <= 0 && !done && !busy) expire();
      }
      stopTimer();
      timer = setInterval(tickClock, 100);
      tickClock();

      async function expire() {
        busy = true;
        input.disabled = true; go.disabled = true;
        try {
          let r = await api('POST', '/timeout', { index: q.index });
          if (r.timeout === false) { await sleep(Math.max(200, r.deadline - r.serverNow + 300)); r = await api('POST', '/timeout', { index: q.index }); }
          showTimeout();
          setTimeout(() => finish({ tier: 'timeout', pts: 0, score: r.score, finished: r.finished, dive: r.dive }), 1500);
        } catch (e) { if (!e.handled) { toast(e.message, 'bad'); busy = false; } }
      }
      function showTimeout() {
        stopTimer();
        card.classList.add('timed-out');
        FX.sound.timeout(); FX.vibrate(120);
        msg.className = 'msg bad';
        msg.textContent = 'Out of air. That one scores zero.';
      }

      async function submit(e) {
        e.preventDefault();
        if (busy || done) return;
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        busy = true; go.disabled = true;
        card.classList.add('checking');
        let r;
        try { r = await api('POST', '/answer', { index: q.index, text }); }
        catch (ex) { card.classList.remove('checking'); busy = false; go.disabled = false; if (!ex.handled) toast(ex.message, 'bad'); return; }
        card.classList.remove('checking');
        if (my !== runId) return;
        if (r.timeout) { showTimeout(); setTimeout(() => finish({ tier: 'timeout', pts: 0, score: r.score }), 1500); return; }
        if (r.valid === false) {
          busy = false; go.disabled = false;
          FX.sound.wrong(); FX.vibrate([30, 40, 30]);
          input.classList.remove('nope'); void input.offsetWidth; input.classList.add('nope');
          msg.className = 'msg bad';
          msg.textContent = `“${text}” isn’t on the sheet. Try another.`;
          input.select();
          return;
        }
        if (r.done) { finish({ tier: r.tier, pts: r.pts, score: r.score }); return; }
        stopTimer();
        input.disabled = true;
        reveal(card, r, text);
        finish({ tier: r.tier, pts: r.pts, score: r.score, finished: r.finished, dive: r.dive });
      }
    });
  }

  function reveal(card, r, typed) {
    const tier = r.tier;
    const shown = typed.trim().toLowerCase() !== String(r.canon).toLowerCase();
    const stamp = h('div', { class: 'stamp ' + tier, role: 'status' },
      h('span', { class: 'stamp-tier' }, TIER[tier].name),
      h('span', { class: 'stamp-pts' }, '+', h('span', { class: 'n' }, '0')),
      h('span', { class: 'stamp-canon' }, shown ? `Counted as ${r.canon}` : r.canon),
      h('span', { class: 'stamp-line' }, pick(TIER_LINES[tier] || [''])));
    card.classList.add('revealed', 't-' + tier);
    card.querySelector('.answer-row').replaceWith(stamp);
    card.querySelector('.msg').textContent = '';
    requestAnimationFrame(() => stamp.classList.add('go'));
    setTimeout(() => FX.countUp(stamp.querySelector('.n'), 0, r.pts, 650), 220);
    FX.sound.tier(tier);
    FX.vibrate(tier === 'one' ? [40, 60, 40, 60, 120] : tier === 'deep' ? [40, 50, 80] : 25);
    setTimeout(() => { FX.burst(stamp, tier); FX.bubbles(card, tier === 'one' ? 26 : tier === 'deep' ? 16 : 8, null); }, 160);
  }

  // =====================================================================
  // RESULTS
  // =====================================================================
  async function resultsScreen(d, fresh) {
    runId++;
    FX.stopSnow();
    const max = st.settings.maxScore;
    setDepth(d.depth / MAX_DEPTH);
    const counts = {};
    d.answers.forEach(a => { const k = a.tier || 'timeout'; counts[k] = (counts[k] || 0) + 1; });
    const tally = ['one', 'deep', 'rare', 'schooler', 'clever', 'plankton', 'timeout'].filter(k => counts[k])
      .map(k => h('span', { class: 'chip ' + k }, `${TIER[k].name} × ${counts[k]}`));
    const num = h('span', { class: 'depth-num' }, fresh ? '0' : fmt(d.depth));
    const crew = h('div', { class: 'crew' });
    const list = h('ol', { class: 'review' }, d.answers.slice().sort((a, b) => a.index - b.index).map(a => {
      const tier = a.tier || 'timeout';
      return h('li', { class: 'rev', 'data-i': a.index },
        h('div', { class: 'rev-head' },
          h('span', { class: 'rev-n' }, a.index + 1),
          h('span', { class: 'rev-q' }, a.prompt),
          h('span', { class: 'rev-pts' }, a.pts || 0)),
        h('div', { class: 'rev-body' },
          h('span', { class: 'chip ' + tier }, TIER[tier].name),
          a.input ? h('span', { class: 'rev-you' }, a.input) : h('span', { class: 'rev-you dim' }, 'No answer'),
          a.canon && a.input && a.canon.toLowerCase() !== a.input.toLowerCase() ? h('span', { class: 'rev-canon' }, `(${a.canon})`) : null),
        (a.deepCuts && a.deepCuts.length) ? h('details', { class: 'deep' },
          h('summary', {}, 'Deepest answers on the sheet'),
          h('p', {}, h('span', { class: 'chip one' }, 'One in a Million'), ' ', a.deepCuts.join(', ')),
          a.deepCuts2 && a.deepCuts2.length ? h('p', {}, h('span', { class: 'chip deep' }, 'Deep Cut'), ' ', a.deepCuts2.join(', ')) : null) : null,
        h('div', { class: 'crew-slot' }));
    }));
    mount(h('div', { class: 'page results' },
      topbar(null),
      h('main', { class: 'results-main' },
        h('section', { class: 'results-hero' },
          h('p', { class: 'dive-no' }, `Dive ${d.no} · final`),
          h('div', { class: 'depth-read' }, num, h('span', { class: 'depth-unit' }, 'm')),
          h('p', { class: 'zone' }, `${d.zone} · ${fmt(d.score)} of ${fmt(max)} points`),
          pipRow(d.answers, d.total),
          h('div', { class: 'chips' }, tally),
          h('div', { class: 'row-btns' },
            shareButton(d),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => homeScreen() }, 'Depth chart'),
            PRACTICE ? h('button', { class: 'btn ghost', type: 'button', onclick: practiceNewSet }, 'Play a new set') : null)),
        h('section', { class: 'review-wrap' }, h('h2', {}, 'Your dive'), list),
        crew)));
    if (fresh) { FX.countUp(num, 0, d.depth, 1600); FX.sound.start(); }
    // what the crew said
    try {
      const g = await api('GET', '/group');
      for (const p of g.prompts) {
        const slot = list.querySelector(`.rev[data-i="${p.index}"] .crew-slot`);
        if (!slot) continue;
        const others = p.picks.filter(x => x.username !== me.username);
        if (!others.length) continue;
        slot.replaceChildren(h('ul', { class: 'crew-list' }, others.map(x =>
          h('li', {}, h('span', { class: 'crew-name' }, x.username), h('span', { class: 'chip ' + (x.tier || 'timeout') }, (TIER[x.tier] || TIER.timeout).name), h('span', { class: 'crew-ans' }, x.canon || x.input || '—')))));
      }
    } catch (e) { /* crew answers are a bonus */ }
  }

  function errorBlock(message, retry) {
    return h('div', { class: 'error-block' }, h('p', {}, message), h('button', { class: 'btn primary', type: 'button', onclick: retry }, 'Try again'));
  }
  function errorScreen(message, retry) {
    return h('div', { class: 'page' }, topbar(null), h('main', { class: 'lobby-main' }, errorBlock(message, retry)));
  }

  // =====================================================================
  // BOOT
  // =====================================================================
  (async function boot() {
    if (PRACTICE) {
      const r = await api('POST', '/signup', { username: 'You', password: 'practice', invite: PRACTICE.invite });
      setToken(r.token); me = r.user;
      const banner = h('div', { class: 'practice-banner', role: 'note' }, 'Practice mode. Nothing is saved: reload the page and it all resets.');
      document.body.prepend(banner);
      return homeScreen();
    }
    if (!token) return authScreen('login');
    await homeScreen();
  })();
})();
