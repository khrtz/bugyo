import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hooks = join(import.meta.dirname, '..', '..', '..', 'plugin', 'hooks');
const bugyoPackage = join(import.meta.dirname, '..');

/**
 * @param {string} name
 * @param {object | string} event
 * @returns {Record<string, any> | undefined}
 */
function run(name, event) {
  const input = typeof event === 'string' ? event : JSON.stringify(event);
  const result = spawnSync(process.execPath, [join(hooks, name)], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() === '' ? undefined : JSON.parse(result.stdout);
}

/** @param {object} event */
const stop = (event) => run('stop-check.mjs', event);
/** @param {object} event */
const sessionStart = (event) => run('session-start.mjs', event)?.hookSpecificOutput;

/** 台帳と、node_modules から使える bugyo を持つプロジェクトを作る */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'bugyo-hooks-'));
  mkdirSync(join(dir, '.bugyo', 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(bugyoPackage, join(dir, 'node_modules', 'bugyo'), 'junction');
  return dir;
}

/**
 * @param {string} dir
 * @param {string} id
 * @param {string} fields
 * @param {string} title
 */
function writeTask(dir, id, fields, title) {
  writeFileSync(join(dir, '.bugyo', 'tasks', `${id}.md`), `---\n${fields}\n---\n\n# ${title}\n`);
}

/** @param {string} dir */
const writeHandEditedDone = (dir) => writeTask(dir, 't-001', 'status: done\ntype: chore', '手で閉じたタスク');

test('Stop: 台帳が正しく、作業中のタスクもなければ何もしない', () => {
  const dir = project();
  writeTask(dir, 't-001', 'status: open\ntype: chore', 'まだのタスク');
  assert.equal(stop({ cwd: dir, stop_hook_active: false }), undefined);
});

test('Stop: 手で done にしたタスクがあれば、task lint の出力をつけて止める', () => {
  const dir = project();
  writeHandEditedDone(dir);
  const output = stop({ cwd: dir, stop_hook_active: false });
  assert.equal(output?.decision, 'block');
  assert.match(output?.reason, /bugyo task lint が落ちました/);
  assert.match(output?.reason, /t-001\.md: done のタスクは \.bugyo\/tasks\/archive に置きます/);
  assert.match(output?.reason, /bugyo task start \/ done \/ rework \/ drop/);
});

test('Stop: 下のフォルダから呼ばれても、台帳のあるフォルダで確かめる', () => {
  const dir = project();
  writeHandEditedDone(dir);
  mkdirSync(join(dir, 'src', 'features'), { recursive: true });
  assert.match(stop({ cwd: join(dir, 'src', 'features'), stop_hook_active: false })?.reason, /t-001\.md/);
});

test('Stop: 2回目の Stop では止めない（止め続けない）', () => {
  const dir = project();
  writeHandEditedDone(dir);
  assert.equal(stop({ cwd: dir, stop_hook_active: true }), undefined);
});

test('Stop: 作業中のタスクが残っていれば、止めずに知らせる', () => {
  const dir = project();
  writeTask(dir, 't-001', 'status: active\ntype: chore\nassignee: w1', '途中のタスク');
  writeTask(dir, 't-002', 'status: open\ntype: chore', 'まだのタスク');
  const output = stop({ cwd: dir, stop_hook_active: false });
  assert.equal(output?.decision, undefined);
  assert.match(output?.systemMessage, /^作業中のタスクが 1件残っています。/);
  assert.match(output?.systemMessage, /t-001 途中のタスク（担当: w1）/);
  assert.doesNotMatch(output?.systemMessage, /t-002/);
});

test('Stop・SessionStart: 台帳か bugyo がなければ何もしない。読めない入力でも何もしない', () => {
  const empty = mkdtempSync(join(tmpdir(), 'bugyo-hooks-'));
  assert.equal(stop({ cwd: empty, stop_hook_active: false }), undefined);
  assert.equal(sessionStart({ cwd: empty }), undefined);
  const noCli = mkdtempSync(join(tmpdir(), 'bugyo-hooks-'));
  mkdirSync(join(noCli, '.bugyo', 'tasks'), { recursive: true });
  writeHandEditedDone(noCli);
  assert.equal(stop({ cwd: noCli, stop_hook_active: false }), undefined);
  assert.equal(sessionStart({ cwd: noCli }), undefined);
  assert.equal(run('stop-check.mjs', 'not json'), undefined);
  assert.equal(run('session-start.mjs', 'not json'), undefined);
});

test('SessionStart: 作業中と着手できるタスクと、使うコマンドを渡す', () => {
  const dir = project();
  writeTask(dir, 't-001', 'status: active\ntype: chore\nassignee: w1', '途中のタスク');
  writeTask(dir, 't-002', 'status: open\ntype: chore', 'すぐ始められるタスク');
  writeTask(dir, 't-003', 'status: open\ntype: chore\nblocked-by: t-001', '待ちのタスク');
  const output = sessionStart({ cwd: dir, source: 'startup' });
  assert.equal(output?.hookEventName, 'SessionStart');
  const context = String(output?.additionalContext);
  assert.match(context, /作業中のタスク:\n- t-001 \[chore\] 途中のタスク {2}担当: w1/);
  assert.match(context, /着手できるタスク:\n- t-002 \[chore\] すぐ始められるタスク/);
  assert.doesNotMatch(context, /t-003/, 'ブロックされたタスクは出さない');
  assert.match(context, /bugyo task start <id> --as <名前>/);
});

test('SessionStart: タスクがなければ、そう伝える', () => {
  const context = String(sessionStart({ cwd: project() })?.additionalContext);
  assert.match(context, /作業中のタスクも、着手できるタスクもありません。/);
});
