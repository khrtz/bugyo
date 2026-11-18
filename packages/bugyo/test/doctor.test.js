import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { banOf, compareCounts } from '../src/doctor.js';

/** このファイルは日本語の出力を確かめる（英語の既定は locale.test.js で確かめる）。子プロセスにも引き継がれる */
process.env['BUGYO_LOCALE'] = 'ja';

const bin = join(import.meta.dirname, '..', 'bin', 'bugyo.js');

/**
 * eslint の代わりに、eslint-results.json を出すだけのコマンドを node_modules/.bin に置く。
 * --suppress-all のときは、今の違反をファイルとルールごとに数えて eslint-suppressions.json に書く（ESLint と同じ形）。
 */
const fakeEslint = `
const { readFileSync, writeFileSync } = require('node:fs');
const results = JSON.parse(readFileSync('eslint-results.json', 'utf8'));
if (process.argv.includes('--suppress-all')) {
  const out = {};
  for (const r of results) for (const m of r.messages) {
    out[r.filePath] ??= {};
    out[r.filePath][m.ruleId] = { count: (out[r.filePath][m.ruleId]?.count ?? 0) + 1 };
  }
  writeFileSync('eslint-suppressions.json', JSON.stringify(out));
  process.exit(0);
}
let suppressions = {};
try { suppressions = JSON.parse(readFileSync('eslint-suppressions.json', 'utf8')); } catch {}
const shown = results.map((r) => {
  const left = { ...(suppressions[r.filePath] ?? {}) };
  const messages = [];
  const suppressedMessages = [];
  for (const m of r.messages) {
    if ((left[m.ruleId]?.count ?? 0) > 0) { left[m.ruleId] = { count: left[m.ruleId].count - 1 }; suppressedMessages.push({ ...m, suppressions: [{ kind: 'file' }] }); }
    else messages.push(m);
  }
  return { filePath: r.filePath, messages, suppressedMessages };
});
process.stdout.write(JSON.stringify(shown));
`;

/** @param {string} ruleId @param {string} message */
const violation = (ruleId, message) => ({ ruleId, message });

/**
 * @param {string} cwd
 * @param {Record<string, { ruleId: string, message: string }[]>} byFile
 */
function setResults(cwd, byFile) {
  writeFileSync(join(cwd, 'eslint-results.json'), JSON.stringify(Object.entries(byFile).map(([filePath, messages]) => ({ filePath, messages }))));
}

