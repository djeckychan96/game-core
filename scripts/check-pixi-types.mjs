// Post-build check of the PUBLISHED declarations: one type identity across `game-core` and `game-core/pixi`.
//  - the kit ships only its own declarations (dist/pixi/pixi/**): no second copy of the root's (dist/pixi/index.d.ts,
//    dist/pixi/motion/…) — a class with private members declared twice is two types to TypeScript;
//  - every import of a kit declaration stays in the kit or names the root entry's dist/index.d.ts;
//  - tests/types/pixi-consumer.ts — a host passing the root's MotionRuntime / UiRuntime … to the kit with no cast —
//    compiles against dist, resolved the way a consumer resolves it (package.json "exports", bundler resolution; the
//    package's own name resolves to itself here).
// `node scripts/check-pixi-types.mjs [packageDir]` (default: this package) — run by `npm run build`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = resolve(process.argv[2] ?? rootDir);
const failures = [];
const fail = (message) => {
  console.error(`check-pixi-types: ${message}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf-8'));
const rootTypes = resolve(packageDir, pkg.types);
const kitTypes = resolve(packageDir, pkg.exports?.['./pixi']?.types ?? '');
const kitDir = dirname(kitTypes);
for (const file of [rootTypes, kitTypes]) if (!existsSync(file)) fail(`missing ${file}`);

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(resolve(dir, entry.name)) : entry.name.endsWith('.d.ts') ? [resolve(dir, entry.name)] : []));

// 1. no copy of the root's declarations next to the kit
const kitOut = resolve(packageDir, 'dist/pixi');
const strays = readdirSync(kitOut, { withFileTypes: true })
  .filter((entry) => resolve(kitOut, entry.name) !== kitDir && (entry.isDirectory() ? walk(resolve(kitOut, entry.name)).length > 0 : entry.name.endsWith('.d.ts')))
  .map((entry) => entry.name);
if (strays.length) failures.push(`dist/pixi carries declarations outside the kit (a second copy of the root's types): ${strays.join(', ')}`);

// 2. kit declaration imports: inside the kit, or the root entry's declarations
const kitFiles = walk(kitDir);
let rootImports = 0;
for (const file of kitFiles) {
  for (const match of readFileSync(file, 'utf-8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.\.?\/[^'"]*)['"]/g)) {
    const target = resolve(dirname(file), match[1]);
    if (target.startsWith(kitDir + sep)) continue;
    if (`${target}.d.ts` === rootTypes) rootImports++;
    else failures.push(`${relative(packageDir, file)} imports '${match[1]}' — outside the kit and not the root entry (${relative(packageDir, rootTypes)})`);
  }
}
if (rootImports === 0) failures.push('no kit declaration imports the root entry (dist/index.d.ts)');

// 3. the consumer compiles against dist with no cast
const fixture = resolve(rootDir, 'tests/types/pixi-consumer.ts');
const options = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [],
  skipLibCheck: true
};
// the fixture lives in this package; checking another package dir maps the two specifiers onto it explicitly
const host = ts.createCompilerHost(options);
if (packageDir !== rootDir) {
  const entries = { 'game-core': rootTypes, 'game-core/pixi': kitTypes };
  host.resolveModuleNameLiterals = (literals, containingFile, _redirect, compilerOptions) => literals.map((literal) => {
    const fixed = entries[literal.text];
    if (fixed) return { resolvedModule: { resolvedFileName: fixed, extension: ts.Extension.Dts, isExternalLibraryImport: true } };
    return ts.resolveModuleName(literal.text, containingFile, compilerOptions, host);
  });
}
const program = ts.createProgram([fixture], options, host);
const resolved = ['game-core', 'game-core/pixi'].map((name) => ts.resolveModuleName(name, fixture, options, host).resolvedModule?.resolvedFileName);
if (packageDir === rootDir && (resolved[0] !== rootTypes || resolved[1] !== kitTypes)) fail(`the fixture does not resolve the built package: ${resolved.join(', ')}`);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  const text = ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => rootDir, getNewLine: () => '\n' });
  failures.push(`a host passing root types to the kit does not compile against ${relative(rootDir, packageDir) || '.'}/dist (${diagnostics.length} errors):\n${text}`);
}
if (failures.length) fail(failures.join('\n'));
const kitSources = program.getSourceFiles().filter((file) => file.fileName.startsWith(kitDir + sep)).length;
console.log(`check-pixi-types: OK (${kitFiles.length} kit declarations, ${rootImports} root-entry imports, 0 copies of root types; consumer compiled against dist with ${kitSources} kit files)`);
