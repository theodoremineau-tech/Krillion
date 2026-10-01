// Practice build: runs the real game server inside the page with an in-memory store.
import { createGame, SETTINGS } from './game.mjs';

const data = new Map();
const store = {
  get: async k => (data.has(k) ? structuredClone(data.get(k)) : null),
  set: async (k, v) => { data.set(k, structuredClone(v)); },
  del: async k => { data.delete(k); },
  list: async p => [...data.keys()].filter(k => k.startsWith(p)),
};
let dayShift = 0;
const game = createGame(store, () => Date.now() + dayShift * 86400000);

window.TRENCH_PRACTICE = {
  invite: SETTINGS.INVITE_CODE,
  // jump the game clock a day ahead: a different 10 prompts, same account
  nextSet() { dayShift += 1; },
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  const route = url.pathname.slice(4);
  const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '') || null;
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
  let status = 200, payload;
  try { payload = await game.handle(init.method || 'GET', route, body, token); }
  catch (e) { status = e.status || 500; payload = { error: e.message }; if (status === 500) console.error(e); }
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
};
