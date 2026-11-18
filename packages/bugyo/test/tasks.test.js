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
  assert.match(closed.stdout, /^DONE t-001 \[done\/ui-flow\] あいさつ .*evidence: \.bugyo\/evidence\/t-001\.json$/m);
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
  assert.match(run.stdout, /\[ui\] 不合格（feature, ui-flow, ui-look の直近 20件）/);
  assert.match(run.stdout, /NG 閉じたタスク（完了と中止）: 0件（20件以上）/);
});

test('gate: 同じ種類の手直しを2回記録すると不合格になり、ルール化を記録すると戻る', () => {
  const cwd = project();
  editConfig(cwd, (config) => (config.gate = { window: 3, maxRework: 2, minFirstPass: 1, scopes: { chore: { types: ['chore'] } } }));
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
  assert.match(ok(cwd, 'mistake', 'ls').stdout, /^deep-import 3回 {2}ルール: scripts\/check\.js {2}ルール化のとき 2回 {2}← ルールが漏れている/m);
});

test('mistake ls は、ルール化済みの種類の数と、ルールの名前を出す', () => {
  const cwd = project();
  for (const title of ['a', 'b']) ok(cwd, 'task', 'add', title, '--type', 'chore');
  for (const [id, who] of [['t-001', 'w1'], ['t-002', 'w2']]) {
    ok(cwd, 'task', 'start', id, '--as', who);
    ok(cwd, 'task', 'done', id);
  }
  for (const [id, kind] of [['t-001', 'deep-import'], ['t-002', 'deep-import'], ['t-001', 'date-now'], ['t-002', 'wrong-name']]) {
    ok(cwd, 'task', 'rework', id, '-r', `${kind} のミス`, '--kind', kind);
    ok(cwd, 'task', 'done', id);
  }
  const bad = bugyo(cwd, 'mistake', 'rule', 'date-now', '--at', 'scripts/check.js', '--name', 'no date now');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /ルールの名前 no date now は/);
  ok(cwd, 'mistake', 'rule', 'date-now', '--at', 'scripts/check.js', '--name', 'clock');
  ok(cwd, 'task', 'rework', 't-001', '-r', 'また Date.now', '--kind', 'date-now');

  const lines = ok(cwd, 'mistake', 'ls').stdout.trim().split('\n');
  assert.deepEqual(lines, [
    'date-now 2回  ルール: clock（scripts/check.js）  ルール化のとき 1回  ← ルールが漏れている（ルール化のあとにまた起きた）',
    'deep-import 2回  ルール: なし  ← ルール化が必要',
    'wrong-name 1回  ルール: なし',
    'ミス 3種類  ルール化済み 1種類（うちルールが漏れている 1種類）  ルール化が必要 1種類  1回だけ 1種類',
  ]);
  const json = JSON.parse(ok(cwd, 'mistake', 'ls', '--json').stdout);
  assert.deepEqual(json.summary, { kinds: 3, ruled: 1, leak: 1, unruled: 1, once: 1 });
  assert.deepEqual(json.mistakes[0], { kind: 'date-now', count: 2, rule: 'scripts/check.js', ruleName: 'clock', ruledCount: 1, state: 'leak' });
  assert.deepEqual(json.mistakes[1], { kind: 'deep-import', count: 2, rule: '', state: 'unruled' });
  assert.match(readFileSync(join(cwd, '.bugyo', 'mistakes', 'date-now.md'), 'utf8'), /^rule: scripts\/check\.js\nrule-name: clock\nruled-count: 1$/m);
});

test('gate: 件数が判定に足りないときと、1回で通った割合の区間が広いときに警告を出す', () => {
  const cwd = project();
  editConfig(cwd, (config) => (config.gate = { window: 4, maxRework: 4, minFirstPass: 0, scopes: { chore: { types: ['chore'] } } }));
  for (const title of ['a', 'b']) ok(cwd, 'task', 'add', title, '--type', 'chore');
  for (const [id, who] of [['t-001', 'w1'], ['t-002', 'w2']]) {
    ok(cwd, 'task', 'start', id, '--as', who);
    ok(cwd, 'task', 'done', id);
  }
  const run = bugyo(cwd, 'gate', '--json');
  const result = JSON.parse(run.stdout);
  assert.deepEqual(result.warnings, [
    '[chore] 閉じたタスクが 2件で、判定の 4件に足りません。合否はまだ当てになりません',
    '[chore] 1回で通った割合 2/2 の 95% 区間は 34.2%〜100.0% です。幅が広いので、件数を増やしてから判断してください',
  ]);
  assert.match(bugyo(cwd, 'gate').stdout, /^warn {2}\[chore\] 閉じたタスクが 2件/m);
});

