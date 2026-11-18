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

test('baseline check はベースラインがなければ何もしない', () => {
  const cwd = project();
  setResults(cwd, { 'a.ts': [useEffect] });
  const run = bugyo(cwd, 'baseline', 'check');
  assert.equal(run.status, 0, run.all);
  assert.match(run.all, /がないので/);
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
