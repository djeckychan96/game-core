import { mkdir, copyFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const source = resolve(repoRoot, 'dist/game-core.iife.js');
const target = resolve(repoRoot, '../word_tide/assets/vendor/game-core/game-core.iife.js');

await stat(source);
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);

console.log(`Synced ${source} -> ${target}`);