function project() {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bugyo-doctor-')), 'app');
  const binDir = join(cwd, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(cwd, 'fake-eslint.cjs'), fakeEslint);
  writeFileSync(join(binDir, 'eslint'), `#!/bin/sh\nexec node "$(dirname "$0")/../../fake-eslint.cjs" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(binDir, 'eslint.cmd'), '@node "%~dp0\\..\\..\\fake-eslint.cjs" %*\r\n');
  return cwd;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function bugyo(cwd, ...args) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, all: `${result.stdout}${result.stderr}` };
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

const useEffect = violation('no-restricted-imports', "'useEffect' import from 'react' is restricted.");
const useLayoutEffect = violation('no-restricted-imports', "'useLayoutEffect' import from 'react' is restricted.");

test('no-restricted-* はメッセージごとに、それ以外はルールごとに数える', () => {
  assert.equal(banOf(useEffect), `no-restricted-imports: ${useEffect.message}`);
  assert.equal(banOf(violation('no-console', 'Unexpected console statement.')), 'no-console');
  assert.equal(
    banOf(violation('import-x/no-restricted-paths', 'Unexpected path "~/app/ui/x" imported in restricted zone. model/ が使えるのは自分のmodelと web/app/lib だけです。')),
    'import-x/no-restricted-paths: model/ が使えるのは自分のmodelと web/app/lib だけです。',
  );
  assert.equal(banOf({ ruleId: null, message: 'Parsing error: Unexpected token' }), 'eslint: parse-error');
  assert.deepEqual(compareCounts({ a: 2, b: 1 }, { a: 1, c: 1 }), {
    grew: [{ key: 'c', from: 0, to: 1 }],
    shrank: [
      { key: 'a', from: 2, to: 1 },
      { key: 'b', from: 1, to: 0 },
    ],
  });
});

test('doctor は抑制ファイルで隠れた違反も数える', () => {
  const cwd = project();
  setResults(cwd, { 'a.ts': [useEffect, useEffect], 'b.ts': [violation('no-console', 'x')] });
  const run = bugyo(cwd, 'doctor', '--json');
  assert.equal(run.status, 0, run.all);
  const report = JSON.parse(run.all);
  assert.equal(report.total, 3);
  assert.equal(report.counts[banOf(useEffect)], 2);

  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  const again = JSON.parse(bugyo(cwd, 'doctor', '--json').all);
  assert.equal(again.total, 3, '抑制したあとも件数は変わらない');
});

test('baseline check は、同じルールの中で禁止を入れ替えても見逃さない', () => {
  const cwd = project();
  setResults(cwd, { 'a.ts': [useEffect] });
  const save = bugyo(cwd, 'baseline', 'save');
  assert.equal(save.status, 0, save.all);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.bugyo/baseline.json'), 'utf8')).counts, { [banOf(useEffect)]: 1 });
  assert.equal(bugyo(cwd, 'baseline', 'check').status, 0);

  // ESLint の抑制はファイルとルールごとの件数なので、useEffect を useLayoutEffect に替えても通ってしまう
  setResults(cwd, { 'a.ts': [useLayoutEffect] });
  const swapped = bugyo(cwd, 'baseline', 'check');
  assert.equal(swapped.status, 1);
  assert.match(swapped.all, /増えた: no-restricted-imports: 'useLayoutEffect'.* 0 → 1/);

  // 直したら、ベースラインを縮めるまで通らない
  setResults(cwd, { 'a.ts': [] });
  const fixed = bugyo(cwd, 'baseline', 'check');
  assert.equal(fixed.status, 1);
  assert.match(fixed.all, /減った: .* 1 → 0。bugyo baseline save/);
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  assert.equal(bugyo(cwd, 'baseline', 'check').status, 0);
});

test('warn に下げた禁止（bugyo-warn/…）は、下げる前と同じ禁止として数え、借りとして別にも出す', () => {
  const cwd = project();
  setResults(cwd, { 'a.ts': [useEffect] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  setResults(cwd, { 'a.ts': [{ ...useEffect, ruleId: 'bugyo-warn/no-restricted-imports', severity: 1 }] });
  const report = JSON.parse(bugyo(cwd, 'doctor', '--json').all);
  assert.deepEqual(report.counts, { [banOf(useEffect)]: 1 });
  assert.deepEqual(report.warned, { [banOf(useEffect)]: 1 });
  assert.equal(bugyo(cwd, 'baseline', 'check').status, 0, '下げただけでは件数は変わらない');
});

/** @bugyo/lint が名前を付けたメッセージ。説明の文だけを差し替えたものを作れる */
const tagged = (/** @type {string} */ text) => violation('no-restricted-imports', `'useEffect' import from 'react' is restricted. [bugyo:use-effect] ${text}`);

test('名前の付いた禁止は、後ろの説明の文が変わっても同じ禁止として数える', () => {
  const ja = tagged('製品コードでuseEffectは使えません。');
  const en = tagged('Do not use useEffect in product code.');
  assert.equal(banOf(ja), "no-restricted-imports: 'useEffect' import from 'react' is restricted. [bugyo:use-effect]");
  assert.equal(banOf(en), banOf(ja));
  assert.notEqual(banOf(violation('no-restricted-imports', "'useLayoutEffect' import from 'react' is restricted. [bugyo:use-effect] x")), banOf(ja), 'import した名前が違えば別に数える');
  assert.equal(
    banOf(violation('import-x/no-restricted-paths', 'Unexpected path "~/app/ui/x" imported in restricted zone. [bugyo:model-is-pure] model/ が使えるのは…')),
    'import-x/no-restricted-paths: [bugyo:model-is-pure]',
  );

  const cwd = project();
  setResults(cwd, { 'a.ts': [ja] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  const saved = readFileSync(join(cwd, '.bugyo/baseline.json'), 'utf8');
  assert.equal(JSON.parse(saved).version, 2);
  setResults(cwd, { 'a.ts': [en] });
  const check = bugyo(cwd, 'baseline', 'check');
  assert.equal(check.status, 0, check.all);
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  assert.equal(readFileSync(join(cwd, '.bugyo/baseline.json'), 'utf8'), saved, '説明の文が変わっても、作り直したベースラインは同じ');
});

test('名前で数える前の形式のベースラインは、今までの数え方で確かめる', () => {
  const cwd = project();
  const ja = tagged('製品コードでuseEffectは使えません。');
  mkdirSync(join(cwd, '.bugyo'), { recursive: true });
  writeFileSync(join(cwd, '.bugyo/baseline.json'), JSON.stringify({ counts: { "no-restricted-imports: 'useEffect' import from 'react' is restricted. 製品コードでuseEffectは使えません。": 1 } }));
  setResults(cwd, { 'a.ts': [ja] });
  const same = bugyo(cwd, 'baseline', 'check');
  assert.equal(same.status, 0, same.all);
  assert.match(same.all, /前の形式です/);

  setResults(cwd, { 'a.ts': [ja, ja] });
  assert.equal(bugyo(cwd, 'baseline', 'check').status, 1, '古い形式でも、増えたら落ちる');
});

test('baseline diff は、base のベースラインが前の形式なら、ルールごとの件数で比べる', () => {
  const cwd = project();
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'test');
  mkdirSync(join(cwd, '.bugyo'), { recursive: true });
  writeFileSync(join(cwd, '.bugyo/baseline.json'), JSON.stringify({ counts: { "no-restricted-imports: 'useEffect' import from 'react' is restricted. 製品コードでuseEffectは使えません。": 1 } }));
  writeFileSync(join(cwd, 'eslint-suppressions.json'), JSON.stringify({ 'a.ts': { 'no-restricted-imports': { count: 1 } } }));
  setResults(cwd, { 'a.ts': [] });
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');

  setResults(cwd, { 'a.ts': [tagged('製品コードでuseEffectは使えません。')] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  const resaved = bugyo(cwd, 'baseline', 'diff', '--base', 'main');
  assert.match(resaved.all, /より増えたところはありません/, '作り直しただけでは増えたことにならない');

  setResults(cwd, { 'a.ts': [tagged('x'), tagged('x')] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  const grown = bugyo(cwd, 'baseline', 'diff', '--base', 'main');
  assert.equal(grown.status, 1);
  assert.match(grown.all, /\.bugyo\/baseline\.json: no-restricted-imports 1 → 2/);
});

test('baseline diff は、base より古い形式に戻したベースラインを、増えたことにする', () => {
  const cwd = project();
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'test');
  const fetchBan = violation('no-restricted-globals', "Unexpected use of 'fetch'. [bugyo:fetch] fetchを直接呼ばないでください。");
  const timerBan = violation('no-restricted-globals', "Unexpected use of 'setTimeout'. [bugyo:ui-timers] UIでsetTimeoutによるタイミング合わせはできません。");
  setResults(cwd, { 'a.ts': [fetchBan] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');

  // 同じルールの中で fetch を直して setTimeout を足し、古い形式（version なし、文で数える）に書き戻す
  writeFileSync(join(cwd, '.bugyo/baseline.json'), JSON.stringify({ counts: { "no-restricted-globals: Unexpected use of 'setTimeout'. UIでsetTimeoutによるタイミング合わせはできません。": 1 } }));
  const downgraded = bugyo(cwd, 'baseline', 'diff', '--base', 'main');
  assert.equal(downgraded.status, 1, downgraded.all);
  assert.match(downgraded.all, /形式が main の 2 から 1 に戻っています/);
  setResults(cwd, { 'a.ts': [timerBan] });
  assert.equal(bugyo(cwd, 'baseline', 'check').status, 0, 'check は古い形式のまま通るので、diff で止める');
});

test('baseline check はベースラインがなければ何もしない', () => {
  const cwd = project();
  setResults(cwd, { 'a.ts': [useEffect] });
  const run = bugyo(cwd, 'baseline', 'check');
  assert.equal(run.status, 0, run.all);
  assert.match(run.all, /がないので/);
});

test('baseline check は、抑制ファイルだけを残して .bugyo/baseline.json を消すと落ちる', () => {
  const cwd = project();
  setResults(cwd, { 'a.ts': [useEffect] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  rmSync(join(cwd, '.bugyo'), { recursive: true });
  const run = bugyo(cwd, 'baseline', 'check');
  assert.equal(run.status, 1);
  assert.match(run.all, /eslint-suppressions\.json があるのに \.bugyo\/baseline\.json がありません/);
});

const layers = { app: 'web/pages', features: 'web/features', shared: { ui: 'web/app/ui', api: 'web/app/api', lib: 'web/app/lib' } };

/** @param {string} cwd */
function withLayers(cwd) {
  mkdirSync(join(cwd, '.bugyo'), { recursive: true });
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ layers }));
  for (const file of ['web/pages/home.tsx', 'web/features/billing/index.ts', 'web/app/ui/Button.tsx', 'web/main.tsx', 'web/legacy/old.js', 'web/legacy/notes.md']) {
    mkdirSync(join(cwd, file, '..'), { recursive: true });
    writeFileSync(join(cwd, file), '');
  }
}

test('layers: doctor は、どの層にも入っていないコードのファイルを出す', () => {
  const cwd = project();
  withLayers(cwd);
  setResults(cwd, {});
  const run = bugyo(cwd, 'doctor', '--json');
  assert.equal(run.status, 0, run.all);
  assert.deepEqual(JSON.parse(run.all).outsideLayers, ['web/legacy/old.js', 'web/main.tsx']);
});

test('layers: shared の各値は配列でも書け、model と other の場所も層に入る', async () => {
  const cwd = project();
  withLayers(cwd);
  const shared = { ui: 'web/app/ui', api: ['web/app/api'], lib: ['web/app/lib', 'web/lib'], model: 'web/app/domain', other: ['web/legacy'] };
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ layers: { ...layers, shared } }));
  for (const file of ['web/lib/format.ts', 'web/app/domain/price.ts']) {
    mkdirSync(join(cwd, file, '..'), { recursive: true });
    writeFileSync(join(cwd, file), '');
  }
  setResults(cwd, {});
  const run = bugyo(cwd, 'doctor', '--json');
  assert.equal(run.status, 0, run.all);
  assert.deepEqual(JSON.parse(run.all).outsideLayers, ['web/main.tsx']);
  const { loadConfig } = await import('../src/config.js');
  assert.deepEqual(loadConfig(cwd).layers?.shared, { ui: ['web/app/ui'], api: ['web/app/api'], lib: ['web/app/lib', 'web/lib'], model: ['web/app/domain'], other: ['web/legacy'] });
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ layers: { ...layers, shared: { ...shared, lib: [] } } }));
  assert.throws(() => loadConfig(cwd), /config\.json が不正です/);
});

const sources = {
  web: { src: 'web', layers: { featureParts: { ui: ['components'] } } },
  server: { src: 'server/src', tsconfig: 'server/tsconfig.json' },
};
const sourceFiles = [
  'web/app/main.tsx',
  'web/features/invoices/components/List.tsx',
  'web/legacy.ts',
  'server/src/app/main.ts',
  'server/src/features/invoices/model/total.ts',
  'server/src/features/invoices/model/total.test.ts',
  'server/src/scripts/seed.ts',
];

test('sources: doctor はソースごとに、どの層にも入っていないファイルと feature の中のフォルダを見る', () => {
  const cwd = project();
  setResults(cwd, {});
  withFiles(cwd, { sources }, sourceFiles);
  const run = bugyo(cwd, 'doctor', '--json');
  assert.equal(run.status, 0, run.all);
  const report = JSON.parse(run.all);
  assert.deepEqual(report.outsideLayers, ['server/src/scripts/seed.ts', 'web/legacy.ts']);
  assert.deepEqual(report.featureParts, { features: 2, ui: 1, model: 2, unassigned: [] });
});

test('sources: ルートの dependency-cruiser の設定には、tsconfig を書いていないソースだけを渡す', () => {
  const cwd = project();
  setResults(cwd, {});
  withFiles(cwd, { sources }, sourceFiles);
  writeFileSync(join(cwd, '.dependency-cruiser.cjs'), 'module.exports = {};\n');
  writeFileSync(join(cwd, 'fake-depcruise.cjs'), "require('node:fs').writeFileSync('depcruise-args.json', JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write('{\"summary\":{\"violations\":[]}}');\n");
  const binDir = join(cwd, 'node_modules', '.bin');
  writeFileSync(join(binDir, 'depcruise'), `#!/bin/sh\nexec node "$(dirname "$0")/../../fake-depcruise.cjs" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(binDir, 'depcruise.cmd'), '@node "%~dp0\\..\\..\\fake-depcruise.cjs" %*\r\n');
  const run = bugyo(cwd, 'doctor', '--json');
  assert.equal(run.status, 0, run.all);
  const args = JSON.parse(readFileSync(join(cwd, 'depcruise-args.json'), 'utf8'));
  assert.ok(args.includes('web'), args.join(' '));
  assert.ok(!args.some((/** @type {string} */ arg) => arg.startsWith('server')), `server は自分の tsconfig を使うので渡さない: ${args.join(' ')}`);
});

