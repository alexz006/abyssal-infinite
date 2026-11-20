// Bundles src/*.js into the single self-contained ../index.html
//   npm run build            minified
//   npm run build:readable   unminified, for debugging
//   npm run build:dev        ../dev.html: unminified, plus the development tools in src/dev.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['quality.js', 'math.js', 'creatures.js', 'shaders.js', 'layout.js', 'meshes.js', 'gpu.js', 'stream.js', 'bots.js', 'net.js', 'picker.js', 'main.js', 'audio.js']; // concatenation order matters
const WORKER = ['math.js', 'layout.js', 'gen.js']; // the tile generator: runs in web workers, carried in the page as a string
const dev = process.argv.includes('--dev'), readable = dev || process.argv.includes('--readable');
const out = dev ? 'dev.html' : 'index.html';
if (dev) FILES.push('dev.js');

const read = (list) => list.map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
let js = read(FILES), worker = read(WORKER);
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
// everything runs inside one async function; startup errors are shown on screen
const wrap = (body) => `(async()=>{${body}\n})().catch(e=>{console.error(e);document.body.className='l e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;

let html;
if (readable) {
  html = tpl.replace('/*SCRIPT*/', () => wrap(`const WORKER_SRC = ${JSON.stringify(worker)};\n` + js));
} else {
  // shrink the WGSL inside /*wgsl*/ template literals, then minify the JS and the page's CSS
  const minWgsl = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@]) ?/g, '$1').trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '`' + minWgsl(w) + '`');
  worker = transformSync(worker, { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  const code = transformSync(wrap(`const WORKER_SRC = ${JSON.stringify(worker)};\n` + js), { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  const css = (_, s) => '<style>' + transformSync(s, { loader: 'css', minify: true }).code.trim();
  html = tpl.replace(/<style>([^]*?)(?=<\/style>)/, css).replace(/>\s+</g, '><').replace('/*SCRIPT*/', () => code).replace(/<script>\s+/, '<script>').replace(/\s+<\/script>/, '</script>');
}
writeFileSync(path.join(here, '..', out), html);
// the multiplayer server serves the game itself: it gets a copy of the release build
if (!dev) { try { mkdirSync(path.join(here, '..', 'server', 'public'), { recursive: true }); writeFileSync(path.join(here, '..', 'server', 'public', 'index.html'), html); } catch {} }
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
console.log(`${out}: ${(html.length / 1024).toFixed(1)} kB${readable ? ' (readable)' : ''}, ${(gz / 1024).toFixed(1)} kB gzipped`);
