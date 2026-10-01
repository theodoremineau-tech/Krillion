// Trench game server: accounts, sessions, daily dives, grading, leaderboard.
// Storage-agnostic: give it { get(key), set(key, value), del(key), list(prefix) }.
import { randomToken, randomHex, hashPw, safeEq } from './crypto.mjs';
import './bank.mjs';

const T = globalThis.Trench;
const BANK = globalThis.TRENCH_BANK;
const BY_ID = new Map(BANK.map(q => [q.id, q]));

export const SETTINGS = {
  TZ: 'America/New_York',
  PER_DAY: 10,
  SECONDS: 25,
  GRACE_MS: 3000,          // network slack on the 25 s clock
  INVITE_CODE: 'DEEPCUT',  // needed to create an account; case-insensitive
  LAUNCH_DAY: '2026-10-01',
};

const USER_RE = /^[A-Za-z0-9_]{2,16}$/;
const MAX_MISSES = 25;

function err(status, message) { const e = new Error(message); e.status = status; return e; }
const diveNo = day => T.dayIndex(day) - T.dayIndex(SETTINGS.LAUNCH_DAY) + 1;
const maxScore = () => SETTINGS.PER_DAY * T.MAX_PTS;

export function createGame(store, now = () => Date.now()) {
  const today = () => T.todayStr(SETTINGS.TZ, now());
  // ---------- auth ----------
  async function newSession(userKey) {
    const token = randomToken(24);
    await store.set(`sessions/${token}`, { user: userKey, created: now() });
    return token;
  }
  async function signup({ username, password, invite }) {
    username = String(username || '').trim();
    if (!USER_RE.test(username)) throw err(400, 'Pick a name with 2–16 letters, numbers or underscores.');
    if (!password || String(password).length < 4) throw err(400, 'Use a password with at least 4 characters.');
    if (SETTINGS.INVITE_CODE && String(invite || '').trim().toUpperCase() !== SETTINGS.INVITE_CODE.toUpperCase()) {
      throw err(403, 'That invite code doesn’t match. Ask whoever sent you the link.');
    }
    const key = username.toLowerCase();
    if (await store.get(`users/${key}`)) throw err(409, 'That name is taken. Log in instead, or pick another.');
    const salt = randomHex(16);
    await store.set(`users/${key}`, { username, salt, hash: hashPw(String(password), salt), created: now() });
    await store.set(`scores/${key}`, { username, days: {} });
    return { token: await newSession(key), user: { username } };
  }
  async function login({ username, password }) {
    const key = String(username || '').trim().toLowerCase();
    const u = key && await store.get(`users/${key}`);
    if (!u || !safeEq(hashPw(String(password || ''), u.salt), u.hash)) throw err(401, 'Wrong name or password.');
    return { token: await newSession(key), user: { username: u.username } };
  }
  async function auth(token) {
    if (!token) throw err(401, 'Log in to play.');
    const s = await store.get(`sessions/${token}`);
    if (!s) throw err(401, 'Your session ended. Log in again.');
    const u = await store.get(`users/${s.user}`);
    if (!u) throw err(401, 'Account not found.');
    return { key: s.user, username: u.username };
  }
  async function logout(token) { if (token) await store.del(`sessions/${token}`); return { ok: true }; }

  // ---------- dives ----------
  const diveKey = (day, user) => `dives/${day}/${user.key}`;

  function publicAnswer(a, withSheetInfo) {
    const out = { index: a.index, prompt: a.prompt, cat: a.cat, input: a.input || '', tier: a.tier, pts: a.pts, canon: a.canon || null, done: a.done };
    if (withSheetInfo) {
      const q = BY_ID.get(a.qid);
      if (q) {
        const es = T.entries(q);
        out.deepCuts = es.filter(e => e.tier === 'one').map(e => e.canon).slice(0, 8);
        out.deepCuts2 = es.filter(e => e.tier === 'deep').map(e => e.canon).slice(0, 8);
        out.sheetSize = es.length;
      }
    }
    return out;
  }
  function summary(dive, reveal) {
    if (!dive) return null;
    return {
      day: dive.day, no: diveNo(dive.day), total: dive.qids.length, score: dive.score, finished: dive.finished,
      depth: T.depthFor(dive.score, maxScore()), zone: T.zoneFor(T.depthFor(dive.score, maxScore())),
      answers: dive.answers.filter(a => a.done).map(a => publicAnswer(a, reveal && dive.finished)),
    };
  }
  function settle(dive) {
    // A question left open past its deadline (tab closed, phone locked) counts as a miss.
    const last = dive.answers[dive.answers.length - 1];
    if (last && !last.done && now() > last.deadline + SETTINGS.GRACE_MS) {
      Object.assign(last, { done: true, tier: 'timeout', pts: 0, canon: null });
      return true;
    }
    return false;
  }
  function rescore(dive) { dive.score = dive.answers.reduce((s, a) => s + (a.pts || 0), 0); }
  async function saveDive(user, dive) {
    rescore(dive);
    if (!dive.finished && dive.answers.length === dive.qids.length && dive.answers.every(a => a.done)) dive.finished = true;
    await store.set(diveKey(dive.day, user), dive);
    const sc = (await store.get(`scores/${user.key}`)) || { username: user.username, days: {} };
    sc.username = user.username;
    sc.days[dive.day] = { score: dive.score, finished: dive.finished, n: dive.answers.filter(a => a.done).length };
    await store.set(`scores/${user.key}`, sc);
  }
  async function loadDive(user, day) {
    const dive = await store.get(diveKey(day, user));
    if (dive && settle(dive)) await saveDive(user, dive);
    return dive;
  }

  async function state(user) {
    const day = today();
    const dive = await loadDive(user, day);
    return {
      user: { username: user.username },
      today: day, no: diveNo(day),
      settings: { perDay: SETTINGS.PER_DAY, seconds: SETTINGS.SECONDS, maxScore: maxScore() },
      dive: summary(dive, true),
      current: dive && !dive.finished ? currentQuestion(dive) : null,
      serverNow: now(),
    };
  }
  function currentQuestion(dive) {
    const a = dive.answers[dive.answers.length - 1];
    if (!a || a.done) return null;
    return { index: a.index, total: dive.qids.length, prompt: a.prompt, cat: a.cat, deadline: a.deadline, startedAt: a.startedAt, serverNow: now(), score: dive.score };
  }

  async function next(user) {
    const day = today();
    let dive = await loadDive(user, day);
    if (!dive) {
      const picks = T.pickDaily(BANK, day, SETTINGS.PER_DAY);
      dive = { day, user: user.key, qids: picks.map(p => p.id), answers: [], score: 0, finished: false, created: now() };
    }
    if (dive.finished) return { finished: true, dive: summary(dive, true), serverNow: now() };
    const open = currentQuestion(dive);
    if (open) return { question: open, dive: summary(dive, false), serverNow: now() };
    const i = dive.answers.length;
    if (i >= dive.qids.length) { await saveDive(user, dive); return { finished: true, dive: summary(dive, true), serverNow: now() }; }
    const q = BY_ID.get(dive.qids[i]);
    const t = now();
    if (!q) { // prompt retired from the bank mid-day
      dive.answers.push({ index: i, qid: dive.qids[i], prompt: '(retired prompt)', cat: null, startedAt: t, deadline: t, done: true, tier: 'timeout', pts: 0 });
      await saveDive(user, dive);
      return next(user);
    }
    dive.answers.push({ index: i, qid: q.id, prompt: q.prompt, cat: q.cat, startedAt: t, deadline: t + SETTINGS.SECONDS * 1000, done: false, tier: null, pts: 0, misses: [] });
    await saveDive(user, dive);
    return { question: currentQuestion(dive), dive: summary(dive, false), serverNow: now() };
  }

  async function openAnswer(user, index) {
    const day = today();
    const dive = await store.get(diveKey(day, user));
    if (!dive) throw err(409, 'Start today’s dive first.');
    const a = dive.answers[dive.answers.length - 1];
    if (!a || a.index !== index) throw err(409, 'That prompt has already been scored.');
    return { dive, a };
  }

  async function answer(user, { index, text }) {
    const { dive, a } = await openAnswer(user, Number(index));
    if (a.done) return { done: true, tier: a.tier, pts: a.pts, canon: a.canon, score: dive.score };
    if (now() > a.deadline + SETTINGS.GRACE_MS) {
      Object.assign(a, { done: true, tier: 'timeout', pts: 0 });
      await saveDive(user, dive);
      return { timeout: true, score: dive.score };
    }
    const input = String(text || '').slice(0, 80).trim();
    if (!input) return { valid: false };
    const g = T.grade(BY_ID.get(a.qid), input);
    if (!g) {
      if (a.misses.length < MAX_MISSES) { a.misses.push(input); await store.set(diveKey(dive.day, user), dive); }
      return { valid: false };
    }
    Object.assign(a, { done: true, input, tier: g.tier, pts: g.pts, canon: g.canon, how: g.how, answeredAt: now() });
    await saveDive(user, dive);
    const res = { valid: true, tier: g.tier, tierName: T.TIERS[g.tier].name, pts: g.pts, canon: g.canon, how: g.how, score: dive.score, finished: dive.finished };
    if (dive.finished) res.dive = summary(dive, true);
    return res;
  }

  async function timeout(user, { index }) {
    const { dive, a } = await openAnswer(user, Number(index));
    if (!a.done) {
      if (now() < a.deadline - 1500) return { timeout: false, deadline: a.deadline, serverNow: now() };
      Object.assign(a, { done: true, tier: 'timeout', pts: 0 });
      await saveDive(user, dive);
    }
    const res = { timeout: true, score: dive.score, finished: dive.finished };
    if (dive.finished) res.dive = summary(dive, true);
    return res;
  }

  // What everyone answered today, visible only once you've finished yourself.
  async function group(user, day) {
    day = day || today();
    const mine = await store.get(diveKey(day, user));
    if (!mine || !mine.finished) throw err(403, 'Finish your dive to see everyone’s answers.');
    const keys = await store.list(`dives/${day}/`);
    const dives = (await Promise.all(keys.map(k => store.get(k)))).filter(Boolean);
    const users = await Promise.all(dives.map(d => store.get(`users/${d.user}`)));
    const byQ = mine.qids.map((qid, i) => ({ index: i, prompt: (mine.answers[i] || {}).prompt, picks: [] }));
    dives.forEach((d, j) => {
      if (!d.finished) return;
      d.answers.forEach((a, i) => {
        if (!byQ[i] || a.qid !== mine.qids[i]) return;
        byQ[i].picks.push({ username: (users[j] || {}).username || d.user, input: a.input || '', canon: a.canon, tier: a.tier, pts: a.pts });
      });
    });
    for (const g of byQ) g.picks.sort((x, y) => (y.pts || 0) - (x.pts || 0));
    return { day, prompts: byQ };
  }

  async function leaderboard() {
    const keys = await store.list('scores/');
    const rows = (await Promise.all(keys.map(k => store.get(k)))).filter(Boolean);
    return {
      today: today(),
      players: rows.map(r => ({ username: r.username, days: r.days })),
      maxScore: maxScore(),
    };
  }

  // ---------- router ----------
  async function handle(method, route, body, token) {
    switch (`${method} ${route}`) {
      case 'POST /signup': return signup(body);
      case 'POST /login': return login(body);
      case 'POST /logout': return logout(token);
      case 'GET /state': return state(await auth(token));
      case 'POST /next': return next(await auth(token));
      case 'POST /answer': return answer(await auth(token), body);
      case 'POST /timeout': return timeout(await auth(token), body);
      case 'GET /group': return group(await auth(token));
      case 'GET /leaderboard': await auth(token); return leaderboard();
      case 'GET /health': return { ok: true, prompts: BANK.length, today: today() };
      default: throw err(404, 'Not found');
    }
  }
  return { handle, signup, login, auth, state, next, answer, timeout, group, leaderboard };
}

/** Shared HTTP glue: Request -> Response (Netlify Functions v2 and the dev server both use it). */
export async function respond(game, req) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/(?:\.netlify\/functions\/api|api)/, '') || '/';
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
  try {
    const data = await game.handle(req.method, route, body, token);
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    return Response.json({ error: status === 500 ? 'Something went wrong on the server. Try again.' : e.message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