test('sources: 同じ id の機能は1つとして扱い、logic のテストはどのソースの model にあってもよい', async () => {
  const { loadConfig, featureRoots } = await import('../src/config.js');
  const { requirements } = await import('../src/evidence.js');
  const cwd = project();
  withFiles(cwd, { sources }, sourceFiles);
  const config = loadConfig(cwd);
  assert.deepEqual(
    featureRoots(config).map((root) => root.featuresDir),
    ['web/features', 'server/src/features'],
  );
  const task = /** @type {any} */ ({ id: 't1', type: 'logic', feature: 'invoices' });
  assert.equal(requirements(task, config)[0]?.label, 'web/features/invoices/model/ か server/src/features/invoices/model/ にテストがある');
  const run = bugyo(cwd, 'new', 'feature', 'payments');
  assert.equal(run.status, 1);
  assert.match(run.all, /sources があるので.*web\/features\/payments・server\/src\/features\/payments/);
});

test('sources: layers と一緒に書いたり、src が重なったりする設定は断る', async () => {
  const { loadConfig } = await import('../src/config.js');
  for (const config of [{ sources, layers }, { sources: { a: { src: 'web' }, b: { src: 'web/admin' } } }, { sources: {} }, { sources: { Web: { src: 'web' } } }]) {
    const cwd = project();
    withFiles(cwd, config, []);
    assert.throws(() => loadConfig(cwd), /config\.json/, JSON.stringify(config));
  }
});

