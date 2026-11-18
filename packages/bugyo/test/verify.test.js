import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

/**
 * @param {string} cwd
 * @param {object} verify
 */
function setVerify(cwd, verify) {
  const path = join(cwd, '.bugyo/config.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), verify }));
}

/**
 * @param {string} cwd
 * @param {string} from
 * @param {string} to
 */
function editFeature(cwd, from, to) {
  const file = join(cwd, 'docs/features/greet.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
}

const modeCheck = `if (process.env.MODE !== 'api') { console.error('MODE=' + process.env.MODE); process.exit(1); }\nconsole.log('api: ' + process.argv[2]);\n`;

test('runners: spec を , で並べると spec ごとに動かし、match の glob に当たる spec はその確かめ方と env で動かす', () => {
  const cwd = plainProject();
  mkdirSync(join(cwd, 'checks/api'));
  writeFileSync(join(cwd, 'checks/api/greet.js'), modeCheck);
  setVerify(cwd, { runner: 'command', command: 'node {spec}', runners: { api: { runner: 'command', command: 'node {spec} {id}', env: { MODE: 'api' }, match: 'checks/api/**' } } });
  editFeature(cwd, 'spec: checks/greet.js', 'spec: checks/greet.js, checks/api/greet.js');
  const run = bugyo(cwd, 'verify', 'greet');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^PASS greet/);
  assert.match(run.stdout, /証拠: artifacts\/verify\/greet\.1\.log, artifacts\/verify\/greet\.2\.log/);
  assert.match(readFileSync(join(cwd, 'artifacts/verify/greet.2.log'), 'utf8'), /api: greet/);
  const summary = JSON.parse(readFileSync(join(cwd, 'artifacts/verify.json'), 'utf8'));
  assert.deepEqual(summary.features[0].runs, [
    { spec: 'checks/greet.js', runner: 'command', ok: true, command: 'node checks/greet.js' },
    { spec: 'checks/api/greet.js', runner: 'api', ok: true, command: 'node checks/api/greet.js greet' },
  ]);
  assert.deepEqual(featureMapChecks({ cwd }).flatMap((check) => check.problems()), []);

  writeFileSync(join(cwd, 'checks/api/greet.js'), 'process.exit(1);\n');
  const failed = bugyo(cwd, 'verify', 'greet');
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /^FAIL greet/, '1つでも落ちれば機能は FAIL');
});

test('runners: frontmatter の runner は、その機能のすべての spec をその確かめ方で動かす', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, 'checks/greet.js'), modeCheck);
  setVerify(cwd, { runner: 'command', command: 'node {spec}', runners: { api: { runner: 'command', command: 'node {spec} {id}', env: { MODE: 'api' } } } });
  editFeature(cwd, 'spec: checks/greet.js', 'spec: checks/greet.js\nrunner: api');
  const run = bugyo(cwd, 'verify', 'greet');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(readFileSync(join(cwd, 'artifacts/verify/greet.log'), 'utf8'), /^\$ node checks\/greet\.js greet\napi: greet/);
});

test('runners: 決められない確かめ方は、動かす前に終了コード 2 で断り、feature map の検査でも出す', () => {
  const cwd = plainProject();
  setVerify(cwd, { runner: 'command', command: 'node {spec}', runners: { a: { runner: 'command', command: 'node {spec}', match: 'checks/**' }, b: { runner: 'command', command: 'node {spec}', match: '**/*.js' } } });
  const both = bugyo(cwd, 'verify', 'greet');
  assert.equal(both.status, 2);
  assert.match(both.stderr, /checks\/greet\.js が a と b の match の両方に当たります/);
  assert.ok(!existsSync(join(cwd, 'artifacts/verify.json')));

  setVerify(cwd, { runner: 'command', command: 'node {spec}' });
  editFeature(cwd, 'spec: checks/greet.js', 'spec: checks/greet.js\nrunner: nope');
  const unknown = bugyo(cwd, 'verify', 'greet');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /runner の nope がありません/);
  assert.ok(featureMapChecks({ cwd }).flatMap((check) => check.problems()).some((problem) => /runner の nope がありません/.test(problem)));
});

test('runners: 設定の誤りは読むときに断る', () => {
  const cwd = plainProject();
  for (const verify of [
    { runner: 'nope' },
    { runner: 'playwright', runners: { report: { runner: 'playwright' } } },
    { runner: 'playwright', runners: { playwright: { runner: 'playwright' } } },
    { runner: 'playwright', runners: { api: { runner: 'command' } } },
    { runner: 'playwright', runners: { api: { runner: 'playwright', env: { 'BAD-NAME': '1' } } } },
  ]) {
    setVerify(cwd, verify);
    assert.throws(() => loadConfig(cwd), /config\.json/, JSON.stringify(verify));
  }
});

