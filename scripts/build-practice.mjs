// Builds dist/trench-practice.html: a single file that runs the whole game in the
// browser with an in-memory store. No account, nothing saved, reload resets.
// Usage: npm run practice   (needs `npm install` first for esbuild)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'server/practice-entry.mjs')],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, write: false,
  plugins: [{
    name: 'crypto-swap', // node:crypto isn't available in the browser
    setup(b) { b.onResolve({ filter: /crypto\.mjs$/ }, () => ({ path: path.join(root, 'server/crypto-browser.mjs') })); },
  }],
});

const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>The Trench Practice</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Unbounded:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>${read('public/style.css')}</style></head>
<body><div id="app"></div>
<script>${read('public/fx.js')}</script>
<script>${result.outputFiles[0].text}</script>
<script>${read('public/app.js')}</script>
</body></html>`;
fs.writeFileSync(path.join(out, 'trench-practice.html'), html);
console.log('wrote dist/trench-practice.html', Math.round(html.length / 1024) + ' KB');