test('stats: start と done でモデルとハーネスを記録し、作業の種類・モデル・ハーネスごとに実績を出す', () => {
  const cwd = project();
  const as = (/** @type {Record<string, string>} */ env, /** @type {string[]} */ ...args) => {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    return result;
  };
  for (const title of ['a', 'b', 'c', 'd']) ok(cwd, 'task', 'add', title, '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1', '--model', 'model-a', '--harness', 'cli');
  ok(cwd, 'task', 'done', 't-001');
  as({ BUGYO_MODEL: 'model-a', BUGYO_HARNESS: 'cli' }, 'task', 'start', 't-002', '--as', 'w2');
  editConfig(cwd, (config) => (config.commands.check = 'node -e "process.exit(1)"'));
  assert.equal(bugyo(cwd, 'task', 'done', 't-002').status, 1);
  editConfig(cwd, (config) => (config.commands.check = 'node scripts/check.js'));
  ok(cwd, 'task', 'done', 't-002');
  ok(cwd, 'task', 'start', 't-003', '--as', 'w3');
  ok(cwd, 'task', 'done', 't-003', '--model', 'model-b');
  ok(cwd, 'task', 'drop', 't-004', '-r', 'いらなくなった');

  assert.equal(field(cwd, 't-001', 'model'), 'model-a');
  assert.equal(field(cwd, 't-002', 'harness'), 'cli');
  assert.equal(field(cwd, 't-003', 'model'), 'model-b', 'start で記録がなくても done で記録できる');
  const { rows } = JSON.parse(ok(cwd, 'stats', '--json').stdout);
  assert.deepEqual(
    rows.map((/** @type {any} */ row) => [row.type, row.model, row.harness, row.closed, row.done, row.firstPass, row.reworked, row.dropped]),
    [
      ['chore', '-', '-', 1, 0, 0, 0, 1],
      ['chore', 'model-a', 'cli', 2, 2, 1, 0, 0],
      ['chore', 'model-b', '-', 1, 1, 1, 0, 0],
    ],
  );
  assert.match(ok(cwd, 'stats').stdout, /chore {2}モデル: model-a {2}ハーネス: cli {2}閉じた 2件 {2}1回で通った 50\.0%（95% 区間 9\.5%〜90\.5%） {2}手直し 0\.0% {2}中止 0\.0%/);
  ok(cwd, 'task', 'add', 'e', '--type', 'chore');
  assert.match(bugyo(cwd, 'task', 'start', 't-005', '--as', 'x', '--model', 'a b').all, /英数字で始め/);
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

test('recheck: 本物の証拠は通り、閉じたあとにコードが変わるとハッシュの不一致で落ちる', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'あいさつ', '--type', 'ui-flow', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  assert.match(ok(cwd, 'task', 'recheck', 't-001').stdout, /^OK {3}t-001 {2}手順が通り、ハッシュが一致しました$/m);

  writeFileSync(join(cwd, 'lib/greet/extra.js'), 'export const extra = 1;\n');
  const changed = bugyo(cwd, 'task', 'recheck', 't-001');
  assert.equal(changed.status, 1, changed.all);
  assert.match(changed.stdout, /^FAIL t-001 {2}今のコードのハッシュ.*evidence-tree.*と違います/m);
});

test('issue: add --issue で課題の参照を残し、シェルで意味を持つ文字は断る', () => {
  const cwd = project();
  const added = JSON.parse(ok(cwd, 'task', 'add', 'あいさつ', '--type', 'ui-flow', '--feature', 'greet', '--issue', 'PROJ-45', '--json').stdout);
  assert.equal(added.issue, 'PROJ-45');
  assert.match(readFileSync(taskFile(cwd, 't-001'), 'utf8'), /^issue: PROJ-45$/m);
  assert.match(ok(cwd, 'task', 'ls').stdout, /課題: PROJ-45/);
  for (const issue of ['1; rm -rf ~', '#12', '-x', '$(id)']) {
    assert.equal(bugyo(cwd, 'task', 'add', 'x', '--type', 'chore', '--issue', issue).status, 2, issue);
  }
  ok(cwd, 'task', 'add', 'x', '--type', 'chore', '--issue', 'https://example.com/a/issues/12#top');
});

test('recheck --notify: 通った課題つきのタスクだけを知らせ、done では知らせず、知らせられなくても合否は変えない', () => {
  const cwd = project();
  const log = join(cwd, 'notified.log');
  editConfig(cwd, (config) => (config.notify = { verified: `node -e "require('fs').appendFileSync(process.argv[1], process.argv.slice(2).join(' ') + ' ' + process.env.BUGYO_TITLE + '\\n')" "${log}" {issue} {task} {evidence}` }));
  ok(cwd, 'task', 'add', 'あいさつ', '--type', 'ui-flow', '--feature', 'greet', '--issue', '123');
  ok(cwd, 'task', 'add', '課題なし', '--type', 'chore');
  for (const id of ['t-001', 't-002']) {
    ok(cwd, 'task', 'start', id, '--as', `w-${id}`);
    ok(cwd, 'task', 'done', id);
  }
  assert.ok(!existsSync(log), 'done では知らせない');

  ok(cwd, 'task', 'recheck', 't-001', 't-002');
  assert.ok(!existsSync(log), '--notify がなければ知らせない');

  const run = ok(cwd, 'task', 'recheck', 't-001', 't-002', '--notify');
  assert.match(run.stdout, /^notify t-001 を 123 に知らせました$/m);
  assert.equal(readFileSync(log, 'utf8'), '123 t-001 .bugyo/evidence/t-001.json あいさつ\n');

  writeFileSync(join(cwd, 'lib/greet/extra.js'), 'export const extra = 1;\n');
  assert.equal(bugyo(cwd, 'task', 'recheck', 't-001', '--notify').status, 1);
  assert.equal(readFileSync(log, 'utf8').split('\n').length, 2, '照合に落ちたタスクは知らせない');
  rmSync(join(cwd, 'lib/greet/extra.js'));

  editConfig(cwd, (config) => (config.notify = { verified: 'node -e "process.exit(3)"' }));
  const failing = ok(cwd, 'task', 'recheck', 't-001', '--notify');
  assert.match(failing.stdout, /^warn {3}t-001 を 123 に知らせられませんでした（終了コード 3）/m);
});

test('recheck: ハッシュまで合わせた偽の証拠は task lint を通るが、取り直すと verify で落ちる', async () => {
  const { treeHash } = await import('../src/evidence.js');
  const cwd = project();
  ok(cwd, 'task', 'add', 'あいさつ', '--type', 'ui-flow', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  breakGreet(cwd);
  const forged = treeHash(cwd, ['lib', 'checks']);
  setField(cwd, 't-001', 'evidence-tree', forged);
  const evidencePath = join(cwd, '.bugyo/evidence/t-001.json');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  evidence.tree.hash = forged;
  writeFileSync(evidencePath, JSON.stringify(evidence));

  ok(cwd, 'task', 'lint');
  const run = bugyo(cwd, 'task', 'recheck', 't-001');
  assert.equal(run.status, 1, run.all);
  assert.match(run.stdout, /^FAIL t-001 {2}取り直すと .*verify greet が通りません/m);
});

test('recheck: 証拠のコマンドが今の設定と違うと落ちる', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', '文書', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  editConfig(cwd, (config) => (config.commands.check = 'node -e "process.exit(0)"'));
  const run = bugyo(cwd, 'task', 'recheck', 't-001');
  assert.equal(run.status, 1, run.all);
  assert.match(run.stdout, /証拠に記録されたコマンド（node scripts\/check\.js）が、今の設定で必要なコマンド/);
});

test('recheck --base: その範囲で閉じたタスクだけを照合し、引数がなければ断る', () => {
  const cwd = project();
  const git = (...args) => {
    const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  };
  git('init', '-q');
  ok(cwd, 'task', 'add', '前からある', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('tag', 'base');
  ok(cwd, 'task', 'add', 'この PR で閉じる', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-002', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-002');
  git('add', '-A');
  git('commit', '-qm', 'pr');

  const run = ok(cwd, 'task', 'recheck', '--base', 'base', '--json');
  assert.deepEqual(JSON.parse(run.stdout).results.map((result) => result.id), ['t-002']);
  assert.equal(bugyo(cwd, 'task', 'recheck').status, 2);
});

test('gate: chore だけを通しても、画面やコードの作業を任せる判定は合格にならない', () => {
  const cwd = project();
  editConfig(cwd, (config) => (config.gate = { window: 2, maxRework: 0, minFirstPass: 2 }));
  for (const [id, who] of [['t-001', 'w1'], ['t-002', 'w2']]) {
    ok(cwd, 'task', 'add', id, '--type', 'chore');
    ok(cwd, 'task', 'start', id, '--as', who);
    ok(cwd, 'task', 'done', id);
  }
  assert.match(ok(cwd, 'gate', '--scope', 'chore').stdout, /^gate: 合格/);
  const ui = bugyo(cwd, 'gate', '--scope', 'ui');
  assert.equal(ui.status, 1, ui.all);
  assert.match(ui.stdout, /NG 閉じたタスク（完了と中止）: 0件（2件以上）/);
  const all = bugyo(cwd, 'gate', '--json');
  assert.equal(all.status, 1);
  assert.deepEqual(JSON.parse(all.stdout).scopes.map((scope) => [scope.name, scope.passed]), [['ui', false], ['code', false], ['chore', true]]);
  assert.equal(bugyo(cwd, 'gate', '--scope', 'nope').status, 1);
});

test('gate: 中止したタスクも閉じたタスクに数え、上限を超えると不合格', () => {
  const cwd = project();
  editConfig(cwd, (config) => (config.gate = { window: 3, maxRework: 0, minFirstPass: 2, maxDropped: 0, scopes: { chore: { types: ['chore'] } } }));
  for (const [id, who] of [['t-001', 'w1'], ['t-002', 'w2']]) {
    ok(cwd, 'task', 'add', id, '--type', 'chore');
    ok(cwd, 'task', 'start', id, '--as', who);
    ok(cwd, 'task', 'done', id);
  }
  ok(cwd, 'task', 'add', '難しかった', '--type', 'chore');
  ok(cwd, 'task', 'drop', 't-003', '-r', '通らなかった');
  assert.match(field(cwd, 't-003', 'dropped-at') ?? '', /^\d{4}-/);
  const run = bugyo(cwd, 'gate');
  assert.equal(run.status, 1, run.all);
  assert.match(run.stdout, /OK 閉じたタスク（完了と中止）: 3件（3件以上）/);
  assert.match(run.stdout, /NG 中止したタスク: 1件（0件以下）/);
});

test('gate: scopes に知らない作業の種類を書くと設定の誤りとして断る', () => {
  const cwd = project();
  editConfig(cwd, (config) => (config.gate = { scopes: { web: { types: ['page'] } } }));
  const run = bugyo(cwd, 'gate');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /config\.json が不正です/);
});

test('repro: コマンドが見つからないとき、テストを1件も実行していないとき、--expect の文言が出ないときは記録しない', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'あいさつが違う', '--type', 'bugfix', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  breakGreet(cwd);

  const missing = bugyo(cwd, 'task', 'repro', 't-001', '--', 'no-such-test-runner-xyz', 'checks/greet.js');
  assert.equal(missing.status, 1, missing.all);
  assert.match(missing.stderr, /最初のコマンドが見つかりません/);

  writeFileSync(join(cwd, 'no-tests.js'), "console.log('Error: No tests found');\nprocess.exit(1);\n");
  const empty = bugyo(cwd, 'task', 'repro', 't-001', '--', 'node', 'no-tests.js');
  assert.equal(empty.status, 1, empty.all);
  assert.match(empty.stderr, /テストを1件も実行していません/);

  const wrong = bugyo(cwd, 'task', 'repro', 't-001', '--expect', 'TypeError', '--', 'node', 'checks/greet.js');
  assert.equal(wrong.status, 1, wrong.all);
  assert.match(wrong.stderr, /出力に「TypeError」がありません/);
  assert.equal(field(cwd, 't-001', 'repro'), undefined);
});

