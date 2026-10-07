import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as root from '../../src/index';

const movesDir = fileURLToPath(new URL('../../src/moves/', import.meta.url));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('the root entry exports the moves foundation', () => {
  for (const name of ['MoveRuntime', 'createStaticLevelBalanceSource', 'validateLevelBalance', 'validateLevelBalanceTable', 'starsForMovesLeft']) {
    expect(root, name).toHaveProperty(name);
  }
  // the internal record reader stays internal
  expect(root).not.toHaveProperty('readLevelBalance');
});

test('src/moves is generic: no data transport, no global, no clock, no other runtime, no game and no outcome', () => {
  const files = readdirSync(movesDir).filter((name) => name.endsWith('.ts')).sort();
  expect(files).toEqual(['MoveRuntime.ts', 'balance.ts', 'index.ts', 'source.ts']);
  const forbidden: Array<[string, RegExp]> = [
    // the source seam: no transport, backend or file system in Core — a server source is another implementation
    ['fetch', /\bfetch\b/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['WebSocket', /\bWebSocket\b/],
    ['a URL', /https?:\/\//],
    ['node / fs', /\bnode:|\brequire\s*\(|\bfs\b/],
    ['import.meta', /import\.meta/],
    ['a spreadsheet', /sheets?\b|spreadsheet/i],
    // globals and clocks
    ['Date', /\bDate\b/],
    ['performance', /\bperformance\b/],
    ['setTimeout', /\bsetTimeout\b/],
    ['setInterval', /\bsetInterval\b/],
    ['requestAnimationFrame', /\brequestAnimationFrame\b/],
    ['window', /\bwindow\b/],
    ['globalThis', /\bglobalThis\b/],
    ['document', /\bdocument\b/],
    ['localStorage', /\blocalStorage\b/],
    ['Math.random', /Math\.random/],
    ['pixi', /pixi/i],
    // no game: names, content files
    ['a game name', /puzzle|jigsaw|solipix|pixsol|gorodki|trail|arrow|bubble/i],
    ['a game content file', /levels\.json/i],
    // no outcome: running out of moves is a state, the host decides WIN / FAIL
    ['an outcome', /\b(win|won|wins|lose|lost|fail|failed|victory|defeat)\b/i]
  ];
  for (const file of files) {
    const source = stripComments(readFileSync(`${movesDir}${file}`, 'utf-8'));
    for (const [name, pattern] of forbidden) expect(pattern.test(source), `${file} references ${name}`).toBe(false);
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
      expect(match[1]!.startsWith('./'), `${file} imports ${match[1]}`).toBe(true);
    }
  }
});
