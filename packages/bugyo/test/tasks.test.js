import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const bin = join(import.meta.dirname, '..', 'bin', 'bugyo.js');
const fixture = join(import.meta.dirname, 'fixtures', 'plain');
const verifyCommand = `node "${bin}" verify {feature}`;

/**
 * @param {string} cwd
 * @param {(config: any) => void} change
 */
function editConfig(cwd, change) {
  const path = join(cwd, '.bugyo/config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  change(config);
  writeFileSync(path, JSON.stringify(config, null, 2));
}

/** React も Vite も Playwright もないフィクスチャを一時フォルダに写す。verify のコマンドはこの CLI を指す */
function project({ verify = true } = {}) {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bugyo-task-')), 'app');
  cpSync(fixture, cwd, { recursive: true });
  if (verify) editConfig(cwd, (config) => (config.commands.verify = verifyCommand));
  return cwd;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function bugyo(cwd, ...args) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, all: `${result.stdout}${result.stderr}` };
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function ok(cwd, ...args) {
  const run = bugyo(cwd, ...args);
  assert.equal(run.status, 0, `bugyo ${args.join(' ')}\n${run.all}`);
  return run;
}

/**
 * @param {string} cwd
 * @param {string} id
 */
function taskFile(cwd, id) {
  const open = join(cwd, `.bugyo/tasks/${id}.md`);
  return existsSync(open) ? open : join(cwd, `.bugyo/tasks/archive/${id}.md`);
}

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} key
 */
function field(cwd, id, key) {
  return new RegExp(`^${key}: ?(.*)$`, 'm').exec(readFileSync(taskFile(cwd, id), 'utf8'))?.[1];
}

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} key
 * @param {string} value
 */
