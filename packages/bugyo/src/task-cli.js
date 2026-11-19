import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { configFile, loadConfig, taskCommands } from './config.js';
import { cliLocale, cliMessages, tr } from './locale.js';
import { collectEvidence, requirements, testsHash } from './evidence.js';
import { featureDir, loadFeatures } from './feature-map.js';
import { evaluateGate } from './gate.js';
import { currentBranch, prCheck } from './pr-check.js';
import { isMistakeKind, loadMistakes, mistakeJson, mistakeLine, mistakeState, mistakeSummary, mistakeSummaryLine, recordMistake, recordRule, sortMistakes } from './mistakes.js';
import { claimTask, fetchClaims, listRecords, openClaims, reassignClaim, readRecord, releaseClaim, reserveId } from './claims.js';
import { changedArchiveIds, duplicateIdsAgainst, notifyVerified, recheckTask } from './recheck.js';
import { commandExists, ranNoTests, runCommand, tail } from './run.js';
import { percent, readStatsExport, statsFormat, taskStats, wideInterval, wilsonInterval } from './stats.js';
import { lintTasks } from './task-lint.js';
import {
  agentNamePattern,
  amountPattern,
  evidenceDir,
  findTask,
  isTaskId,
  issuePattern,
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

/** @returns {string} */
export const taskUsage = () =>
  tr({
    en: `  bugyo task add "<title>" --type <type> [--feature <id>] [--issue <ref>] [--blocked-by <id,...>] [--body "<text>"]
  bugyo task ready                       open tasks that are not blocked
  bugyo task start <id> --as <name> [--model <model>] [--harness <harness>]  mark as active
  bugyo task show <id>                   the body, what to read, and what done requires
  bugyo task repro <id> [--expect "<text>"] -- <command>  bugfix: record that the test fails before the fix
  bugyo task done <id> [--model <model>] [--harness <harness>] [--tokens <n>] [--usd <amount>]  collect evidence and close the task if it passes
                                         (--tokens / --usd: what the work cost since it started or was last reworked)
  bugyo task rework <id> -r "<reason>" --kind <mistake kind> [--as <name>]
  bugyo task drop <id> -r "<reason>"
  bugyo task ls [--all]                  list tasks (--all includes done and dropped)
  bugyo task release <id>                human: clear the claim of a stuck agent
  bugyo task lint [--base <ref>]         check the ledger (--base also finds ids that already exist in <ref>)
  bugyo task recheck [<id>...] [--base <ref>] [--notify]  re-collect and compare evidence of done tasks (for CI; --base checks tasks
                                         closed in <ref>...HEAD; --notify reports passing tasks to their issue with notify.verified)
  bugyo task pr-check [--branch <name>] [--base <ref>]  for CI: check that the PR's work is linked to a task (a task/<id> branch or a ledger change)
  bugyo mistake ls                       mistakes per kind with their rules, and how many kinds became rules
  bugyo mistake rule <kind> --at <path> [--name <rule name>]  record that a mistake became a rule
  bugyo gate [--scope <group>]           decide, per group of task types, whether to widen what agents may do
  bugyo stats [--export <file>]          results of closed tasks per task type, model, and harness (--export writes them as JSON)
  bugyo stats --compare <file>...        compare results exported from several projects
  (without --model, --harness, --tokens, and --usd, BUGYO_MODEL, BUGYO_HARNESS, BUGYO_TOKENS, and BUGYO_USD are used)
  (every command prints short JSON with --json)`,
    ja: `  bugyo task add "<タイトル>" --type <種類> [--feature <id>] [--issue <参照>] [--blocked-by <id,...>] [--body "<本文>"]
  bugyo task ready                       未着手でブロックされていないタスク
  bugyo task start <id> --as <名前> [--model <モデル>] [--harness <ハーネス>]  作業中にする
  bugyo task show <id>                   本文、読むもの、完了に必要なもの
  bugyo task repro <id> [--expect "<文言>"] -- <コマンド>  bugfix: 直す前に失敗することを記録する
  bugyo task done <id> [--model <モデル>] [--harness <ハーネス>] [--tokens <数>] [--usd <金額>]  証拠を取り、通れば閉じる
                                         （--tokens / --usd: 着手か前の手直しから閉じるまでにかかったコスト）
  bugyo task rework <id> -r "<理由>" --kind <ミスの種類> [--as <名前>]
  bugyo task drop <id> -r "<理由>"
  bugyo task ls [--all]                  一覧（--all で完了・中止も）
  bugyo task release <id>                人: 止まったエージェントの着手の記録を消す
  bugyo task lint [--base <ref>]         台帳の整合を検査する（--base なら、<ref> にすでにある id と重なるタスクも見つける）
  bugyo task recheck [<id>...] [--base <ref>] [--notify]  完了タスクの証拠を取り直して照合する（CI 用。--base なら <ref>...HEAD で閉じたタスク。
                                         --notify なら、通ったタスクの課題に notify.verified のコマンドで知らせる）
  bugyo task pr-check [--branch <名前>] [--base <ref>]  CI 用: PR の作業がタスクに紐づいているかを確かめる（task/<id> のブランチか、台帳の差分）
  bugyo mistake ls                       ミスの種類ごとの回数とルール、ルール化済みの種類の数
  bugyo mistake rule <種類> --at <パス> [--name <ルールの名前>]  ルールに変えたことを記録する
  bugyo gate [--scope <まとまり>]        任せる範囲を広げてよいかを、作業の種類のまとまりごとに計算する
  bugyo stats [--export <ファイル>]      閉じたタスクの実績を、作業の種類・モデル・ハーネスごとに出す（--export で JSON に書き出す）
  bugyo stats --compare <ファイル>...    いくつものプロジェクトから書き出した実績を並べて比べる
  （--model・--harness・--tokens・--usd を省くと、環境変数 BUGYO_MODEL・BUGYO_HARNESS・BUGYO_TOKENS・BUGYO_USD を使う）
  （どれも --json で短い JSON を出す）`,
  });

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
        issue: { type: 'string' },
        notify: { type: 'boolean' },
        'blocked-by': { type: 'string' },
        body: { type: 'string' },
        as: { type: 'string' },
        model: { type: 'string' },
        harness: { type: 'string' },
        tokens: { type: 'string' },
        usd: { type: 'string' },
        export: { type: 'string' },
        compare: { type: 'boolean' },
        reason: { type: 'string', short: 'r' },
        kind: { type: 'string' },
        at: { type: 'string' },
        name: { type: 'string' },
        base: { type: 'string' },
        branch: { type: 'string' },
        scope: { type: 'string' },
        expect: { type: 'string' },
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
  const title = required(positionals[0], tr({ en: 'Pass a title: bugyo task add "<title>" --type <type>', ja: 'タイトルを渡してください: bugyo task add "<タイトル>" --type <種類>' }));
  const type = required(values.type, tr({ en: `Pass --type (${types.join(' / ')})`, ja: `--type を渡してください（${types.join(' / ')}）` }));
  if (!types.some((candidate) => candidate === type)) throw new UsageError(tr({ en: `--type must be one of ${types.join(' / ')}`, ja: `--type は ${types.join(' / ')} のどれかです` }));
  const feature = values.feature?.trim() ?? '';
  if (feature === '' && typesNeedingFeature.has(type)) throw new UsageError(tr({ en: `A ${type} task needs --feature <id>`, ja: `${type} のタスクには --feature <id> が要ります` }));
  if (feature !== '') {
    const ids = featureIds(cwd);
    if (!ids.includes(feature)) throw new Error(tr({ en: `${feature} is not in the feature map (${featureDir}). Known: ${ids.join(', ')}`, ja: `${feature} は feature map（${featureDir}）にありません。候補: ${ids.join(', ')}` }));
  }
  const tasks = loadTasks(cwd);
  const blockedBy = (values['blocked-by'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  for (const id of blockedBy) {
    if (!isTaskId(id) || !tasks.some((task) => task.id === id)) throw new Error(tr({ en: `blocked-by: there is no task ${id}`, ja: `blocked-by の ${id} というタスクはありません` }));
  }
  const issue = values.issue?.trim() || undefined;
  if (issue !== undefined && !issuePattern.test(issue)) throw new UsageError(tr({ en: '--issue must start with a letter or digit and use only letters, digits, and # . _ : / - (e.g. 123, PROJ-45, an issue URL)', ja: '--issue は英数字で始め、英数字と # . _ : / - だけにしてください（例: 123、PROJ-45、課題の URL）' }));
  const claims = openClaims(cwd, loadConfig(cwd).claims.remote);
  const id = claims === undefined ? nextTaskId(tasks) : reserveId(claims, Number(nextTaskId(tasks).slice(2)) - 1);
  const description = values.body?.trim() || tr({ en: '(What is happening, and what counts as done)', ja: '（何が起きているか、どうなれば終わりか）' });
  const task = saveTask(cwd, {
    id,
    title,
    status: 'open',
    type: /** @type {import('./tasks.js').Task['type']} */ (type),
    feature,
    issue,
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
  const claims = openClaims(cwd, loadConfig(cwd).claims.remote);
  if (claims !== undefined) fetchClaims(claims);
  const claimed = new Set(claims === undefined ? [] : listRecords(claims, 'claims'));
  const candidates = tasks.filter((task) => task.status === 'open' && !claimed.has(task.id) && openBlockers(task, tasks).length === 0);
  print(values.json, candidates.length === 0 ? [tr({ en: 'No tasks are ready', ja: '着手できるタスクはありません' })] : candidates.map(taskLine), candidates.map(taskJson));
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function start(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], tr({ en: 'Usage: bugyo task start <id> --as <name>', ja: '使い方: bugyo task start <id> --as <名前>' }));
  const assignee = required(values.as, tr({ en: 'Pass the name of the person or agent doing the work with --as <name>', ja: '--as <名前> で作業する人かエージェントの名前を渡してください' }));
  const tasks = loadTasks(cwd);
  const task = findTask(tasks, id);
  if (task.status === 'active') throw new Error(tr({ en: `${id} is already being worked on by ${task.assignee}`, ja: `${id} はすでに ${task.assignee} が作業中です` }));
  if (task.status !== 'open') throw new Error(tr({ en: `${id} is ${task.status}. Only open tasks can be started`, ja: `${id} は ${task.status} です。start できるのは open のタスクだけです` }));
  const blockers = openBlockers(task, tasks);
  if (blockers.length > 0) throw new Error(tr({ en: `${id} cannot start until ${blockers.join(', ')} are done`, ja: `${id} は ${blockers.join(', ')} が終わるまで着手できません` }));
  const busy = tasks.find((other) => other.status === 'active' && other.assignee === assignee);
  if (busy !== undefined) throw new Error(tr({ en: `${assignee} is already working on ${busy.id}. One task per worker`, ja: `${assignee} はすでに ${busy.id} を作業中です。1人1件にしてください` }));
  const config = loadConfig(cwd);
  const claims = openClaims(cwd, config.claims.remote);
  if (claims !== undefined) {
    const claim = claimTask(claims, id, assignee);
    if (!claim.ok) {
      const branch = claim.holder.branch;
      throw new Error(
        tr({
          en: `${id} is already being worked on by ${claim.holder.assignee ?? 'someone'}${branch === '' ? '' : ` (branch ${branch})`}. If they are stuck, a human can clear the claim with bugyo task release ${id}`,
          ja: `${id} はすでに ${claim.holder.assignee ?? '誰か'} が作業中です${branch === '' ? '' : `（ブランチ ${branch}）`}。止まっているなら、人が bugyo task release ${id} で記録を消してください`,
        }),
      );
    }
  }
  const started = saveTask(cwd, { ...task, ...agentOf(values, task), status: 'active', assignee, 'tests-hash': testsHash(cwd, config.evidence.tree) });
  print(values.json, [taskLine(started)], taskJson(started));
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function show(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], tr({ en: 'Usage: bugyo task show <id>', ja: '使い方: bugyo task show <id>' }));
  const tasks = loadTasks(cwd);
  const task = findTask(tasks, id);
  const steps = requirements(task, loadConfig(cwd));
  const read = task.feature === '' ? [] : [`${featureDir}/${task.feature}.md`];
  const missing = steps.filter((step) => step.kind === 'command' && step.name !== 'repro' && step.command === undefined);
  const blockers = openBlockers(task, tasks);
  const description = task.body.replace(/^\s*# .+\r?\n/, '').trim();
  const lines = [
    taskLine(task),
    tr({ en: `read: ${read.length === 0 ? 'nothing' : read.join(', ')}`, ja: `読む: ${read.length === 0 ? 'なし' : read.join(', ')}` }),
    tr({ en: 'done requires: ', ja: '完了に必要: ' }) + steps.map((step) => step.label).join(' → '),
    ...(missing.length === 0
      ? []
      : [
          tr({
            en: `note: ${missing.map((step) => `commands.${step.name}`).join(', ')} is missing from ${configFile}, so done will refuse`,
            ja: `注意: ${missing.map((step) => `commands.${step.name}`).join(', ')} が ${configFile} にないので done できません`,
          }),
        ]),
    ...(blockers.length === 0 ? [] : [tr({ en: `waiting: ${blockers.join(', ')} not done yet`, ja: `待ち: ${blockers.join(', ')} が終わっていません` })]),
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
  const id = required(positionals[0], tr({ en: 'Usage: bugyo task repro <id> -- <test command>', ja: '使い方: bugyo task repro <id> -- <テストコマンド>' }));
  if (command === '') throw new UsageError(tr({ en: 'After --, write the test command that fails before the fix', ja: '-- のあとに、直す前に失敗するテストのコマンドを書いてください' }));
  const task = findTask(loadTasks(cwd), id);
  if (task.type !== 'bugfix') throw new Error(tr({ en: `repro is for bugfix tasks (${id} is ${task.type})`, ja: `repro は bugfix のタスクで使います（${id} は ${task.type}）` }));
  if (task.status !== 'active') throw new Error(tr({ en: `${id} is ${task.status}. Run bugyo task start ${id} --as <name> first`, ja: `${id} は ${task.status} です。先に bugyo task start ${id} --as <名前>` }));
  const expect = values.expect?.trim();
  if (values.expect !== undefined && expect === '') throw new UsageError(tr({ en: '--expect takes text that should appear in the failing output', ja: '--expect には、失敗の出力に出るはずの文言を書いてください' }));
  if (!commandExists(command, cwd)) throw new Error(tr({ en: `The first command of ${command} was not found. Check the test command`, ja: `${command} の最初のコマンドが見つかりません。テストのコマンドを確かめてください` }));
  const run = runCommand(command, cwd);
  if (run.status === 0) throw new Error(tr({ en: `${command} passes now. Write a test that fails before the fix, then record it`, ja: `${command} は今通っています。直す前に失敗するテストを書いてから記録してください` }));
  if (run.status === 127 || run.status === 9009) throw new Error(tr({ en: `${command} failed because a command was not found (exit code ${run.status}). Check the test command`, ja: `${command} は、コマンドが見つからずに落ちました（終了コード ${run.status}）。テストのコマンドを確かめてください` }));
  if (ranNoTests(run.output)) throw new Error(`${tr({ en: `${command} ran no tests. Write a test that fails before the fix, then record it`, ja: `${command} はテストを1件も実行していません。直す前に失敗するテストを書いてから記録してください` })}\n${tail(run.output, 10)}`);
  if (expect !== undefined && !run.output.includes(expect)) {
    throw new Error(`${tr({ en: `The output of ${command} does not contain "${expect}". It may be failing for a different reason`, ja: `${command} の出力に「${expect}」がありません。狙った理由で落ちていないかもしれません` })}\n${tail(run.output)}`);
  }
  const config = loadConfig(cwd);
  const log = `${evidenceDir}/${task.id}.repro.log`;
  mkdirSync(join(cwd, evidenceDir), { recursive: true });
  writeFileSync(join(cwd, log), `$ ${command}\n${tail(run.output, 60)}\n`);
  const recorded = saveTask(cwd, {
    ...task,
    repro: command,
    'repro-at': now(),
    'repro-status': run.status,
    'repro-tests-hash': testsHash(cwd, config.evidence.tree),
    'repro-log': log,
    'repro-expect': expect,
  });
  print(values.json, [`${taskLine(recorded)}  ${tr({ en: `recorded the repro: ${command} (exit code ${run.status}, output: ${log})`, ja: `再現を記録しました: ${command}（終了コード ${run.status}、出力: ${log}）` })}`], {
    ...taskJson(recorded),
    repro: command,
    status: run.status,
    log,
  });
  return 0;
}

/**
 * 作業したモデルとハーネス。--model / --harness、環境変数 BUGYO_MODEL / BUGYO_HARNESS、タスクに記録済みの値の順に使う。
 *
 * @param {{ model?: string | undefined, harness?: string | undefined }} values
 * @param {import('./tasks.js').Task} task
 * @returns {{ model?: string, harness?: string }}
 */
function agentOf(values, task) {
  /** @param {string} name @param {string | undefined} option @param {string | undefined} env @param {string | undefined} recorded */
  const pick = (name, option, env, recorded) => {
    const value = option?.trim() || env?.trim() || recorded;
    if (value !== undefined && !agentNamePattern.test(value)) throw new UsageError(tr({ en: `${name} "${value}" must start with a letter or digit and use only letters, digits, and . _ : / @ + -`, ja: `${name} の "${value}" は、英数字で始め、英数字と . _ : / @ + - だけにしてください` }));
    return value;
  };
  const model = pick('--model', values.model, process.env.BUGYO_MODEL, task.model);
  const harness = pick('--harness', values.harness, process.env.BUGYO_HARNESS, task.harness);
  return { ...(model === undefined ? {} : { model }), ...(harness === undefined ? {} : { harness }) };
}

/**
 * 閉じるまでにかかったコスト。--tokens / --usd、なければ環境変数 BUGYO_TOKENS / BUGYO_USD。
 * 閉じたときだけ、タスクに記録済みの値に足す（手直しのあとにまた閉じれば、その分も足す）。
 *
 * @param {{ tokens?: string | undefined, usd?: string | undefined }} values
 * @param {import('./tasks.js').Task} task
 * @returns {{ 'cost-tokens'?: number, 'cost-usd'?: string }}
 */
function costOf(values, task) {
  const tokens = values.tokens?.trim() || process.env['BUGYO_TOKENS']?.trim() || undefined;
  const usd = values.usd?.trim() || process.env['BUGYO_USD']?.trim() || undefined;
  if (tokens !== undefined && !/^\d+$/.test(tokens)) throw new UsageError(tr({ en: `--tokens "${tokens}" must be an integer of 0 or more`, ja: `--tokens の "${tokens}" は 0 以上の整数にしてください` }));
  if (usd !== undefined && !amountPattern.test(usd)) throw new UsageError(tr({ en: `--usd "${usd}" must be a decimal number of 0 or more`, ja: `--usd の "${usd}" は 0 以上の10進数にしてください` }));
  const added = (/** @type {string | undefined} */ recorded, /** @type {string} */ value) => {
    const digits = Math.max(decimals(recorded ?? '0'), decimals(value));
    return (Number(recorded ?? '0') + Number(value)).toFixed(digits);
  };
  return {
    ...(tokens === undefined ? {} : { 'cost-tokens': (task['cost-tokens'] ?? 0) + Number(tokens) }),
    ...(usd === undefined ? {} : { 'cost-usd': added(task['cost-usd'], usd) }),
  };
}

/** @param {string} value */
const decimals = (value) => value.split('.')[1]?.length ?? 0;

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function done(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], tr({ en: 'Usage: bugyo task done <id>', ja: '使い方: bugyo task done <id>' }));
  const config = loadConfig(cwd);
  const task = findTask(loadTasks(cwd), id);
  const cost = costOf(values, task);
  if (task.status === 'open') throw new Error(tr({ en: `${id} is still open. Run bugyo task start ${id} --as <name> first`, ja: `${id} はまだ open です。先に bugyo task start ${id} --as <名前>` }));
  if (task.status !== 'active') throw new Error(tr({ en: `${id} is ${task.status}. Only active tasks can be done`, ja: `${id} は ${task.status} です。done にできるのは active のタスクだけです` }));
  const missing = requirements(task, config).filter((step) => step.kind === 'command' && step.name !== 'repro' && step.command === undefined);
  if (missing.length > 0) {
    throw new Error(
      tr({
        en: `${id} (${task.type}) needs ${missing.map((step) => `commands.${step.name}`).join(', ')} in ${configFile} to be done. Without it there is no evidence, so the task stays open`,
        ja: `${id} (${task.type}) の完了に要る ${missing.map((step) => `commands.${step.name}`).join(', ')} が ${configFile} にありません。証拠を取れないので done にしません`,
      }),
    );
  }
  const attempt = saveTask(cwd, { ...task, ...agentOf(values, task), 'gate-attempts': task['gate-attempts'] + 1 });
  const outcome = collectEvidence(attempt, config, cwd);
  if (!outcome.ok) {
    const lines = [`FAIL ${taskLine(attempt)}  ${outcome.step.label}: ${outcome.reason}${tr({ en: ` (gate-attempts: ${attempt['gate-attempts']})`, ja: `（gate-attempts: ${attempt['gate-attempts']}）` })}`];
    if (outcome.output !== '') lines.push(outcome.output);
    print(values.json, lines, { ...taskJson(attempt), ok: false, failed: outcome.step.label, reason: outcome.reason });
    return 1;
  }
  const closed = saveTask(cwd, {
    ...attempt,
    ...cost,
    status: 'done',
    'evidence-file': outcome.file,
    'evidence-tree': outcome.tree,
    'evidence-at': now(),
  });
  print(
    values.json,
    [`DONE ${taskLine(closed)}  ${cliMessages(cliLocale(config)).done} ${outcome.file}`, ...outcome.warnings.map((warning) => `warn  ${warning}`)],
    { ...taskJson(closed), ok: true, evidence: outcome.file, warnings: outcome.warnings },
  );
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function rework(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], tr({ en: 'Usage: bugyo task rework <id> -r "<reason>" --kind <mistake kind>', ja: '使い方: bugyo task rework <id> -r "<理由>" --kind <ミスの種類>' }));
  const known = loadMistakes(cwd).map((mistake) => mistake.kind);
  const hint =
    known.length === 0
      ? tr({ en: 'No kinds recorded yet', ja: 'まだ記録された種類はありません' })
      : tr({ en: `Recorded kinds: ${known.join(', ')} (reuse a close one if there is one)`, ja: `記録済みの種類: ${known.join(', ')}（近いものがあればそれを使ってください）` });
  const kind = required(values.kind, tr({ en: `Pass --kind <mistake kind>. ${hint}`, ja: `--kind <ミスの種類> を渡してください。${hint}` }));
  const reason = required(values.reason, tr({ en: 'Describe what was reworked with -r "<reason>"', ja: '-r "<理由>" で、何を手直ししたかを書いてください' }));
  if (!isMistakeKind(kind)) throw new UsageError(tr({ en: `The mistake kind "${kind}" must use lowercase letters, digits, and hyphens. ${hint}`, ja: `ミスの種類 "${kind}" は小文字・数字・ハイフンにしてください。${hint}` }));
  const tasks = loadTasks(cwd);
  const task = findTask(tasks, id);
  if (task.status !== 'done') throw new Error(tr({ en: `${id} is ${task.status}. Only done tasks can be reworked`, ja: `${id} は ${task.status} です。rework できるのは done のタスクだけです` }));
  const assignee = values.as?.trim() || task.assignee;
  const busy = tasks.find((other) => other.status === 'active' && other.assignee === assignee);
  if (busy !== undefined) {
    throw new Error(tr({ en: `${assignee} is working on ${busy.id}. One task per worker, so name who does the rework with --as <name>`, ja: `${assignee} はいま ${busy.id} を作業中です。1人1件なので、--as <名前> で手直しする担当を指定してください` }));
  }
  const claims = openClaims(cwd, loadConfig(cwd).claims.remote);
  if (claims !== undefined && assignee !== task.assignee) reassignClaim(claims, id, assignee);
  const day = today();
  const count = task.rework + 1;
  const hasSection = task.body.includes('\n## 手直し\n') || task.body.includes('\n## Rework\n');
  const section = hasSection ? '' : tr({ en: '\n## Rework\n\n', ja: '\n## 手直し\n\n' });
  const entry = tr({ en: `- #${count} (${kind}, ${day}): ${reason}`, ja: `- ${count}回目（${kind}、${day}）: ${reason}` });
  const body = `${task.body.trimEnd()}\n${section}${entry}\n`;
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
  const isNew = !known.includes(kind) && known.length > 0 ? tr({ en: `  this is a new kind (${hint})`, ja: `  新しい種類です（${hint}）` }) : '';
  print(values.json, [`${taskLine(reopened)}  ${tr({ en: `rework #${count} / mistake: `, ja: `手直し ${count}回目 / ミス: ` })}${mistakeLine(mistake)}${isNew}`], {
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
  const id = required(positionals[0], tr({ en: 'Usage: bugyo task drop <id> -r "<reason>"', ja: '使い方: bugyo task drop <id> -r "<理由>"' }));
  const reason = required(values.reason, tr({ en: 'Give the reason for dropping with -r "<reason>"', ja: '-r "<理由>" で、やめる理由を書いてください' }));
  const task = findTask(loadTasks(cwd), id);
  if (task.status === 'done') throw new Error(tr({ en: `${id} is done. To change it, use bugyo task rework`, ja: `${id} は完了しています。直すなら bugyo task rework を使ってください` }));
  if (task.status === 'dropped') throw new Error(tr({ en: `${id} is already dropped`, ja: `${id} はすでにやめています` }));
  const dropped = saveTask(cwd, { ...task, status: 'dropped', 'drop-reason': reason, 'dropped-at': now() });
  const claims = openClaims(cwd, loadConfig(cwd).claims.remote);
  if (claims !== undefined) releaseClaim(claims, id);
  print(values.json, [taskLine(dropped)], taskJson(dropped));
  return 0;
}

/**
 * 止まったエージェントの着手の記録を、人が消す。台帳のファイルは変えない。
 *
 * @param {string[]} args
 * @param {string} cwd
 */
function release(args, cwd) {
  const { values, positionals } = parse(args);
  const id = required(positionals[0], tr({ en: 'Usage: bugyo task release <id>', ja: '使い方: bugyo task release <id>' }));
  const claims = openClaims(cwd, loadConfig(cwd).claims.remote);
  if (claims === undefined) throw new Error(tr({ en: 'This is not a git repository, so there are no claims', ja: 'git のリポジトリではないので、着手の記録はありません' }));
  if (claims.remote !== undefined) fetchClaims(claims);
  const holder = readRecord(claims, 'claims', id);
  if (holder === undefined) throw new Error(tr({ en: `There is no claim for ${id}`, ja: `${id} の着手の記録はありません` }));
  releaseClaim(claims, id);
  const line = tr({
    en: `Cleared the claim for ${id} (${holder.assignee ?? 'no assignee'}${holder.branch === '' ? '' : `, branch ${holder.branch}`})`,
    ja: `${id} の着手の記録を消しました（${holder.assignee ?? '担当なし'}${holder.branch === '' ? '' : `、ブランチ ${holder.branch}`}）`,
  });
  print(values.json, [line], { id, released: true, assignee: holder.assignee, branch: holder.branch });
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
  print(values.json, tasks.length === 0 ? [tr({ en: 'No tasks', ja: 'タスクはありません' })] : tasks.map(taskLine), tasks.map(taskJson));
  return 0;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function lint(args, cwd) {
  const { values } = parse(args);
  const { count, errors, warnings } = lintTasks(cwd);
  if (values.base !== undefined) errors.push(...duplicateIdsAgainst(cwd, values.base));
  const summary = tr({
    en: `task lint: ${count} tasks, ${errors.length} errors, ${warnings.length} warnings`,
    ja: `task lint: タスク ${count}件、エラー ${errors.length}件、警告 ${warnings.length}件`,
  });
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
function prCheckCommand(args, cwd) {
  const { values } = parse(args);
  const branch = currentBranch(cwd, values.branch);
  const result = prCheck({ cwd, branch, base: values.base, allowBranches: loadConfig(cwd).pullRequests.allowBranches, tasks: loadTasks(cwd) });
  const how = {
    branch: tr({ en: 'branch name', ja: 'ブランチ名' }),
    ledger: tr({ en: 'ledger change', ja: '台帳の差分' }),
    allowed: 'pullRequests.allowBranches',
  };
  if (values.json) console.log(JSON.stringify({ branch, ...result }));
  else if (result.ok) {
    const detail = `${how[result.how]}${result.ids.length === 0 ? '' : `: ${result.ids.join(', ')}`}`;
    console.log(tr({ en: `pr-check: OK ${branch} (${detail})`, ja: `pr-check: OK ${branch}（${detail}）` }));
  }
  else console.error(`pr-check: NG ${result.message}`);
  return result.ok ? 0 : 1;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function recheck(args, cwd) {
  const { values, positionals } = parse(args);
  if (positionals.length === 0 && values.base === undefined) throw new UsageError(tr({ en: 'Usage: bugyo task recheck <id>... or bugyo task recheck --base <ref>', ja: '使い方: bugyo task recheck <id>... か bugyo task recheck --base <ref>' }));
  const ids = [...new Set([...positionals, ...(values.base === undefined ? [] : changedArchiveIds(cwd, values.base))])];
  const config = loadConfig(cwd);
  const tasks = loadTasks(cwd);
  const results = ids.map((id) => recheckTask(findTask(tasks, id), config, cwd));
  const failed = results.filter((result) => !result.ok);
  /** @type {{ id: string, ok: boolean, message: string }[]} */
  const notices = [];
  if (values.notify) {
    const command = config.notify.verified;
    const verified = results
      .filter((result) => result.ok)
      .map((result) => findTask(tasks, result.id))
      .filter((task) => task.status === 'done' && task.issue !== undefined);
    if (command === undefined) {
      if (verified.length > 0) notices.push({ id: '', ok: false, message: tr({ en: `${configFile} has no notify.verified, so issues are not notified`, ja: `${configFile} に notify.verified がないので、課題に知らせません` }) });
    } else {
      for (const task of verified) notices.push({ id: task.id, ...notifyVerified(task, command, cwd) });
    }
  }
  const lines = [
    ...results.flatMap((result) => [`${result.ok ? 'OK  ' : 'FAIL'} ${result.id}  ${result.reason}`, ...(result.output === '' ? [] : [result.output])]),
    ...notices.map((notice) => `${notice.ok ? 'notify' : 'warn  '} ${notice.message}`),
    tr({ en: `task recheck: checked ${results.length}, ${failed.length} mismatched`, ja: `task recheck: ${results.length}件を照合、不一致 ${failed.length}件` }),
  ];
  print(values.json, lines, {
    ok: failed.length === 0,
    results: results.map(({ id, ok, reason }) => ({ id, ok, reason })),
    ...(values.notify ? { notified: notices } : {}),
  });
  return failed.length === 0 ? 0 : 1;
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
    case 'recheck':
      return recheck(rest, cwd);
    case 'pr-check':
      return prCheckCommand(rest, cwd);
    case 'release':
      return release(rest, cwd);
    default:
      throw new UsageError(
        tr({
          en: 'bugyo task subcommands: add / ready / start / show / repro / done / rework / drop / release / ls / lint / recheck / pr-check',
          ja: 'bugyo task のサブコマンドは add / ready / start / show / repro / done / rework / drop / release / ls / lint / recheck / pr-check です',
        }),
      );
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
    const summary = mistakeSummary(mistakes);
    print(values.json, mistakes.length === 0 ? [tr({ en: 'No mistakes recorded', ja: 'ミスの記録はありません' })] : [...mistakes.map(mistakeLine), mistakeSummaryLine(summary)], { summary, mistakes: mistakes.map(mistakeJson) });
    return 0;
  }
  if (sub === 'rule') {
    const kind = required(positionals[0], tr({ en: 'Usage: bugyo mistake rule <kind> --at <file with the rule> [--name <rule name>]', ja: '使い方: bugyo mistake rule <種類> --at <ルールを書いたファイル> [--name <ルールの名前>]' }));
    const at = required(values.at, tr({ en: 'Pass the file that holds the rule with --at <path>', ja: '--at <パス> で、ルールを書いたファイルを渡してください' }));
    const name = values.name === undefined ? undefined : required(values.name, tr({ en: 'Pass the rule name to --name (a ban name, a rule ID, a test name, ...)', ja: '--name に、ルールの名前（禁止の名前、ルール ID、テストの名前など）を渡してください' }));
    const mistake = recordRule(cwd, kind, at, name);
    print(values.json, [mistakeLine(mistake)], mistakeJson(mistake));
    return 0;
  }
  throw new UsageError(tr({ en: 'bugyo mistake subcommands: ls / rule', ja: 'bugyo mistake のサブコマンドは ls / rule です' }));
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
export function gateCommand(args, cwd = process.cwd()) {
  const { values } = parse(args);
  const config = loadConfig(cwd);
  const result = evaluateGate(loadTasks(cwd), loadMistakes(cwd), config.gate, values.scope);
  const lines = [
    tr({
      en: `gate: ${result.passed ? 'PASS' : 'FAIL'} (judged per group of task types, from the latest closed tasks)`,
      ja: `gate: ${result.passed ? '合格' : '不合格'}（作業の種類のまとまりごとに、直近の閉じたタスクで判定）`,
    }),
    ...result.scopes.flatMap((scope) => [
      tr({
        en: `  [${scope.name}] ${scope.passed ? 'PASS' : 'FAIL'} (latest ${scope.window} of ${scope.types.join(', ')})`,
        ja: `  [${scope.name}] ${scope.passed ? '合格' : '不合格'}（${scope.types.join(', ')} の直近 ${scope.window}件）`,
      }),
      ...scope.conditions.map(
        (condition) =>
          `    ${condition.ok ? 'OK' : 'NG'} ${condition.label}: ${condition.value}${condition.name === 'repeated-mistakes' ? tr({ en: ' kinds', ja: '種類' }) : tr({ en: '', ja: '件' })}${tr({ en: ` (${condition.limit})`, ja: `（${condition.limit}）` })}${
            condition.kinds !== undefined && condition.kinds.length > 0 ? ` ${condition.kinds.join(', ')}` : ''
          }`,
      ),
    ]),
  ];
  const warnings = gateWarnings(result.scopes);
  print(values.json, [...lines, ...warnings.map((warning) => `warn  ${warning}`)], { ...result, warnings });
  return result.passed ? 0 : 1;
}

/**
 * 数字だけで判断しないほうがよいときの警告。件数が判定の件数に足りないとき、1回で通った割合の 95% 区間が広いとき。
 *
 * @param {ReturnType<typeof evaluateGate>['scopes']} scopes
 */
function gateWarnings(scopes) {
  return scopes.flatMap((scope) => {
    const value = (/** @type {string} */ name) => scope.conditions.find((condition) => condition.name === name)?.value ?? 0;
    const closed = value('count');
    const done = closed - value('dropped');
    const firstPass = value('first-pass');
    const interval = wilsonInterval(firstPass, done);
    /** @type {string[]} */
    const warnings = [];
    if (closed < scope.window) warnings.push(
        tr({
          en: `[${scope.name}] Only ${closed} closed tasks, fewer than the ${scope.window} the gate needs. The verdict is not reliable yet`,
          ja: `[${scope.name}] 閉じたタスクが ${closed}件で、判定の ${scope.window}件に足りません。合否はまだ当てになりません`,
        }),
      );
    if (done > 0 && interval.high - interval.low > wideInterval) {
      warnings.push(
        tr({
          en: `[${scope.name}] The 95% interval of the first-pass rate ${firstPass}/${done} is ${percent(interval.low)}–${percent(interval.high)}. It is wide, so decide after more tasks`,
          ja: `[${scope.name}] 1回で通った割合 ${firstPass}/${done} の 95% 区間は ${percent(interval.low)}〜${percent(interval.high)} です。幅が広いので、件数を増やしてから判断してください`,
        }),
      );
    }
    return warnings;
  });
}

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
export function statsCommand(args, cwd = process.cwd()) {
  const { values, positionals } = parse(args);
  if (values.compare) return compareStats(positionals, values.json, cwd);
  const rows = taskStats(loadTasks(cwd));
  if (values.export !== undefined) {
    const file = required(values.export, tr({ en: 'Pass the file to write to --export <file>', ja: '--export <ファイル> に、書き出す先を渡してください' }));
    const commands = Object.fromEntries(Object.entries(taskCommands(loadConfig(cwd))).filter((entry) => entry[1] !== undefined));
    const data = { format: statsFormat.name, version: statsFormat.version, project: projectName(cwd), exportedAt: now(), commands, rows };
    writeFileSync(join(cwd, file), `${JSON.stringify(data, null, 2)}\n`);
    print(values.json, [tr({ en: `stats: wrote ${rows.length} rows to ${file}`, ja: `stats: ${rows.length}行を ${file} に書き出しました` })], { file, rows: rows.length });
    return 0;
  }
  const lines =
    rows.length === 0
      ? [tr({ en: 'stats: no closed tasks yet', ja: 'stats: 閉じたタスクはまだありません' })]
      : [
          tr({
            en: 'stats: results of closed tasks (done and dropped). First pass and rework are shares of done tasks; dropped is a share of closed tasks',
            ja: 'stats: 閉じたタスク（完了と中止）の実績。1回で通った・手直しは完了の中の割合、中止は閉じたタスクの中の割合',
          }),
          ...rows.flatMap((row) => statsLines(row, '')),
        ];
  print(values.json, lines, { rows });
  return 0;
}

/**
 * @param {import('./stats.js').StatsRow} row
 * @param {string} label
 */
function statsLines(row, label) {
  const rate = (/** @type {number} */ part, /** @type {number} */ whole) => (whole === 0 ? '-' : percent(part / whole));
  const low = percent(row.firstPassInterval.low);
  const high = percent(row.firstPassInterval.high);
  const main = tr({
    en: `  ${label}${row.type}  model: ${row.model}  harness: ${row.harness}  closed ${row.closed}  first pass ${rate(row.firstPass, row.done)}${row.done === 0 ? '' : ` (95% interval ${low}–${high})`}  rework ${rate(row.reworked, row.done)}  dropped ${rate(row.dropped, row.closed)}`,
    ja: `  ${label}${row.type}  モデル: ${row.model}  ハーネス: ${row.harness}  閉じた ${row.closed}件  1回で通った ${rate(row.firstPass, row.done)}${row.done === 0 ? '' : `（95% 区間 ${low}〜${high}）`}  手直し ${rate(row.reworked, row.done)}  中止 ${rate(row.dropped, row.closed)}`,
  });
  const cost = row.cost ?? { tokens: { tasks: 0, firstPass: 0, sum: 0 }, usd: { tasks: 0, firstPass: 0, sum: 0 } };
  const parts = [
    costPart(cost.tokens, row.done, (value) => Math.round(value).toLocaleString('en-US'), { en: 'tokens', ja: 'トークン' }),
    costPart(cost.usd, row.done, (value) => (value < 1 ? value.toFixed(3) : value.toFixed(2)), { en: 'USD', ja: 'USD' }),
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? [main] : [main, ...parts.map((part) => `    ${part}`)];
}

/**
 * @param {import('./stats.js').CostSum} total
 * @param {number} done
 * @param {(value: number) => string} format
 * @param {{ en: string, ja: string }} unit
 */
function costPart(total, done, format, unit) {
  if (total.tasks === 0) return undefined;
  const perFirstPass = total.firstPass === 0 ? '-' : format(total.sum / total.firstPass);
  return tr({
    en: `cost in ${unit.en}: ${format(total.sum / total.tasks)} per done task, ${perFirstPass} per first pass (recorded on ${total.tasks} of ${done} done tasks)`,
    ja: `コスト（${unit.ja}）: 完了1件あたり ${format(total.sum / total.tasks)}、1回で通った1件あたり ${perFirstPass}（記録のある完了 ${total.tasks}/${done}件）`,
  });
}

/** @param {string} cwd */
function projectName(cwd) {
  const file = join(cwd, 'package.json');
  if (existsSync(file)) {
    try {
      const name = JSON.parse(readFileSync(file, 'utf8')).name;
      if (typeof name === 'string' && name !== '') return name;
    } catch {
      return basename(cwd);
    }
  }
  return basename(cwd);
}

/**
 * 書き出した実績をいくつも並べて比べる。完了に要るコマンドがプロジェクトで違えば、同じ種類でも中身が違うことを知らせる。
 *
 * @param {string[]} files
 * @param {boolean | undefined} json
 * @param {string} cwd
 */
function compareStats(files, json, cwd) {
  if (files.length === 0) throw new UsageError(tr({ en: 'Usage: bugyo stats --compare <file>...', ja: '使い方: bugyo stats --compare <ファイル>...' }));
  const exports = files.map((file) => {
    const path = join(cwd, file);
    if (!existsSync(path)) throw new Error(tr({ en: `${file} does not exist`, ja: `${file} がありません` }));
    /** @type {unknown} */
    let data;
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(tr({ en: `${file} is not JSON`, ja: `${file} は JSON ではありません` }));
    }
    return readStatsExport(data, file, tr);
  });
  const types = [...new Set(exports.flatMap((data) => data.rows.map((row) => row.type)))].sort();
  const lines = [tr({ en: `stats: comparing ${exports.length} projects: ${exports.map((data) => data.project).join(', ')}`, ja: `stats: ${exports.length}つのプロジェクトを比べます: ${exports.map((data) => data.project).join(', ')}` })];
  for (const type of types) {
    lines.push(`${type}`);
    for (const data of exports) for (const row of data.rows.filter((candidate) => candidate.type === type)) lines.push(...statsLines(row, `[${data.project}] `));
  }
  const warnings = [];
  for (const step of ['check', 'test', 'verify']) {
    const used = new Set(exports.map((data) => data.commands[step] ?? '-'));
    if (used.size > 1) {
      warnings.push(
        tr({
          en: `commands.${step} differs between projects (${exports.map((data) => `${data.project}: ${data.commands[step] ?? '-'}`).join(', ')}). The same task type may need different checks, so compare with care`,
          ja: `commands.${step} がプロジェクトで違います（${exports.map((data) => `${data.project}: ${data.commands[step] ?? '-'}`).join('、')}）。同じ種類でも確かめる中身が違うので、比べるときは気をつけてください`,
        }),
      );
    }
  }
  print(json, [...lines, ...warnings.map((warning) => `warn  ${warning}`)], { projects: exports.map((data) => ({ project: data.project, exportedAt: data.exportedAt, commands: data.commands, rows: data.rows })), warnings });
  return 0;
}

