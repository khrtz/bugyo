import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, taskCommands } from '../src/config.js';
import { featureMapChecks } from '../src/feature-map-checks.js';
import { loadFeatures } from '../src/feature-map.js';

const bin = join(import.meta.dirname, '..', 'bin', 'bugyo.js');
const fixture = join(import.meta.dirname, 'fixtures', 'plain');

function plainProject() {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bugyo-plain-')), 'app');
  cpSync(fixture, cwd, { recursive: true });
  return cwd;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function bugyo(cwd, ...args) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('command 方式: React も Playwright もないプロジェクトで verify が PASS を出す', () => {
  const cwd = plainProject();
  const run = bugyo(cwd, 'verify', 'greet');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines[0], 'PASS greet  確認手順: docs/features/greet.md');
  assert.equal(lines[1], '証拠: artifacts/verify/greet.log');
  assert.equal(lines.length, 2);
  assert.match(readFileSync(join(cwd, 'artifacts/verify/greet.log'), 'utf8'), /^\$ node checks\/greet\.js\n.*greet: ok/s);
});

test('command 方式: 壊すと FAIL と終了コード 1、末尾に失敗の出力が付く', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, 'lib/greet/model/greet.js'), 'export function greet(name) {\n  return `hi ${name}`;\n}\n');
  const run = bugyo(cwd, 'verify', '--all');
  assert.equal(run.status, 1);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines[0], 'FAIL greet  確認手順: docs/features/greet.md');
  assert.equal(lines[1], '証拠: artifacts/verify/greet.log');
  assert.match(run.stdout, /"hi bugyo"/);
});

test('command 方式: feature map にない機能は終了コード 2 で候補を出す', () => {
  const run = bugyo(plainProject(), 'verify', 'nope');
  assert.equal(run.status, 2);
  assert.match(run.stderr, /候補: greet/);
});

test('verify は実行のたびに artifacts を消してから始める', () => {
  const cwd = plainProject();
  bugyo(cwd, 'verify', 'greet');
  writeFileSync(join(cwd, 'artifacts/stale.txt'), 'old');
  bugyo(cwd, 'verify', 'greet');
  assert.ok(!existsSync(join(cwd, 'artifacts/stale.txt')));
});

test('設定がなければ playwright 方式と今までの場所になる', () => {
  const cwd = plainProject();
  rmSync(join(cwd, '.bugyo'), { recursive: true });
  assert.deepEqual(loadConfig(cwd), {
    packageManager: 'pnpm',
    verify: { runner: 'playwright' },
    featureMap: { specDir: 'e2e', specSuffix: '.spec.ts', featuresDir: 'src/features' },
    evidence: { tree: ['src', 'e2e'] },
    gate: { window: 20, maxRework: 2, minFirstPass: 16, maxDropped: 2 },
    claims: {},
    notify: {},
  });
});

test('パッケージマネージャーは packageManager、lockfile の順に決まり、commands の既定がそれに合う', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ verify: { runner: 'command', command: 'node {spec}' } }));
  const pkgPath = join(cwd, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  writeFileSync(join(cwd, 'package-lock.json'), '{}');
  assert.equal(loadConfig(cwd).packageManager, 'npm');
  assert.deepEqual(taskCommands(loadConfig(cwd)), { check: 'npm run check', test: 'npm test', verify: 'bugyo verify {feature}' });

  writeFileSync(pkgPath, JSON.stringify({ ...pkg, packageManager: 'yarn@4.5.0' }));
  assert.equal(loadConfig(cwd).packageManager, 'yarn');

  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ packageManager: 'bun', verify: { runner: 'command', command: 'node {spec}' } }));
  assert.equal(taskCommands(loadConfig(cwd)).check, 'bun run check');

  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ packageManager: 'deno' }));
  assert.throws(() => loadConfig(cwd), /config\.json が不正です/);
});

test('runner が command なのにコマンドがない設定は断る', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ verify: { runner: 'command' } }));
  assert.throws(() => loadConfig(cwd), /verify\.command/);
});

test('知らないキーのある設定は断る', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ verfy: {} }));
  assert.throws(() => loadConfig(cwd), /config\.json が不正です/);
});

test('route は任意で、spec は相対パスなら形を問わない', () => {
  const [feature] = loadFeatures(plainProject());
  assert.equal(feature?.route, undefined);
  assert.equal(feature?.spec, 'checks/greet.js');
});

test('spec に絶対パスや .. は書けない', () => {
  const cwd = plainProject();
  const file = join(cwd, 'docs/features/greet.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('spec: checks/greet.js', 'spec: ../outside.js'));
  assert.throws(() => loadFeatures(cwd), /相対パス/);
});

test('feature map の検査は設定の場所を使い、すべて通る', () => {
  const checks = featureMapChecks({ cwd: plainProject() });
  assert.deepEqual(
    checks.map((check) => [check.skip, check.problems()]),
    checks.map(() => [null, []]),
  );
});

test('feature map の検査: 対応しない spec と機能のフォルダを見つける', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, 'checks/orphan.js'), '');
  cpSync(join(cwd, 'lib/greet'), join(cwd, 'lib/stray'), { recursive: true });
  const problems = featureMapChecks({ cwd }).flatMap((check) => check.problems());
  assert.ok(problems.includes('checks/orphan.js に対応する docs/features/*.md がありません'), problems.join('\n'));
  assert.ok(problems.includes('lib/stray に対応する docs/features/stray.md がありません'), problems.join('\n'));
});

test('feature map の検査: フォルダがない検査は理由つきで飛ばす', () => {
  const cwd = plainProject();
  rmSync(join(cwd, 'lib'), { recursive: true });
  const checks = featureMapChecks({ cwd, specDir: null });
  assert.deepEqual(
    checks.filter((check) => check.skip !== null).map((check) => check.skip),
    ['設定で外されています', 'lib がありません'],
  );
});