/**
 * 外の lint の代わりに、sarif-results.json の結果を SARIF にして書くスクリプトを置き、.bugyo/config.json の sarif に登録する。
 *
 * @param {string} cwd
 */
function withSarif(cwd) {
  writeFileSync(
    join(cwd, 'fake-scan.cjs'),
    "const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');\nconst results = JSON.parse(readFileSync('sarif-results.json', 'utf8'));\nmkdirSync('artifacts', { recursive: true });\nwriteFileSync('artifacts/scan.sarif', JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'scanner' } }, results }] }));\nprocess.exit(results.length > 0 ? 1 : 0);\n",
  );
  mkdirSync(join(cwd, '.bugyo'), { recursive: true });
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ sarif: [{ command: 'node fake-scan.cjs', file: 'artifacts/scan.sarif' }] }));
}

/** @param {string} cwd @param {object[]} results */
const setSarif = (cwd, results) => writeFileSync(join(cwd, 'sarif-results.json'), JSON.stringify(results));
/** @param {string} ruleId @param {string} file @param {number} line */
const finding = (ruleId, file, line) => ({ ruleId, message: { text: 'x' }, locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: line } } }] });

test('sarif: 外の lint の結果をツールとルールごとに数え、ファイルや行が変わっただけでは件数は変わらない', () => {
  const cwd = project();
  setResults(cwd, { 'a.ts': [] });
  withSarif(cwd);
  setSarif(cwd, [
    finding('no-eval', 'src/a.ts', 3),
    finding('no-eval', 'src/b.ts', 9),
    finding('weak-hash', 'src/c.ts', 1),
    { ...finding('no-eval', 'src/d.ts', 1), suppressions: [{ kind: 'inSource', status: 'accepted' }] },
    { ...finding('no-eval', 'src/e.ts', 1), kind: 'pass' },
  ]);
  const report = JSON.parse(bugyo(cwd, 'doctor', '--json').all);
  assert.deepEqual(report.counts, { 'sarif: scanner/no-eval': 2, 'sarif: scanner/weak-hash': 1 });

  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  setSarif(cwd, [finding('no-eval', 'src/x.ts', 40), finding('no-eval', 'src/y.ts', 2), finding('weak-hash', 'src/z.ts', 7)]);
  const moved = bugyo(cwd, 'baseline', 'check');
  assert.equal(moved.status, 0, moved.all);

  setSarif(cwd, [finding('no-eval', 'src/x.ts', 40), finding('no-eval', 'src/y.ts', 2), finding('weak-hash', 'src/z.ts', 7), finding('weak-hash', 'src/z.ts', 8)]);
  const grown = bugyo(cwd, 'baseline', 'check');
  assert.equal(grown.status, 1);
  assert.match(grown.all, /増えた: sarif: scanner\/weak-hash 1 → 2/);
});

