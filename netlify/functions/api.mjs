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

export default async (req) => respond(createGame(blobStore()), req);

export const config = { path: '/api/*' };
