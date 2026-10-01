// Local dev server: static site + /api with a JSON-file store.
// node server/dev-server.mjs [port]   (data in .data/store.json)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, respond } from './game.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(root, '.data', 'store.json');
fs.mkdirSync(path.dirname(dataFile), { recursive: true });
let data = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : {};
const persist = () => fs.writeFileSync(dataFile, JSON.stringify(data));
const store = {
  get: async k => (k in data ? JSON.parse(JSON.stringify(data[k])) : null),
  set: async (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); persist(); },
  del: async k => { delete data[k]; persist(); },
  list: async p => Object.keys(data).filter(k => k.startsWith(p)),
};
// TRENCH_CLOCK_OFFSET lets tests fast-forward time
const now = () => Date.now() + Number(process.env.TRENCH_CLOCK_OFFSET || 0);
const game = createGame(store, now);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const PUB = path.join(root, 'public');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    const r = await respond(game, request);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let f = path.join(PUB, path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, ''));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.argv[2] || 8787), () => console.log('dev server on', process.argv[2] || 8787));