/** 引数の数だけ artifacts/screens/<id>/ に画像の代わりのファイルを書くスクリプト */
const screenshotCheck = `const { mkdirSync, writeFileSync } = require('node:fs');\nconst [id, count] = process.argv.slice(2);\nmkdirSync('artifacts/screens/' + id, { recursive: true });\nfor (let i = 0; i < Number(count); i += 1) writeFileSync('artifacts/screens/' + id + '/' + i + '.png', 'shot ' + i);\n`;

test('evidence: 証拠のファイルの glob を書くと、ハッシュと一緒に残し、1つもなければ終了コードが 0 でも FAIL', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, 'checks/shots.cjs'), screenshotCheck);
  const withCount = (/** @type {number} */ count) =>
    setVerify(cwd, { runner: 'shots', runners: { shots: { runner: 'command', command: `node checks/shots.cjs {id} ${count}`, evidence: ['artifacts/screens/{id}/*.png'] } } });

  withCount(2);
  const run = bugyo(cwd, 'verify', 'greet');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /証拠: artifacts\/verify\/greet\.log, artifacts\/screens\/greet\/0\.png, artifacts\/screens\/greet\/1\.png/);
  const summary = JSON.parse(readFileSync(join(cwd, 'artifacts/verify.json'), 'utf8'));
  const sha = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
  assert.deepEqual(summary.features[0].files, [
    { path: 'artifacts/screens/greet/0.png', sha256: sha('shot 0') },
    { path: 'artifacts/screens/greet/1.png', sha256: sha('shot 1') },
  ]);

  rmSync(join(cwd, 'artifacts/screens'), { recursive: true });
  withCount(0);
  const none = bugyo(cwd, 'verify', 'greet');
  assert.equal(none.status, 1);
  assert.match(none.stdout, /^FAIL greet/);
  assert.match(none.stdout, /証拠のファイルがありません（artifacts\/screens\/greet\/\*\.png/);
});

test('evidence: 前の実行で残ったファイルは、今回の証拠にならない', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, 'checks/shots.cjs'), screenshotCheck);
  mkdirSync(join(cwd, 'artifacts/screens/greet'), { recursive: true });
  writeFileSync(join(cwd, 'artifacts/screens/greet/old.png'), 'old');
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(cwd, 'artifacts/screens/greet/old.png'), old, old);
  setVerify(cwd, { runner: 'shots', runners: { shots: { runner: 'command', command: 'node checks/shots.cjs {id} 0', evidence: ['artifacts/screens/{id}/*.png'] } } });
  const run = bugyo(cwd, 'verify', 'greet');
  assert.equal(run.status, 1, run.stdout);
  assert.ok(existsSync(join(cwd, 'artifacts/screens/greet/old.png')), 'evidence の glob に当たるファイルは消さない');
});

test('sandbox: 隔離環境が要る確かめ方は、verify.sandbox のコマンドが通るときだけ動かし、通らなければ FAIL', () => {
  const cwd = plainProject();
  writeFileSync(join(cwd, 'checks/sandbox.cjs'), "process.exit(process.env.IN_SANDBOX === '1' ? 0 : 3);\n");
  writeFileSync(join(cwd, 'checks/greet.js'), `(await import('node:fs')).writeFileSync('ran.txt', 'ran');\n${readFileSync(join(cwd, 'checks/greet.js'), 'utf8')}`);
  setVerify(cwd, { runner: 'isolated', sandbox: 'node checks/sandbox.cjs', runners: { isolated: { runner: 'command', command: 'node {spec}', requires: 'sandbox' } } });

  const outside = bugyo(cwd, 'verify', 'greet');
  assert.equal(outside.status, 1);
  assert.match(outside.stdout, /^FAIL greet/);
  assert.match(outside.stdout, /隔離環境ではないので.*isolated.*node checks\/sandbox\.cjs が終了コード 3/);
  assert.ok(!existsSync(join(cwd, 'ran.txt')), '隔離環境でなければ動かさない');

  const inside = spawnSync(process.execPath, [bin, 'verify', 'greet'], { cwd, encoding: 'utf8', env: { ...process.env, IN_SANDBOX: '1' } });
  assert.equal(inside.status, 0, inside.stdout + inside.stderr);
  assert.ok(existsSync(join(cwd, 'ran.txt')));

  setVerify(cwd, { runner: 'isolated', runners: { isolated: { runner: 'command', command: 'node {spec}', requires: 'sandbox' } } });
  assert.throws(() => loadConfig(cwd), /verify\.sandbox/);
  setVerify(cwd, { runner: 'playwright', runners: { e2e: { runner: 'playwright', evidence: ['x/*.png'] } } });
  assert.throws(() => loadConfig(cwd), /evidence は、runner が "command"/);
});

