import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const rootDir = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

function readCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: rootDir }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function readIsDirty(): boolean {
  try {
    // Any staged/unstaged/untracked change vs HEAD counts as dirty — a build made while the
    // working tree doesn't match HEAD must never claim to be exactly that commit.
    const lines = execSync('git status --porcelain', { cwd: rootDir })
      .toString()
      .split('\n')
      .filter((line) => line.trim().length > 0)
      // Vite bundles this very config file into a transient sibling temp file
      // (vite.config.ts.timestamp-*.mjs) while evaluating it and deletes it right after —
      // ignore that self-inflicted untracked artifact so a genuinely clean tree isn't
      // misreported as dirty just because this code happened to run.
      .filter((line) => !/vite\.config\.ts\.timestamp-.*\.mjs$/.test(line.trim()));
    return lines.length > 0;
  } catch {
    return false;
  }
}

// Minimal build/version marker: lets a vendored artifact (e.g. word_tide/assets/vendor/game-core)
// be traced back to the game-core commit it was built from, with no extra codegen infrastructure.
// Dirty builds are marked honestly (both a `dirty` boolean and a "-dirty" commit suffix) instead
// of silently claiming to be the clean HEAD commit.
const commit = readCommit();
const dirty = readIsDirty();
const buildInfo = {
  version: readVersion(),
  commit: dirty && commit !== 'unknown' ? `${commit}-dirty` : commit,
  dirty,
  builtAt: new Date().toISOString()
};

export default defineConfig({
  define: {
    __GAME_CORE_BUILD_INFO__: JSON.stringify(buildInfo)
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'GameCore',
      formats: ['es', 'iife'],
      fileName: (format) => `game-core.${format === 'es' ? 'es' : 'iife'}.js`
    }
  },
  plugins: [
    dts({ rollupTypes: true })
  ],
  test: {
    environment: 'node'
  }
});
