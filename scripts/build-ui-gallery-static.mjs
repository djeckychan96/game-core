#!/usr/bin/env node
// QA-only static build of the Ready UI gallery (examples/pixi-showcase/ui-gallery.html) for a Yandex Games draft or any
// static host: index.html at the root, relative paths only, no sourcemaps, every file inside the folder. Not part of the
// Core package build (dist/ is never touched) and not a game: the gallery as it is, demo data only, no platform SDK.
//
//   node scripts/build-ui-gallery-static.mjs
//     → dist-ui-gallery/ (the site) + release/game-core-yandex-ui-test-<sha>.zip (its contents at the zip root)
//
// <sha> = the last commit that changed what the gallery draws (src, the showcase, the Ready UI assets, its Vite config);
// uncommitted changes there add "-dirty". Uses vite.showcase.config.ts as is, only the input page and outDir differ.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOWCASE = path.join(ROOT, 'examples/pixi-showcase');
const OUT = path.join(ROOT, 'dist-ui-gallery');
const RELEASE = path.join(ROOT, 'release');
const CONTENT = ['src', 'examples/pixi-showcase', 'assets', 'vite.showcase.config.ts'];
// runtime-only files of the gallery that no bundle references (Assets.load URLs): the OFFER's sample booster icons
const RUNTIME_FILES = ['gallery/booster_lamp.webp', 'gallery/booster_wand.webp'];

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const sha = git('log', '-1', '--format=%h', '--', ...CONTENT);
const dirty = git('status', '--porcelain', '--', ...CONTENT) !== '';
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const name = `game-core-yandex-ui-test-${sha}${dirty ? '-dirty' : ''}`;
const fail = (message) => { console.error(`build-ui-gallery-static: FAIL — ${message}`); process.exit(1); };

await build({
  configFile: path.join(ROOT, 'vite.showcase.config.ts'),
  logLevel: 'warn',
  define: { __GAME_CORE_BUILD_INFO__: JSON.stringify({ version, commit: sha, dirty, builtAt: '' }) },
  // es2022: the gallery awaits at the top level (app.init, the asset loads) — Safari 15+ / Chrome 89+, like the showcase itself.
  // pixi.js in its own chunk: by default Pixi lands in the entry chunk, and its lazy chunks (browserAll, the renderers)
  // import back from that entry while it is still suspended in the top-level await → the page deadlocks before the
  // first frame. Inlining them instead breaks Pixi's own module order (TDZ). Same split as a game's vendor-pixi.
  build: {
    outDir: OUT, emptyOutDir: true, sourcemap: false, target: 'es2022',
    rollupOptions: { input: path.join(SHOWCASE, 'ui-gallery.html'), output: { manualChunks: { 'vendor-pixi': ['pixi.js'] } } }
  }
});
fs.renameSync(path.join(OUT, 'ui-gallery.html'), path.join(OUT, 'index.html'));
for (const rel of RUNTIME_FILES) fs.cpSync(path.join(SHOWCASE, rel), path.join(OUT, rel));

// the site must stand alone: no dev server, no local or absolute URL, no sourcemap, nothing the page asks for is missing
const files = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]));
const all = files(OUT).filter((f) => !f.endsWith('.DS_Store'));
const problems = [];
for (const f of all) {
  if (f.endsWith('.map')) problems.push(`sourcemap ${f}`);
  if (!/\.(html|js|css)$/.test(f)) continue;
  const text = fs.readFileSync(path.join(OUT, f), 'utf8');
  for (const bad of [/localhost/, /127\.0\.0\.1/, /\/Users\//, /file:\/\//, /\/@vite\//, /sourceMappingURL/]) if (bad.test(text)) problems.push(`${f}: ${bad}`);
}
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (ref.startsWith('data:')) continue;
  if (!ref.startsWith('./')) problems.push(`index.html: non-relative ${ref}`);
  else if (!all.includes(ref.slice(2))) problems.push(`index.html: missing ${ref}`);
}
const gallery = all.find((f) => /^assets\/ui-gallery-.*\.js$/.test(f));
if (!gallery) problems.push('no gallery bundle');
else for (const rel of RUNTIME_FILES) if (!fs.readFileSync(path.join(OUT, gallery), 'utf8').includes(`./${rel}`)) problems.push(`${rel} is no longer loaded by the gallery`);
if (!all.some((f) => f.startsWith('pixi-ui/'))) problems.push('no Ready UI assets (pixi-ui/)');
if (problems.length) fail(problems.join('\n  '));

fs.mkdirSync(RELEASE, { recursive: true });
const zip = path.join(RELEASE, `${name}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-q', '-r', '-X', zip, '.', '-x', '*.DS_Store'], { cwd: OUT });
const size = fs.statSync(zip).size;
console.log(`build-ui-gallery-static: OK — ${all.length} files, ${(size / 1024 / 1024).toFixed(2)} MB → ${path.relative(ROOT, zip)}${dirty ? ' (DIRTY: uncommitted gallery changes)' : ''}`);