test('spec にはコマンドに入れて困る文字を書けない', () => {
  const cwd = plainProject();
  editFeature(cwd, 'spec: checks/greet.js', 'spec: checks/greet.js; rm -rf x');
  assert.throws(() => loadFeatures(cwd), /英数字/);
});

/** playwright の代わり。JSON レポートを書き、--output の場所に MODE を書く */
const fakePlaywright = `
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const args = process.argv.slice(3);
const at = args.indexOf('--output');
const output = at < 0 ? 'artifacts/test-results' : args[at + 1];
const specs = args.filter((arg, index) => !arg.startsWith('--') && (at < 0 || index !== at + 1));
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'mode.txt'), process.env.MODE ?? '');
const report = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, JSON.stringify({ config: { rootDir: process.cwd() }, suites: specs.map((file) => ({ file, specs: [{ ok: true }] })) }));
`;

test('runners: Playwright の確かめ方が2つあると、それぞれを env 付きで動かし、証拠の場所を分ける', () => {
  const cwd = plainProject();
  const binDir = join(cwd, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(cwd, 'fake-playwright.cjs'), fakePlaywright);
  writeFileSync(join(binDir, 'playwright'), `#!/bin/sh\nexec node "$(dirname "$0")/../../fake-playwright.cjs" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(binDir, 'playwright.cmd'), '@node "%~dp0\\..\\..\\fake-playwright.cjs" %*\r\n');
  setVerify(cwd, { runner: 'playwright', runners: { client: { runner: 'playwright', env: { MODE: 'client' }, match: 'checks/client/**' } } });
  mkdirSync(join(cwd, 'checks/client'));
  writeFileSync(join(cwd, 'checks/client/greet.js'), '');
  editFeature(cwd, 'spec: checks/greet.js', 'spec: checks/greet.js, checks/client/greet.js');
  const run = bugyo(cwd, 'verify', 'greet');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^PASS greet/);
  assert.match(
    run.stdout,
    /証拠: artifacts\/test-results（動画・スクリーンショット・トレース）, artifacts\/report\/index\.html, artifacts\/client\/test-results（動画・スクリーンショット・トレース）, artifacts\/client\/report\/index\.html/,
  );
  assert.equal(readFileSync(join(cwd, 'artifacts/test-results/mode.txt'), 'utf8'), '');
  assert.equal(readFileSync(join(cwd, 'artifacts/client/test-results/mode.txt'), 'utf8'), 'client');
  const runs = JSON.parse(readFileSync(join(cwd, 'artifacts/verify.json'), 'utf8')).features[0].runs;
  assert.deepEqual(
    runs.map((/** @type {any} */ entry) => [entry.spec, entry.runner, entry.ok]),
    [
      ['checks/greet.js', 'playwright', true],
      ['checks/client/greet.js', 'client', true],
    ],
  );
});

test('verify は実行のたびに、自分が書いたものだけを artifacts から消してから始める', () => {
  const cwd = plainProject();
  setVerify(cwd, { runner: 'command', command: 'node {spec}', runners: { api: { runner: 'command', command: 'node {spec}' } } });
  bugyo(cwd, 'verify', 'greet');
  for (const file of ['artifacts/verify/old.log', 'artifacts/report/old.html', 'artifacts/test-results/old.png', 'artifacts/api/old.json', 'artifacts/results.json']) {
    mkdirSync(join(cwd, file, '..'), { recursive: true });
    writeFileSync(join(cwd, file), 'old');
  }
  mkdirSync(join(cwd, 'artifacts/build'), { recursive: true });
  writeFileSync(join(cwd, 'artifacts/build/app.zip'), 'keep');
  writeFileSync(join(cwd, 'artifacts/notes.txt'), 'keep');
  bugyo(cwd, 'verify', 'greet');
  for (const file of ['artifacts/verify/old.log', 'artifacts/report', 'artifacts/test-results', 'artifacts/api', 'artifacts/results.json']) {
    assert.ok(!existsSync(join(cwd, file)), `${file} は verify が書くものなので消す`);
  }
  assert.equal(readFileSync(join(cwd, 'artifacts/build/app.zip'), 'utf8'), 'keep', 'verify が書かないものは残す');
  assert.equal(readFileSync(join(cwd, 'artifacts/notes.txt'), 'utf8'), 'keep');
  assert.ok(existsSync(join(cwd, 'artifacts/verify/greet.log')));
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