function setField(cwd, id, key, value) {
  const file = taskFile(cwd, id);
  writeFileSync(file, readFileSync(file, 'utf8').replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`));
}

/** @param {string} cwd */
function breakGreet(cwd) {
  writeFileSync(join(cwd, 'lib/greet/model/greet.js'), 'export function greet(name) {\n  return `hi ${name}`;\n}\n');
}

/** @param {string} cwd */
function fixGreet(cwd) {
  cpSync(join(fixture, 'lib/greet/model/greet.js'), join(cwd, 'lib/greet/model/greet.js'));
}

test('add は feature map にない機能を断る', () => {
  const run = bugyo(project(), 'task', 'add', '何か', '--type', 'ui-flow', '--feature', 'nope');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /nope は feature map（docs\/features）にありません。候補: greet/);
});

test('add は存在しない blocked-by を断る', () => {
  const run = bugyo(project(), 'task', 'add', '何か', '--type', 'chore', '--blocked-by', 't-009');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /blocked-by の t-009 というタスクはありません/);
});

test('add は機能の要る種類で --feature がないと断る', () => {
  const run = bugyo(project(), 'task', 'add', '何か', '--type', 'feature');
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--feature/);
});

test('add は1タスク1ファイルを作り、1行で返す。--json は短い JSON', () => {
  const cwd = project();
  assert.equal(ok(cwd, 'task', 'add', 'あいさつを直す', '--type', 'logic', '--feature', 'greet').stdout, 't-001 [open/logic] あいさつを直す  (機能: greet)\n');
  const created = JSON.parse(ok(cwd, 'task', 'add', '文書', '--type', 'chore', '--json').stdout);
  assert.deepEqual(created, { id: 't-002', status: 'open', type: 'chore', title: '文書', feature: '', assignee: '', blockedBy: [], rework: 0, gateAttempts: 0 });
  assert.match(readFileSync(join(cwd, '.bugyo/tasks/t-001.md'), 'utf8'), /^---\nstatus: open\ntype: logic\nfeature: greet\nblocked-by:\nassignee:\nrework: 0\ngate-attempts: 0\n/);
});

test('start は二重着手を断り、1人が2件同時に持つことも断る', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'a', '--type', 'chore');
  ok(cwd, 'task', 'add', 'b', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  const twice = bugyo(cwd, 'task', 'start', 't-001', '--as', 'w2');
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /すでに w1 が作業中/);
  const busy = bugyo(cwd, 'task', 'start', 't-002', '--as', 'w1');
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /w1 はすでに t-001 を作業中/);
});

test('ready はブロックされたタスクを出さず、先のタスクが閉じると出す', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', '先', '--type', 'chore');
  ok(cwd, 'task', 'add', '後', '--type', 'chore', '--blocked-by', 't-001');
  assert.deepEqual(JSON.parse(ok(cwd, 'task', 'ready', '--json').stdout).map((task) => task.id), ['t-001']);
  const blocked = bugyo(cwd, 'task', 'start', 't-002', '--as', 'w1');
  assert.match(blocked.stderr, /t-001 が終わるまで着手できません/);
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  assert.deepEqual(JSON.parse(ok(cwd, 'task', 'ready', '--json').stdout).map((task) => task.id), ['t-002']);
});

test('show は読むものと完了に必要なものを出す', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', '残りがずれる', '--type', 'bugfix', '--feature', 'greet', '--body', '絞り込むとずれる');
  assert.equal(
    ok(cwd, 'task', 'show', 't-001').stdout,
    [
      't-001 [open/bugfix] 残りがずれる  (機能: greet)',
      '読む: docs/features/greet.md',
      '完了に必要: repro の記録 → 同じテストが通る → node scripts/check.js → node --test "lib/**/*.test.js"',
      '',
      '絞り込むとずれる',
      '',
    ].join('\n'),
  );
});

test('done: verify が落ちる状態だと断られて作業中のまま、直すと閉じて証拠が残る', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'あいさつ', '--type', 'ui-flow', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  breakGreet(cwd);
  writeFileSync(join(cwd, 'lib/greet/model/greet.test.js'), "import { test } from 'node:test';\ntest('空', () => {});\n");

  const refused = bugyo(cwd, 'task', 'done', 't-001');
  assert.equal(refused.status, 1, refused.all);
  assert.match(refused.stdout, /^FAIL t-001 \[active\/ui-flow\] あいさつ .*verify greet: .*終了コード 1.*gate-attempts: 1/m);
  assert.match(refused.stdout, /"hi bugyo"/);
  assert.equal(field(cwd, 't-001', 'status'), 'active');
  assert.ok(!existsSync(join(cwd, '.bugyo/evidence/t-001.json')));

  fixGreet(cwd);
  const closed = ok(cwd, 'task', 'done', 't-001');
  assert.match(closed.stdout, /^DONE t-001 \[done\/ui-flow\] あいさつ .*証拠: \.bugyo\/evidence\/t-001\.json$/m);
  assert.ok(existsSync(join(cwd, '.bugyo/tasks/archive/t-001.md')));
  assert.equal(field(cwd, 't-001', 'gate-attempts'), '2');

  const evidence = JSON.parse(readFileSync(join(cwd, '.bugyo/evidence/t-001.json'), 'utf8'));
  assert.deepEqual(
    evidence.steps.map((step) => [step.name, step.command, step.status]),
    [
      ['check', 'node scripts/check.js', 0],
      ['test', 'node --test "lib/**/*.test.js"', 0],
      ['verify', `node "${bin}" verify greet`, 0],
    ],
  );
  assert.deepEqual(evidence.steps[2].results.features, [{ id: 'greet', ok: true, command: 'node checks/greet.js' }]);
  assert.deepEqual(evidence.tree.paths, ['lib', 'checks']);
  assert.equal(evidence.tree.hash, field(cwd, 't-001', 'evidence-tree'));
  ok(cwd, 'task', 'lint');
});

test('audit は完了タスクを再検証し、既存の証拠を書き換えない', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'あいさつ', '--type', 'ui-flow', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'agent');
  ok(cwd, 'task', 'done', 't-001');
  const path = join(cwd, '.bugyo/evidence/t-001.json');
  const before = readFileSync(path, 'utf8');
  assert.match(ok(cwd, 'task', 'audit', 't-001').stdout, /^PASS t-001\n$/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('audit は見かけだけ整合する偽の証拠と、完了後のコード変更を断る', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'あいさつ', '--type', 'ui-flow', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'agent');
  ok(cwd, 'task', 'done', 't-001');
  const path = join(cwd, '.bugyo/evidence/t-001.json');
  const evidence = JSON.parse(readFileSync(path, 'utf8'));
  evidence.steps[0].command = 'true';
  writeFileSync(path, JSON.stringify(evidence));
  assert.equal(bugyo(cwd, 'task', 'lint').status, 0);
  assert.match(bugyo(cwd, 'task', 'audit', 't-001').stdout, /FAIL t-001: 1番目のコマンド/);
  evidence.steps[0].command = 'node scripts/check.js';
  writeFileSync(path, JSON.stringify(evidence));
  breakGreet(cwd);
  assert.match(bugyo(cwd, 'task', 'audit', 't-001').stdout, /FAIL t-001: 証拠のハッシュ/);
});

test('audit --base は変更された完了タスクだけを検証する', () => {
  const cwd = project();
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  assert.equal(git('add', '.').status, 0);
  assert.equal(git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base').status, 0);
  const base = git('rev-parse', 'HEAD').stdout.trim();
  ok(cwd, 'task', 'add', '文書', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'agent');
  ok(cwd, 'task', 'done', 't-001');
  assert.equal(git('add', '.').status, 0);
  assert.equal(git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'task').status, 0);
  assert.match(ok(cwd, 'task', 'audit', '--base', base).stdout, /^PASS t-001\n$/);
});

test('手で status を done に書き換えると task lint が落ちる', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', '文書', '--type', 'chore');
  ok(cwd, 'task', 'lint');
  setField(cwd, 't-001', 'status', 'done');
  const run = bugyo(cwd, 'task', 'lint');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /証拠ファイルがありません。done にできるのは bugyo task done だけです/);
});

test('done は必要なコマンドが設定にないと断り、試行にも数えない', () => {
  const cwd = project({ verify: false });
  ok(cwd, 'task', 'add', 'あいさつ', '--type', 'ui-flow', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  const run = bugyo(cwd, 'task', 'done', 't-001');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /commands\.verify が \.bugyo\/config\.json にありません/);
  assert.equal(field(cwd, 't-001', 'gate-attempts'), '0');
  assert.match(ok(cwd, 'task', 'show', 't-001').stdout, /注意: commands\.verify が \.bugyo\/config\.json にないので done できません/);
});

test('done は空のコマンドも未設定として断る', () => {
  const cwd = project();
  editConfig(cwd, (config) => (config.commands.check = ' '));
  ok(cwd, 'task', 'add', '文書', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  const run = bugyo(cwd, 'task', 'done', 't-001');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /commands\.check/);
});

test('done は open のタスクを断る', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', '文書', '--type', 'chore');
  const run = bugyo(cwd, 'task', 'done', 't-001');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /先に bugyo task start t-001/);
});

test('feature: feature map の見出しが雛形のままだと done を断る', () => {
  const cwd = project();
  const map = join(cwd, 'docs/features/greet.md');
  writeFileSync(map, readFileSync(map, 'utf8').replace('- 区切りのカンマと空白', '- （見た目は通るのに壊れている、が起きやすい点）'));
  ok(cwd, 'task', 'add', 'あいさつ', '--type', 'feature', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  const run = bugyo(cwd, 'task', 'done', 't-001');
  assert.equal(run.status, 1);
  assert.match(run.stdout, /見出しが空か雛形のままです: よく嘘をつくところ/);
});

test('logic: model/ にテストがないと done を断る', () => {
  const cwd = project();
  rmSync(join(cwd, 'lib/greet/model/greet.test.js'));
  ok(cwd, 'task', 'add', '計算', '--type', 'logic', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  const run = bugyo(cwd, 'task', 'done', 't-001');
  assert.equal(run.status, 1);
  assert.match(run.stdout, /lib\/greet\/model にテスト（\*\.test\.\*）がありません/);
});

test('bugfix: 今通るコマンドは repro に使えず、失敗を記録すると done で同じコマンドが通ることを確かめる', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'あいさつが違う', '--type', 'bugfix', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  const early = bugyo(cwd, 'task', 'done', 't-001');
  assert.match(early.stdout, /repro の記録: 直す前に bugyo task repro t-001/);

  const passing = bugyo(cwd, 'task', 'repro', 't-001', '--', 'node', 'checks/greet.js');
  assert.equal(passing.status, 1);
  assert.match(passing.stderr, /今通っています/);

  breakGreet(cwd);
  assert.match(ok(cwd, 'task', 'repro', 't-001', '--', 'node', 'checks/greet.js').stdout, /再現を記録しました: node checks\/greet\.js/);
  const stillBroken = bugyo(cwd, 'task', 'done', 't-001');
  assert.equal(stillBroken.status, 1);
  assert.match(stillBroken.stdout, /同じテストが通る: node checks\/greet\.js が終了コード 1/);

  fixGreet(cwd);
  ok(cwd, 'task', 'done', 't-001');
  const evidence = JSON.parse(readFileSync(join(cwd, '.bugyo/evidence/t-001.json'), 'utf8'));
  assert.equal(evidence.repro.command, 'node checks/greet.js');
  assert.deepEqual(evidence.steps.map((step) => step.name), ['repro', 'check', 'test']);
});

test('refactor: start のあとにテストファイルを変えると done を断る', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', '整理', '--type', 'refactor');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  writeFileSync(join(cwd, 'lib/greet/model/greet.test.js'), "import { test } from 'node:test';\ntest('空', () => {});\n");
  const run = bugyo(cwd, 'task', 'done', 't-001');
  assert.equal(run.status, 1);
  assert.match(run.stdout, /テストファイルが start のときから変わっています/);
});

test('task lint: 存在しない blocked-by、担当のいない active、1人2件の作業中を見つける', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'a', '--type', 'chore');
  ok(cwd, 'task', 'add', 'b', '--type', 'chore');
  ok(cwd, 'task', 'add', 'c', '--type', 'chore');
  setField(cwd, 't-001', 'blocked-by', 't-042');
  setField(cwd, 't-002', 'status', 'active');
  setField(cwd, 't-003', 'status', 'active');
  setField(cwd, 't-003', 'assignee', 'w1');
  ok(cwd, 'task', 'add', 'd', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-004', '--as', 'w9');
  setField(cwd, 't-004', 'assignee', 'w1');
  const run = bugyo(cwd, 'task', 'lint');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /t-001\.md: blocked-by の t-042 というタスクはありません/);
  assert.match(run.stderr, /t-002\.md: active なのに assignee がいません/);
  assert.match(run.stderr, /w1 が t-003, t-004 を同時に作業中です/);
});

test('task lint は台帳がなくても通る', () => {
  const run = ok(project(), 'task', 'lint');
  assert.match(run.stdout, /タスク 0件、エラー 0件/);
});

test('rework は --kind がないと記録済みの種類を出して断る', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'a', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  ok(cwd, 'task', 'rework', 't-001', '-r', '名前が違う', '--kind', 'wrong-name');
  ok(cwd, 'task', 'done', 't-001');
  const run = bugyo(cwd, 'task', 'rework', 't-001', '-r', 'また');
  assert.equal(run.status, 2);
  assert.match(run.stderr, /記録済みの種類: wrong-name/);
});

test('mistake rule は実在しないファイルを断る', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'a', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  ok(cwd, 'task', 'rework', 't-001', '-r', '名前が違う', '--kind', 'wrong-name');
  const run = bugyo(cwd, 'mistake', 'rule', 'wrong-name', '--at', 'lint/no-such-rule.js');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /lint\/no-such-rule\.js がありません/);
});

test('gate: 完了が足りない間は件数不足で不合格', () => {
  const run = bugyo(project(), 'gate');
  assert.equal(run.status, 1);
  assert.match(run.stdout, /NG 完了タスク: 0件（20件以上）/);
});

test('gate: 同じ種類の手直しを2回記録すると不合格になり、ルール化を記録すると戻る', () => {
  const cwd = project();
  editConfig(cwd, (config) => (config.gate = { window: 3, maxRework: 2, minFirstPass: 1 }));
  for (const title of ['a', 'b', 'c']) ok(cwd, 'task', 'add', title, '--type', 'chore');
  for (const [id, who] of [['t-001', 'w1'], ['t-002', 'w2'], ['t-003', 'w3']]) {
    ok(cwd, 'task', 'start', id, '--as', who);
    ok(cwd, 'task', 'done', id);
  }
  assert.match(ok(cwd, 'gate').stdout, /^gate: 合格/);

  for (const id of ['t-001', 't-002']) {
    ok(cwd, 'task', 'rework', id, '-r', 'index.ts を通さず import した', '--kind', 'deep-import');
    ok(cwd, 'task', 'done', id);
  }
  const failed = bugyo(cwd, 'gate');
  assert.equal(failed.status, 1, failed.all);
  assert.match(failed.stdout, /NG ルール化されていない再発: 1種類（0種類） deep-import/);
  assert.match(ok(cwd, 'mistake', 'ls').stdout, /^deep-import 2回 {2}ルール: なし {2}← ルール化が必要$/m);
  assert.match(bugyo(cwd, 'task', 'lint').stdout, /warn {2}ミス: deep-import 2回/);

  ok(cwd, 'mistake', 'rule', 'deep-import', '--at', 'scripts/check.js');
  assert.match(ok(cwd, 'gate').stdout, /^gate: 合格/);

  ok(cwd, 'task', 'rework', 't-003', '-r', 'また深い import', '--kind', 'deep-import');
  assert.match(ok(cwd, 'mistake', 'ls').stdout, /^deep-import 3回 {2}ルール: scripts\/check\.js {2}← ルールが漏れている/m);
});

test('rework は戻す担当が別のタスクを作業中なら断り、--as で別の担当に渡せる', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'a', '--type', 'chore');
  ok(cwd, 'task', 'add', 'b', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  ok(cwd, 'task', 'start', 't-002', '--as', 'w1');
  const busy = bugyo(cwd, 'task', 'rework', 't-001', '-r', '名前が違う', '--kind', 'wrong-name');
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /w1 はいま t-002 を作業中です/);
  assert.equal(field(cwd, 't-001', 'status'), 'done');
  ok(cwd, 'task', 'rework', 't-001', '-r', '名前が違う', '--kind', 'wrong-name', '--as', 'w2');
  assert.equal(field(cwd, 't-001', 'assignee'), 'w2');
  ok(cwd, 'task', 'lint');
});

test('drop は理由がないと断り、完了したタスクも断り、やめたタスクを archive に移す', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'a', '--type', 'chore');
  ok(cwd, 'task', 'add', 'b', '--type', 'chore');
  assert.equal(bugyo(cwd, 'task', 'drop', 't-001').status, 2);
  ok(cwd, 'task', 'drop', 't-001', '-r', '要らなくなった');
  assert.ok(existsSync(join(cwd, '.bugyo/tasks/archive/t-001.md')));
  assert.ok(!existsSync(join(cwd, '.bugyo/tasks/t-001.md')));
  assert.equal(field(cwd, 't-001', 'drop-reason'), '要らなくなった');
  ok(cwd, 'task', 'start', 't-002', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-002');
  const refused = bugyo(cwd, 'task', 'drop', 't-002', '-r', 'やめる');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /完了しています。直すなら bugyo task rework/);
  assert.deepEqual(JSON.parse(ok(cwd, 'task', 'ls', '--json').stdout), []);
  assert.deepEqual(JSON.parse(ok(cwd, 'task', 'ls', '--all', '--json').stdout).map((task) => task.status), ['dropped', 'done']);
});

test('task lint: feature map にない機能、証拠と食い違う evidence-tree、同じ id の重複を見つける', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'a', '--type', 'ui-flow', '--feature', 'greet');
  ok(cwd, 'task', 'add', 'b', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-002', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-002');
  setField(cwd, 't-001', 'feature', 'gone');
  setField(cwd, 't-002', 'evidence-tree', 'sha256:0000');
  cpSync(join(cwd, '.bugyo/tasks/t-001.md'), join(cwd, '.bugyo/tasks/archive/t-001.md'));
  const run = bugyo(cwd, 'task', 'lint');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /t-001\.md: feature の gone が docs\/features にありません/);
  assert.match(run.stderr, /t-002\.md: evidence-tree が \.bugyo\/evidence\/t-002\.json と合いません/);
  assert.match(run.stderr, /同じ id のタスクが \.bugyo\/tasks\/t-001\.md にもあります/);
});