test('repro: 終了コード・出力の末尾・テストファイルのハッシュを記録し、あとでテストを変えると done が警告する', () => {
  const cwd = project();
  ok(cwd, 'task', 'add', 'あいさつが違う', '--type', 'bugfix', '--feature', 'greet');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  breakGreet(cwd);
  const recorded = ok(cwd, 'task', 'repro', 't-001', '--expect', 'のはずが', '--', 'node', 'checks/greet.js');
  assert.match(recorded.stdout, /終了コード 1、出力: \.bugyo\/evidence\/t-001\.repro\.log/);
  assert.equal(field(cwd, 't-001', 'repro-status'), '1');
  assert.equal(field(cwd, 't-001', 'repro-expect'), 'のはずが');
  assert.match(field(cwd, 't-001', 'repro-tests-hash') ?? '', /^sha256:/);
  assert.match(readFileSync(join(cwd, '.bugyo/evidence/t-001.repro.log'), 'utf8'), /"hi bugyo"/);

  fixGreet(cwd);
  writeFileSync(join(cwd, 'lib/greet/model/greet.test.js'), "import { test } from 'node:test';\ntest('弱めた', () => {});\n");
  const closed = ok(cwd, 'task', 'done', 't-001');
  assert.match(closed.stdout, /^warn {2}repro のあとにテストファイルが変わっています/m);
  const evidence = JSON.parse(readFileSync(join(cwd, '.bugyo/evidence/t-001.json'), 'utf8'));
  assert.equal(evidence.repro.status, 1);
  assert.equal(evidence.repro.log, '.bugyo/evidence/t-001.repro.log');
  assert.equal(evidence.warnings.length, 1);
});

