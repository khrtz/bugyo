import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { banOf, compareCounts } from '../src/doctor.js';

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
  assert.equal(requirements(task, config)[0]?.label, 'src/features/billing/lib/ か domain/ にテストがある');
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
