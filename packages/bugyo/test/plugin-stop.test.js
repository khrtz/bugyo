import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hook = join(import.meta.dirname, '..', '..', '..', 'plugin', 'hooks', 'stop-check.mjs');
const bugyoPackage = join(import.meta.dirname, '..');

/**
 * @param {object} event
 * @returns {string | undefined} 終わらせない理由
 */
function run(event) {
  const result = spawnSync(process.execPath, [hook], { input: JSON.stringify(event), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  if (result.stdout.trim() === '') return undefined;
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, 'block');
  return output.reason;
}

/** 台帳と、node_modules から使える bugyo を持つプロジェクトを作る */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'bugyo-stop-'));
  mkdirSync(join(dir, '.bugyo', 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(bugyoPackage, join(dir, 'node_modules', 'bugyo'), 'junction');
  return dir;
}

/** @param {string} dir */
function writeHandEditedDone(dir) {
  writeFileSync(join(dir, '.bugyo', 'tasks', 't-001.md'), '---\nstatus: done\ntype: chore\n---\n\n# 手で閉じたタスク\n');
}

test('台帳が正しければ止めない', () => {
  const dir = project();
  writeFileSync(join(dir, '.bugyo', 'tasks', 't-001.md'), '---\nstatus: open\ntype: chore\n---\n\n# まだのタスク\n');
  assert.equal(run({ cwd: dir, stop_hook_active: false }), undefined);
});

test('手で done にしたタスクがあれば、task lint の出力をつけて止める', () => {
  const dir = project();
  writeHandEditedDone(dir);
  const reason = run({ cwd: dir, stop_hook_active: false });
  assert.match(reason ?? '', /bugyo task lint が落ちました/);
  assert.match(reason ?? '', /t-001\.md: done のタスクは \.bugyo\/tasks\/archive に置きます/);
  assert.match(reason ?? '', /bugyo task start \/ done \/ rework \/ drop/);
});

test('下のフォルダから呼ばれても、台帳のあるフォルダで確かめる', () => {
  const dir = project();
  writeHandEditedDone(dir);
  mkdirSync(join(dir, 'src', 'features'), { recursive: true });
  assert.match(run({ cwd: join(dir, 'src', 'features'), stop_hook_active: false }) ?? '', /t-001\.md/);
});

test('2回目の Stop では止めない（止め続けない）', () => {
  const dir = project();
  writeHandEditedDone(dir);
  assert.equal(run({ cwd: dir, stop_hook_active: true }), undefined);
});

test('台帳か bugyo がなければ何もしない', () => {
  assert.equal(run({ cwd: mkdtempSync(join(tmpdir(), 'bugyo-stop-')), stop_hook_active: false }), undefined);
  const dir = mkdtempSync(join(tmpdir(), 'bugyo-stop-'));
  mkdirSync(join(dir, '.bugyo', 'tasks'), { recursive: true });
  writeHandEditedDone(dir);
  assert.equal(run({ cwd: dir, stop_hook_active: false }), undefined);
});

test('読めない入力では何もしない', () => {
  const result = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
