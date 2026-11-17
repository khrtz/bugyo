import { parseArgs } from 'node:util';
import { configFile, loadConfig } from './config.js';
import { collectEvidence, requirements, testsHash } from './evidence.js';
import { featureDir, loadFeatures } from './feature-map.js';
import { evaluateGate } from './gate.js';
import { isMistakeKind, loadMistakes, mistakeLine, mistakeState, recordMistake, recordRule, sortMistakes } from './mistakes.js';
import { runCommand } from './run.js';
import { lintTasks } from './task-lint.js';
import {
  findTask,
  isTaskId,
  loadTasks,
  nextTaskId,
  openBlockers,
  saveTask,
  taskJson,
  taskLine,
  types,
  typesNeedingFeature,
} from './tasks.js';

export class UsageError extends Error {}

export const taskUsage = `  bugyo task add "<タイトル>" --type <種類> [--feature <id>] [--blocked-by <id,...>] [--body "<本文>"]
  bugyo task ready                       未着手でブロックされていないタスク
  bugyo task start <id> --as <名前>      作業中にする
  bugyo task show <id>                   本文、読むもの、完了に必要なもの
  bugyo task repro <id> -- <コマンド>    bugfix: 直す前に失敗することを記録する
  bugyo task done <id>                   証拠を取り、通れば閉じる
  bugyo task rework <id> -r "<理由>" --kind <ミスの種類> [--as <名前>]
  bugyo task drop <id> -r "<理由>"
  bugyo task ls [--all]                  一覧（--all で完了・中止も）
  bugyo task lint                        台帳の整合を検査する
  bugyo mistake ls                       ミスの種類ごとの回数とルール
  bugyo mistake rule <種類> --at <パス>  ルールに変えたことを記録する
  bugyo gate                             任せる範囲を広げてよいかを計算する
  （どれも --json で短い JSON を出す）`;

/**
 * @param {string[]} args
 */