test('sarif: コマンドが SARIF を書かなければ、前の実行のファイルを読まずに落ちる', () => {
  const cwd = project();
  setResults(cwd, { 'a.ts': [] });
  withSarif(cwd);
  setSarif(cwd, [finding('no-eval', 'src/a.ts', 3)]);
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  writeFileSync(join(cwd, 'fake-scan.cjs'), 'process.exit(2);\n');
  const run = bugyo(cwd, 'baseline', 'check');
  assert.equal(run.status, 1);
  assert.match(run.all, /artifacts\/scan\.sarif がありません（node fake-scan\.cjs が書くはずのファイル）/);
});

test('doctor は構文エラーのファイルと場所とメッセージを出す', () => {
  const cwd = project();
  setResults(cwd, { [join(cwd, 'src', 'broken.ts')]: [{ ruleId: null, message: 'Parsing error: Unexpected token', line: 3 }] });
  const run = bugyo(cwd, 'doctor', '--json');
  assert.equal(run.status, 0, run.all);
  assert.deepEqual(JSON.parse(run.all).parseErrors, [{ file: 'src/broken.ts', line: 3, message: 'Parsing error: Unexpected token' }]);
  assert.match(bugyo(cwd, 'doctor').all, /構文エラー 1件[\s\S]*src\/broken\.ts:3 {2}Parsing error: Unexpected token/);
});

