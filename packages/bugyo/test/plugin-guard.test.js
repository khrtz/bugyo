import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/** このファイルは日本語の出力を確かめる（英語の既定は locale.test.js で確かめる）。子プロセスにも引き継がれる */
process.env['BUGYO_LOCALE'] = 'ja';

const guard = join(import.meta.dirname, '..', '..', '..', 'plugin', 'hooks', 'guard.mjs');

/**
 * @param {string} toolName
 * @param {object} toolInput
 * @param {string} [cwd]
 * @returns {string | undefined} 断った理由
 */
function run(toolName, toolInput, cwd = tmpdir()) {
  const result = spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  if (result.stdout.trim() === '') return undefined;
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.permissionDecision, 'deny');
  return output.permissionDecisionReason;
}

const taskText = (status) => `---\nstatus: ${status}\ntype: logic\nfeature: slug\nassignee: agent-1\n---\n\n# slug を直す\n`;

test('設定・証拠・ベースラインのファイルの書き換えを断る（Windows のパスでも）', () => {
  assert.match(run('Edit', { file_path: '/repo/.bugyo/config.json', old_string: 'a', new_string: 'b' }) ?? '', /変えるのは人だけ/);
  assert.match(run('Write', { file_path: 'C:\\repo\\.bugyo\\config.json', content: '{}' }) ?? '', /変えるのは人だけ/);
  assert.match(run('Write', { file_path: '/repo/.bugyo/evidence/t-001.json', content: '{}' }) ?? '', /bugyo task done だけ/);
  for (const file of ['/repo/.bugyo/baseline.json', '/repo/eslint-suppressions.json', '/repo/.dependency-cruiser-known-violations.json']) {
    assert.match(run('Edit', { file_path: file, old_string: '1', new_string: '2' }) ?? '', /ベースライン/, file);
  }
});

test('タスク台帳は、状態の項目の書き換えだけを断り、本文や feature の直しは通す', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bugyo-guard-'));
  mkdirSync(join(cwd, '.bugyo/tasks'), { recursive: true });
  writeFileSync(join(cwd, '.bugyo/tasks/t-001.md'), taskText('active'));
  const file = join(cwd, '.bugyo/tasks/t-001.md');
  assert.match(run('Edit', { file_path: file, old_string: 'status: active', new_string: 'status: done' }, cwd) ?? '', /bugyo task のコマンドだけ/);
  assert.match(run('MultiEdit', { file_path: file, edits: [{ old_string: 'x', new_string: 'evidence-file: fake.json' }] }, cwd) ?? '', /bugyo task/);
  assert.match(run('Write', { file_path: file, content: taskText('done') }, cwd) ?? '', /bugyo task/);
  for (const line of ['model: other-model', 'harness: other-harness']) {
    assert.match(run('Edit', { file_path: file, old_string: 'assignee: agent-1', new_string: `assignee: agent-1\n${line}` }, cwd) ?? '', /bugyo task/, line);
  }
  assert.equal(run('Edit', { file_path: file, old_string: '# slug を直す', new_string: '# slug の区切りを直す' }, cwd), undefined);
  assert.equal(run('Write', { file_path: file, content: taskText('active').replace('feature: slug', 'feature: slug-v2') }, cwd), undefined);
  assert.match(run('Write', { file_path: join(cwd, '.bugyo/tasks/t-002.md'), content: taskText('open') }, cwd) ?? '', /bugyo task add/);
});

test('コマンドは、守るファイルを書き換える形だけを断る', () => {
  for (const command of ['echo {} > .bugyo/config.json', "sed -i 's/a/b/' .bugyo/tasks/t-001.md", 'rm .bugyo/evidence/t-001.json', 'cp x eslint-suppressions.json']) {
    assert.notEqual(run('Bash', { command }), undefined, command);
  }
  assert.notEqual(run('PowerShell', { command: "Set-Content .bugyo\\config.json '{}'" }), undefined);
  for (const command of ['cat .bugyo/config.json', 'git add .bugyo/tasks/t-001.md', 'pnpm exec bugyo task done t-001', 'pnpm check 2>&1 | tail', 'echo hi > notes.txt']) {
    assert.equal(run('Bash', { command }), undefined, command);
  }
});

test('ほかのファイルと、読めない入力は通す', () => {
  assert.equal(run('Edit', { file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' }), undefined);
  const result = spawnSync(process.execPath, [guard], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