/**
 * @param {string} cwd
 * @param {...string} args
 */
function git(cwd, ...args) {
  const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')}\n${run.stderr}`);
  return run.stdout.trim();
}

/** フィクスチャを git のリポジトリにして最初のコミットを作る */
function repo() {
  const cwd = project();
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'init');
  return cwd;
}

test('worktree: 2つの worktree で同時に add しても別々の id になる', () => {
  const cwd = repo();
  const other = join(cwd, '..', 'wt2');
  git(cwd, 'worktree', 'add', '-q', other, '-b', 'wt2');
  assert.match(ok(cwd, 'task', 'add', 'こちら', '--type', 'chore').stdout, /^t-001 /);
  assert.match(ok(other, 'task', 'add', 'あちら', '--type', 'chore').stdout, /^t-002 /);
  assert.match(ok(cwd, 'task', 'add', 'こちら2', '--type', 'chore').stdout, /^t-003 /);
});

test('worktree: 別の worktree で着手したタスクは start を断り、ready にも出ない。release で消すと着手できる', () => {
  const cwd = repo();
  ok(cwd, 'task', 'add', '共有のタスク', '--type', 'chore');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'task');
  const other = join(cwd, '..', 'wt2');
  git(cwd, 'worktree', 'add', '-q', other, '-b', 'wt2');

  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  const refused = bugyo(other, 'task', 'start', 't-001', '--as', 'w2');
  assert.equal(refused.status, 1, refused.all);
  assert.match(refused.stderr, /t-001 はすでに w1 が作業中です（ブランチ main）/);
  assert.match(ok(other, 'task', 'ready').stdout, /着手できるタスクはありません/);

  assert.match(ok(other, 'task', 'release', 't-001').stdout, /t-001 の着手の記録を消しました（w1、ブランチ main）/);
  ok(other, 'task', 'start', 't-001', '--as', 'w2');
  assert.equal(bugyo(other, 'task', 'release', 'no-such').status, 1);
});