/**
 * @param {string} cwd
 * @param {object} config
 * @param {string[]} files
 */
function withFiles(cwd, config, files) {
  mkdirSync(join(cwd, '.bugyo'), { recursive: true });
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify(config));
  for (const file of files) {
    mkdirSync(join(cwd, file, '..'), { recursive: true });
    writeFileSync(join(cwd, file), '');
  }
}

const featureFiles = ['src/features/billing/components/Invoice.tsx', 'src/features/billing/hooks/useInvoice.ts', 'src/features/billing/lib/total.ts', 'src/features/billing/index.ts'];

test('featureParts: doctor は、どの役割にも入っていないフォルダと、ui・model の禁止が当たるファイルの数を出す', () => {
  const cwd = project();
  setResults(cwd, {});
  withFiles(cwd, {}, featureFiles);
  const before = bugyo(cwd, 'doctor', '--json');
  assert.equal(before.status, 0, before.all);
  assert.deepEqual(JSON.parse(before.all).featureParts, {
    features: 1,
    ui: 0,
    model: 0,
    unassigned: ['src/features/billing/components', 'src/features/billing/hooks', 'src/features/billing/lib'],
  });
  assert.match(bugyo(cwd, 'doctor').all, /ui の禁止が何にも当たっていません/);

  withFiles(cwd, { layers: { featureParts: { ui: ['components', 'hooks'], model: ['lib'] } } }, []);
  const after = JSON.parse(bugyo(cwd, 'doctor', '--json').all);
  assert.deepEqual(after.featureParts, { features: 1, ui: 2, model: 1, unassigned: [] });
});