function parse(args) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        type: { type: 'string' },
        feature: { type: 'string' },
        'blocked-by': { type: 'string' },
        body: { type: 'string' },
        as: { type: 'string' },
        reason: { type: 'string', short: 'r' },
        kind: { type: 'string' },
        at: { type: 'string' },
        json: { type: 'boolean' },
        all: { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * @param {boolean | undefined} json
 * @param {string[]} lines
 * @param {unknown} data
 */
function print(json, lines, data) {
  if (json) console.log(JSON.stringify(data));
  else for (const line of lines) console.log(line);
}

/**
 * @param {string | undefined} value
 * @param {string} message
 * @returns {string}
 */
function required(value, message) {
  if (value === undefined || value.trim() === '') throw new UsageError(message);
  return value.trim();
}

/** @param {string} cwd */
function featureIds(cwd) {
  return loadFeatures(cwd).map((feature) => feature.id);
}

const now = () => new Date().toISOString();
/** 人が読む行に書く、手元の日付（YYYY-MM-DD） */
const today = () => new Date().toLocaleDateString('sv-SE');

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function add(args, cwd) {
  const { values, positionals } = parse(args);
  const title = required(positionals[0], 'タイトルを渡してください: bugyo task add "<タイトル>" --type <種類>');
  const type = required(values.type, `--type を渡してください（${types.join(' / ')}）`);
  if (!types.some((candidate) => candidate === type)) throw new UsageError(`--type は ${types.join(' / ')} のどれかです`);
  const feature = values.feature?.trim() ?? '';
  if (feature === '' && typesNeedingFeature.has(type)) throw new UsageError(`${type} のタスクには --feature <id> が要ります`);
  if (feature !== '') {
    const ids = featureIds(cwd);
    if (!ids.includes(feature)) throw new Error(`${feature} は feature map（${featureDir}）にありません。候補: ${ids.join(', ')}`);
  }
  const tasks = loadTasks(cwd);
  const blockedBy = (values['blocked-by'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  for (const id of blockedBy) {
    if (!isTaskId(id) || !tasks.some((task) => task.id === id)) throw new Error(`blocked-by の ${id} というタスクはありません`);
  }
  const id = nextTaskId(tasks);
  const description = values.body?.trim() || '（何が起きているか、どうなれば終わりか）';
  const task = saveTask(cwd, {
    id,
    title,
    status: 'open',
    type: /** @type {import('./tasks.js').Task['type']} */ (type),
    feature,
    'blocked-by': blockedBy,
    assignee: '',
    rework: 0,
    'gate-attempts': 0,
    created: now(),
    body: `\n# ${title}\n\n${description}\n`,
    file: '',
    archived: false,
  });
  print(values.json, [taskLine(task)], taskJson(task));
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function ready(args, cwd) {
  const { values } = parse(args);
  const tasks = loadTasks(cwd);
  const candidates = tasks.filter((task) => task.status === 'open' && openBlockers(task, tasks).length === 0);
  print(values.json, candidates.length === 0 ? ['着手できるタスクはありません'] : candidates.map(taskLine), candidates.map(taskJson));
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function start(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], '使い方: bugyo task start <id> --as <名前>');
  const assignee = required(values.as, '--as <名前> で作業する人かエージェントの名前を渡してください');
  const tasks = loadTasks(cwd);
  const task = findTask(tasks, id);
  if (task.status === 'active') throw new Error(`${id} はすでに ${task.assignee} が作業中です`);
  if (task.status !== 'open') throw new Error(`${id} は ${task.status} です。start できるのは open のタスクだけです`);
  const blockers = openBlockers(task, tasks);
  if (blockers.length > 0) throw new Error(`${id} は ${blockers.join(', ')} が終わるまで着手できません`);
  const busy = tasks.find((other) => other.status === 'active' && other.assignee === assignee);
  if (busy !== undefined) throw new Error(`${assignee} はすでに ${busy.id} を作業中です。1人1件にしてください`);
  const config = loadConfig(cwd);
  const started = saveTask(cwd, { ...task, status: 'active', assignee, 'tests-hash': testsHash(cwd, config.evidence.tree) });
  print(values.json, [taskLine(started)], taskJson(started));
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function show(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], '使い方: bugyo task show <id>');
  const tasks = loadTasks(cwd);
  const task = findTask(tasks, id);
  const steps = requirements(task, loadConfig(cwd));
  const read = task.feature === '' ? [] : [`${featureDir}/${task.feature}.md`];
  const missing = steps.filter((step) => step.kind === 'command' && step.name !== 'repro' && step.command === undefined);
  const blockers = openBlockers(task, tasks);
  const description = task.body.replace(/^\s*# .+\r?\n/, '').trim();
  const lines = [
    taskLine(task),
    `読む: ${read.length === 0 ? 'なし' : read.join(', ')}`,
    `完了に必要: ${steps.map((step) => step.label).join(' → ')}`,
    ...(missing.length === 0 ? [] : [`注意: ${missing.map((step) => `commands.${step.name}`).join(', ')} が ${configFile} にないので done できません`]),
    ...(blockers.length === 0 ? [] : [`待ち: ${blockers.join(', ')} が終わっていません`]),
    ...(description === '' ? [] : ['', description]),
  ];
  print(values.json, lines, { ...taskJson(task), read, requires: steps.map((step) => step.label), body: description });
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function repro(args, cwd) {
  const separator = args.indexOf('--');
  const command = separator < 0 ? '' : args.slice(separator + 1).join(' ').trim();
  const { values, positionals } = parse(separator < 0 ? args : args.slice(0, separator));
  const id = required(positionals[0], '使い方: bugyo task repro <id> -- <テストコマンド>');
  if (command === '') throw new UsageError('-- のあとに、直す前に失敗するテストのコマンドを書いてください');
  const task = findTask(loadTasks(cwd), id);
  if (task.type !== 'bugfix') throw new Error(`repro は bugfix のタスクで使います（${id} は ${task.type}）`);
  if (task.status !== 'active') throw new Error(`${id} は ${task.status} です。先に bugyo task start ${id} --as <名前>`);
  const run = runCommand(command, cwd);
  if (run.status === 0) throw new Error(`${command} は今通っています。直す前に失敗するテストを書いてから記録してください`);
  const recorded = saveTask(cwd, { ...task, repro: command, 'repro-at': now() });
  print(values.json, [`${taskLine(recorded)}  再現を記録しました: ${command}（終了コード ${run.status}）`], { ...taskJson(recorded), repro: command, status: run.status });
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function done(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], '使い方: bugyo task done <id>');
  const config = loadConfig(cwd);
  const task = findTask(loadTasks(cwd), id);
  if (task.status === 'open') throw new Error(`${id} はまだ open です。先に bugyo task start ${id} --as <名前>`);
  if (task.status !== 'active') throw new Error(`${id} は ${task.status} です。done にできるのは active のタスクだけです`);
  const missing = requirements(task, config).filter((step) => step.kind === 'command' && step.name !== 'repro' && step.command === undefined);
  if (missing.length > 0) {
    throw new Error(
      `${id} (${task.type}) の完了に要る ${missing.map((step) => `commands.${step.name}`).join(', ')} が ${configFile} にありません。証拠を取れないので done にしません`,
    );
  }
  const attempt = saveTask(cwd, { ...task, 'gate-attempts': task['gate-attempts'] + 1 });
  const outcome = collectEvidence(attempt, config, cwd);
  if (!outcome.ok) {
    const lines = [`FAIL ${taskLine(attempt)}  ${outcome.step.label}: ${outcome.reason}（gate-attempts: ${attempt['gate-attempts']}）`];
    if (outcome.output !== '') lines.push(outcome.output);
    print(values.json, lines, { ...taskJson(attempt), ok: false, failed: outcome.step.label, reason: outcome.reason });
    return 1;
  }
  const closed = saveTask(cwd, {
    ...attempt,
    status: 'done',
    'evidence-file': outcome.file,
    'evidence-tree': outcome.tree,
    'evidence-at': now(),
  });
  print(values.json, [`DONE ${taskLine(closed)}  証拠: ${outcome.file}`], { ...taskJson(closed), ok: true, evidence: outcome.file });
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function rework(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], '使い方: bugyo task rework <id> -r "<理由>" --kind <ミスの種類>');
  const known = loadMistakes(cwd).map((mistake) => mistake.kind);
  const hint = known.length === 0 ? 'まだ記録された種類はありません' : `記録済みの種類: ${known.join(', ')}（近いものがあればそれを使ってください）`;
  const kind = required(values.kind, `--kind <ミスの種類> を渡してください。${hint}`);
  const reason = required(values.reason, '-r "<理由>" で、何を手直ししたかを書いてください');
  if (!isMistakeKind(kind)) throw new UsageError(`ミスの種類 "${kind}" は小文字・数字・ハイフンにしてください。${hint}`);
  const tasks = loadTasks(cwd);
  const task = findTask(tasks, id);
  if (task.status !== 'done') throw new Error(`${id} は ${task.status} です。rework できるのは done のタスクだけです`);
  const assignee = values.as?.trim() || task.assignee;
  const busy = tasks.find((other) => other.status === 'active' && other.assignee === assignee);
  if (busy !== undefined) {
    throw new Error(`${assignee} はいま ${busy.id} を作業中です。1人1件なので、--as <名前> で手直しする担当を指定してください`);
  }
  const day = today();
  const count = task.rework + 1;
  const body = `${task.body.trimEnd()}\n${task.body.includes('\n## 手直し\n') ? '' : '\n## 手直し\n\n'}- ${count}回目（${kind}、${day}）: ${reason}\n`;
  const reopened = saveTask(cwd, {
    ...task,
    assignee,
    status: 'active',
    rework: count,
    body,
    'evidence-file': undefined,
    'evidence-tree': undefined,
    'evidence-at': undefined,
  });
  const mistake = recordMistake(cwd, kind, { task: id, reason, day });
  const isNew = !known.includes(kind) && known.length > 0 ? `  新しい種類です（${hint}）` : '';
  print(values.json, [`${taskLine(reopened)}  手直し ${count}回目 / ミス: ${mistakeLine(mistake)}${isNew}`], {
    ...taskJson(reopened),
    mistake: { kind, count: mistake.count, state: mistakeState(mistake) },
  });
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function drop(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], '使い方: bugyo task drop <id> -r "<理由>"');
  const reason = required(values.reason, '-r "<理由>" で、やめる理由を書いてください');
  const task = findTask(loadTasks(cwd), id);
  if (task.status === 'done') throw new Error(`${id} は完了しています。直すなら bugyo task rework を使ってください`);
  if (task.status === 'dropped') throw new Error(`${id} はすでにやめています`);
  const dropped = saveTask(cwd, { ...task, status: 'dropped', 'drop-reason': reason });
  print(values.json, [taskLine(dropped)], taskJson(dropped));
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function ls(args, cwd) {
  const { values } = parse(args);
  const tasks = loadTasks(cwd)
    .filter((task) => values.all || !task.archived)
    .sort((a, b) => a.id.localeCompare(b.id));
  print(values.json, tasks.length === 0 ? ['タスクはありません'] : tasks.map(taskLine), tasks.map(taskJson));
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function lint(args, cwd) {
  const { values } = parse(args);
  const { count, errors, warnings } = lintTasks(cwd);
  const summary = `task lint: タスク ${count}件、エラー ${errors.length}件、警告 ${warnings.length}件`;
  if (values.json) console.log(JSON.stringify({ ok: errors.length === 0, count, errors, warnings }));
  else {
    for (const error of errors) console.error(`error ${error}`);
    for (const warning of warnings) console.log(`warn  ${warning}`);
    (errors.length > 0 ? console.error : console.log)(summary);
  }
  return errors.length > 0 ? 1 : 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
export function taskCommand(args, cwd = process.cwd()) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'add':
      return add(rest, cwd);
    case 'ready':
      return ready(rest, cwd);
    case 'start':
      return start(rest, cwd);
    case 'show':
      return show(rest, cwd);
    case 'repro':
      return repro(rest, cwd);
    case 'done':
      return done(rest, cwd);
    case 'rework':
      return rework(rest, cwd);
    case 'drop':
      return drop(rest, cwd);
    case 'ls':
      return ls(rest, cwd);
    case 'lint':
      return lint(rest, cwd);
    default:
      throw new UsageError(`bugyo task のサブコマンドは add / ready / start / show / repro / done / rework / drop / ls / lint です`);
  }
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
export function mistakeCommand(args, cwd = process.cwd()) {
  const [sub, ...rest] = args;
  const { values, positionals } = parse(rest);
  if (sub === 'ls') {
    const mistakes = sortMistakes(loadMistakes(cwd));
    print(
      values.json,
      mistakes.length === 0 ? ['ミスの記録はありません'] : mistakes.map(mistakeLine),
      mistakes.map((mistake) => ({ kind: mistake.kind, count: mistake.count, rule: mistake.rule, state: mistakeState(mistake) })),
    );
    return 0;
  }
  if (sub === 'rule') {
    const kind = required(positionals[0], '使い方: bugyo mistake rule <種類> --at <ルールを書いたファイル>');
    const at = required(values.at, '--at <パス> で、ルールを書いたファイルを渡してください');
    const mistake = recordRule(cwd, kind, at);
    print(values.json, [mistakeLine(mistake)], { kind: mistake.kind, count: mistake.count, rule: mistake.rule, state: mistakeState(mistake) });
    return 0;
  }
  throw new UsageError('bugyo mistake のサブコマンドは ls / rule です');
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
export function gateCommand(args, cwd = process.cwd()) {
  const { values } = parse(args);
  const config = loadConfig(cwd);
  const result = evaluateGate(loadTasks(cwd), loadMistakes(cwd), config.gate);
  const lines = [
    `gate: ${result.passed ? '合格' : '不合格'}（直近 ${result.window}件の完了タスクで判定）`,
    ...result.conditions.map(
      (condition) =>
        `  ${condition.ok ? 'OK' : 'NG'} ${condition.label}: ${condition.value}${condition.name === 'repeated-mistakes' ? '種類' : '件'}（${condition.limit}）${
          condition.kinds !== undefined && condition.kinds.length > 0 ? ` ${condition.kinds.join(', ')}` : ''
        }`,
    ),
  ];
  print(values.json, lines, result);
  return result.passed ? 0 : 1;
}