test('worktree: やめたタスクの着手の記録は消える', () => {
  const cwd = repo();
  ok(cwd, 'task', 'add', 'やめる', '--type', 'chore');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'drop', 't-001', '-r', '要らなくなった');
  const release = bugyo(cwd, 'task', 'release', 't-001');
  assert.equal(release.status, 1);
  assert.match(release.stderr, /着手の記録はありません/);
});

test('claims.remote: 別のクローンとも id と着手を共有する', () => {
  const base = mkdtempSync(join(tmpdir(), 'bugyo-remote-'));
  const remote = join(base, 'remote.git');
  git(base, 'init', '-q', '--bare', remote);
  const a = repo();
  editConfig(a, (config) => (config.claims = { remote: 'origin' }));
  git(a, 'remote', 'add', 'origin', remote);
  git(a, 'add', '-A');
  git(a, 'commit', '-qm', 'config');
  git(a, 'push', '-q', 'origin', 'main');
  const b = join(base, 'b');
  git(base, 'clone', '-q', '-b', 'main', remote, b);

  assert.match(ok(a, 'task', 'add', 'A のタスク', '--type', 'chore').stdout, /^t-001 /);
  assert.match(ok(b, 'task', 'add', 'B のタスク', '--type', 'chore').stdout, /^t-002 /);

  git(a, 'add', '-A');
  git(a, 'commit', '-qm', 't-001');
  git(a, 'push', '-q', 'origin', 'main');
  rmSync(join(b, '.bugyo/tasks/t-002.md'));
  git(b, 'pull', '-q', 'origin', 'main');
  ok(a, 'task', 'start', 't-001', '--as', 'w1');
  const refused = bugyo(b, 'task', 'start', 't-001', '--as', 'w2');
  assert.equal(refused.status, 1, refused.all);
  assert.match(refused.stderr, /t-001 はすでに w1 が作業中です/);
});