test('featureParts: ui のない構成（model だけの feature）では、0件の注意を出さない', () => {
  const cwd = project();
  setResults(cwd, {});
  withFiles(cwd, {}, ['src/features/slug/model/slug.ts', 'src/features/slug/index.ts']);
  const run = bugyo(cwd, 'doctor');
  assert.equal(run.status, 0, run.all);
  assert.doesNotMatch(run.all, /何にも当たっていません/);
});

test('featureParts: フォルダ名は / を含まない名前の、空でない配列でなければ断る', async () => {
  const { loadConfig } = await import('../src/config.js');
  for (const featureParts of [{ ui: [] }, { ui: ['a/b'] }, { ui: ['..'] }, { ui: 'components' }, { view: ['components'] }, { model: ['ui'] }]) {
    const cwd = project();
    withFiles(cwd, { layers: { featureParts } }, []);
    assert.throws(() => loadConfig(cwd), /config\.json が不正です/, JSON.stringify(featureParts));
  }
});

test('featureParts: logic タスクのテストは、model の役割のどのフォルダにあってもよい', async () => {
  const { requirements } = await import('../src/evidence.js');
  const { loadConfig } = await import('../src/config.js');
  const cwd = project();
  withFiles(cwd, { layers: { featureParts: { model: ['lib', 'domain'] } } }, []);
  const config = loadConfig(cwd);
  const task = /** @type {any} */ ({ id: 't1', type: 'logic', feature: 'billing' });
  assert.equal(requirements(task, config)[0]?.label, 'src/features/billing/lib/ か src/features/billing/domain/ にテストがある');
});

test('layers: 機能のフォルダの既定は layers.features になり、new feature は雛形を作らず断る', async () => {
  const cwd = project();
  withLayers(cwd);
  const { loadConfig } = await import('../src/config.js');
  assert.equal(loadConfig(cwd).featureMap.featuresDir, 'web/features');
  const run = bugyo(cwd, 'new', 'feature', 'invoices');
  assert.equal(run.status, 1);
  assert.match(run.all, /layers があるので.*web\/features\/invoices を手で作り/);
  assert.equal(readFileSync(join(cwd, '.bugyo/config.json'), 'utf8'), JSON.stringify({ layers }));
});

test('layers: 層のフォルダは ./ や末尾の / のない相対パスでなければ断る', async () => {
  const cwd = project();
  mkdirSync(join(cwd, '.bugyo'), { recursive: true });
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ layers: { ...layers, app: './web/pages/' } }));
  const { loadConfig } = await import('../src/config.js');
  assert.throws(() => loadConfig(cwd), /相対パス/);
});

test('baseline diff は、base よりベースラインが増えたら落ち、減っただけなら通る', () => {
  const cwd = project();
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'test');
  setResults(cwd, { 'a.ts': [useEffect, useEffect] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'switch', '-q', '-c', 'feature');

  setResults(cwd, { 'a.ts': [useEffect] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  const shrunk = bugyo(cwd, 'baseline', 'diff', '--base', 'main');
  assert.equal(shrunk.status, 0, shrunk.all);

  setResults(cwd, { 'a.ts': [useEffect], 'b.ts': [useLayoutEffect] });
  assert.equal(bugyo(cwd, 'baseline', 'save').status, 0);
  const grown = bugyo(cwd, 'baseline', 'diff', '--base', 'main');
  assert.equal(grown.status, 1);
  assert.match(grown.all, /\.bugyo\/baseline\.json: no-restricted-imports: 'useLayoutEffect'.* 0 → 1/);
  assert.match(grown.all, /eslint-suppressions\.json: b\.ts no-restricted-imports 0 → 1/);
  assert.match(grown.all, /bugyo-baseline-approved/);

  rmSync(join(cwd, '.bugyo'), { recursive: true });
  rmSync(join(cwd, 'eslint-suppressions.json'));
  assert.equal(bugyo(cwd, 'baseline', 'diff', '--base', 'main').status, 0, 'ベースラインを消すのは増えたことにならない');
});
