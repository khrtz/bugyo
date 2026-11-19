import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const bin = join(import.meta.dirname, '..', 'bin', 'bugyo.js');
const fixture = join(import.meta.dirname, 'fixtures', 'plain');

/** @param {Record<string, string>} [extra] */
function env(extra = {}) {
  const copy = { ...process.env, ...extra };
  if (extra['BUGYO_LOCALE'] === undefined) delete copy['BUGYO_LOCALE'];
  return copy;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} [extra]
 */
function bugyo(cwd, args, extra) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: env(extra) });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** @param {(config: Record<string, unknown>) => void} [change] */
function project(change) {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bugyo-locale-')), 'app');
  cpSync(fixture, cwd, { recursive: true });
  if (change !== undefined) {
    const path = join(cwd, '.bugyo/config.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    change(config);
    writeFileSync(path, JSON.stringify(config, null, 2));
  }
  return cwd;
}

test('既定は英語: タスクの一覧・着手・断る理由・lint・門番・実績・ミス', () => {
  const cwd = project();
  assert.equal(bugyo(cwd, ['task', 'ls']).stdout.trim(), 'No tasks');
  assert.match(bugyo(cwd, ['task', 'add', 'Fix greeting', '--type', 'chore']).stdout, /^t-001 \[open\/chore\] Fix greeting$/m);
  assert.match(bugyo(cwd, ['task', 'start', 't-001', '--as', 'w1']).stdout, /\(assignee: w1\)/);
  const busy = bugyo(cwd, ['task', 'start', 't-001', '--as', 'w2']);
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /^t-001 is already being worked on by w1$/m);
  assert.match(bugyo(cwd, ['task', 'show', 't-001']).stdout, /^done requires: node scripts\/check\.js$/m);
  assert.match(bugyo(cwd, ['task', 'lint']).stdout, /^task lint: 1 tasks, 0 errors, 0 warnings$/m);
  assert.match(bugyo(cwd, ['gate']).stdout, /^gate: FAIL \(judged per group/m);
  assert.equal(bugyo(cwd, ['stats']).stdout.trim(), 'stats: no closed tasks yet');
  assert.equal(bugyo(cwd, ['mistake', 'ls']).stdout.trim(), 'No mistakes recorded');
  const usage = bugyo(cwd, ['task', 'nope']);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^bugyo task subcommands: add/m);
  assert.match(usage.stderr, /^Usage:$/m);
});

test('既定は英語: 設定の誤りも英語で出す', () => {
  const cwd = project((config) => (config['unknown'] = true));
  const run = bugyo(cwd, ['gate']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^\.bugyo\/config\.json is invalid:/m);
});

test('.bugyo/config.json の locale か BUGYO_LOCALE で日本語にする（設定が壊れていても locale は読む）', () => {
  const ja = project((config) => (config['locale'] = 'ja'));
  assert.equal(bugyo(ja, ['task', 'ls']).stdout.trim(), 'タスクはありません');
  assert.equal(bugyo(project(), ['task', 'ls'], { BUGYO_LOCALE: 'ja' }).stdout.trim(), 'タスクはありません');
  const broken = project((config) => {
    config['locale'] = 'ja';
    config['unknown'] = true;
  });
  assert.match(bugyo(broken, ['gate']).stderr, /^\.bugyo\/config\.json が不正です:/m);
  const wrong = bugyo(project(), ['task', 'ls'], { BUGYO_LOCALE: 'fr' });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /BUGYO_LOCALE must be en or ja/);
});

test('既定は英語: new feature の feature map は英語の見出しで作り、task done は雛形のままの見出しを断る', () => {
  const cwd = project((config) => {
    config['template'] = 'node-lib';
    /** @type {Record<string, string>} */ (config['commands'])['verify'] = `node "${bin}" verify {feature}`;
  });
  const created = bugyo(cwd, ['new', 'feature', 'shout']);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /^Created:$/m);
  assert.match(created.stdout, /^Next:$/m);
  const doc = readFileSync(join(cwd, 'docs/features/shout.md'), 'utf8');
  for (const heading of ['## What is there', '## How to reach it', '## How to check it', '## Where it lies']) assert.ok(doc.includes(heading), heading);
  assert.match(readFileSync(join(cwd, 'lib/shout/model/shout.test.ts'), 'utf8'), /trims surrounding spaces/);

  assert.equal(bugyo(cwd, ['task', 'add', 'Shout', '--type', 'feature', '--feature', 'shout']).status, 0);
  assert.equal(bugyo(cwd, ['task', 'start', 't-001', '--as', 'w1']).status, 0);
  const done = bugyo(cwd, ['task', 'done', 't-001']);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /^FAIL t-001 .*fill the four headings of docs\/features\/shout\.md: docs\/features\/shout\.md has empty or template headings: What is there, How to reach it, How to check it, Where it lies \(gate-attempts: 1\)$/m);
});

test('init のあとのコマンドは、実行したパッケージマネージャーに合わせる', () => {
  const root = mkdtempSync(join(tmpdir(), 'bugyo-locale-'));
  const npm = bugyo(root, ['init', 'with-npm', '--template', 'node-lib'], { npm_config_user_agent: 'npm/11.0.0 node/v24.0.0' });
  assert.equal(npm.status, 0, npm.stderr);
  assert.match(npm.stdout, /^Created: .*with-npm \(template: node-lib\)$/m);
  assert.match(npm.stdout, /^ {2}npm install$/m);
  assert.match(npm.stdout, /^ {2}npm run check && npm test && npm run verify --all$/m);
  const pnpm = bugyo(root, ['init', 'with-pnpm'], { npm_config_user_agent: 'pnpm/11.8.0 npm/? node/v24.0.0' });
  assert.match(pnpm.stdout, /^ {2}pnpm exec playwright install chromium$/m);
  assert.match(pnpm.stdout, /^ {2}pnpm check && pnpm test && pnpm verify --all$/m);
});