test('task lint --base: 別のブランチで同じ id を振ったタスクを、マージする前に見つける', () => {
  const cwd = repo();
  git(cwd, 'switch', '-q', '-c', 'feature');

  git(cwd, 'switch', '-q', 'main');
  ok(cwd, 'task', 'add', 'main で作った', '--type', 'chore');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'main の t-001');
  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  ok(cwd, 'task', 'done', 't-001');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'main で閉じる');
  ok(cwd, 'task', 'lint', '--base', 'HEAD~1');

  git(cwd, 'switch', '-q', 'feature');
  ok(cwd, 'task', 'add', 'feature で作った', '--type', 'chore');
  const reserved = join(cwd, '.bugyo/tasks/t-002.md');
  writeFileSync(join(cwd, '.bugyo/tasks/t-001.md'), readFileSync(reserved, 'utf8'));
  rmSync(reserved);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'feature の t-001');
  ok(cwd, 'task', 'lint');
  const run = bugyo(cwd, 'task', 'lint', '--base', 'main');
  assert.equal(run.status, 1, run.all);
  assert.match(run.stderr, /t-001 は main の .*archive\/t-001\.md と同じ id の別のタスクです/);
});

test('task pr-check: task/<id> のブランチか台帳の差分で紐づきを確かめ、allowBranches は通す', () => {
  const cwd = repo();
  ok(cwd, 'task', 'add', 'a', '--type', 'chore');
  ok(cwd, 'task', 'add', 'b', '--type', 'chore');
  ok(cwd, 'task', 'drop', 't-002', '-r', 'いらなくなった');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'tasks');

  assert.match(ok(cwd, 'task', 'pr-check', '--branch', 'task/t-001-login').stdout, /^pr-check: OK task\/t-001-login（ブランチ名: t-001）/);
  const missing = bugyo(cwd, 'task', 'pr-check', '--branch', 'task/t-009');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /タスク t-009 が台帳にありません/);
  assert.match(bugyo(cwd, 'task', 'pr-check', '--branch', 'task/t-002').stderr, /t-002 は中止されています/);

  git(cwd, 'switch', '-q', '-c', 'fix-typo');
  writeFileSync(join(cwd, 'README.md'), 'typo\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'typo');
  const unlinked = bugyo(cwd, 'task', 'pr-check', '--base', 'main');
  assert.equal(unlinked.status, 1, unlinked.all);
  assert.match(unlinked.stderr, /ブランチ fix-typo の作業がタスクに紐づいていません/);
  assert.match(unlinked.stderr, /pullRequests\.allowBranches/);

  ok(cwd, 'task', 'start', 't-001', '--as', 'w1');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'start');
  assert.match(ok(cwd, 'task', 'pr-check', '--base', 'main').stdout, /OK fix-typo（台帳の差分: t-001）/);

  git(cwd, 'switch', '-q', '-c', 'dependabot/npm/zod-4', 'main');
  assert.equal(bugyo(cwd, 'task', 'pr-check', '--base', 'main').status, 1);
  editConfig(cwd, (config) => (config.pullRequests = { allowBranches: ['dependabot/**'] }));
  const allowed = JSON.parse(ok(cwd, 'task', 'pr-check', '--base', 'main', '--json').stdout);
  assert.deepEqual(allowed, { branch: 'dependabot/npm/zod-4', ok: true, how: 'allowed', ids: [] });
});