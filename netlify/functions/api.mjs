// Netlify Function (v2): all game API routes under /api/*
import { getStore } from '@netlify/blobs';
import { createGame, respond } from '../../server/game.mjs';

function blobStore() {
  const s = getStore({ name: 'trench', consistency: 'strong' });
  return {
    get: key => s.get(key, { type: 'json' }),
    set: (key, value) => s.setJSON(key, value),
    del: key => s.delete(key),
    list: async prefix => {
      const { blobs } = await s.list({ prefix });
      return blobs.map(b => b.key);
    },
  };
}

// Background work (building the next prompt's answer index) runs after the response is sent.
const deferWith = context => fn => {
  const p = new Promise(r => setTimeout(r, 0)).then(fn);
  if (context && typeof context.waitUntil === 'function') context.waitUntil(p);
};

export default async (req, context) => respond(createGame(blobStore(), undefined, { defer: deferWith(context) }), req);

export const config = { path: '/api/*' };
