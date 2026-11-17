import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { taskCommands } from './config.js';
import { featureDir, loadFeatures, unfilledSections } from './feature-map.js';
import { runCommand, tail } from './run.js';
import { evidenceDir } from './tasks.js';
import { summaryFile } from './verify.js';

const testFilePattern = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * @param {string} cwd
 * @param {string} dir cwd からの相対パス
 * @returns {string[]} cwd からの相対パス（/ 区切り）
 */
function walk(cwd, dir) {
  const full = join(cwd, dir);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [dir];
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.name !== 'node_modules')
    .flatMap((entry) => (entry.isDirectory() ? walk(cwd, `${dir}/${entry.name}`) : entry.isFile() ? [`${dir}/${entry.name}`] : []));
}

/**
 * @param {string} cwd
 * @param {string[]} files
 */
function hashFiles(cwd, files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(`${file}\0`);
    hash.update(createHash('sha256').update(readFileSync(join(cwd, file))).digest('hex'));
    hash.update('\n');
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * 指定したパスの下のファイルの中身から1つのハッシュを作る。node_modules は含めない。
 *
 * @param {string} cwd
 * @param {readonly string[]} paths
 */
export function treeHash(cwd, paths) {
  return hashFiles(cwd, paths.flatMap((path) => walk(cwd, path)));
}

/**
 * 指定したパスの下のテストファイル（*.test.* と *.spec.*）だけのハッシュ。
 *
 * @param {string} cwd
 * @param {readonly string[]} paths
 */
export function testsHash(cwd, paths) {
  return hashFiles(
    cwd,
    paths.flatMap((path) => walk(cwd, path)).filter((file) => testFilePattern.test(file)),
  );
}

/**
 * @typedef {{ kind: 'command', name: 'check' | 'test' | 'verify' | 'repro', label: string, command: string | undefined }
 *   | { kind: 'condition', name: 'feature-map' | 'model-test' | 'repro-recorded' | 'tests-unchanged', label: string }} Step
 */

/**
 * タスクの種類から、完了に必要なものを順番に返す。
 *
 * @param {import('./tasks.js').Task} task
 * @param {import('./index.js').BugyoConfig} config
 * @returns {Step[]}
 */
export function requirements(task, config) {
  const commands = taskCommands(config);
  /** @param {'check' | 'test' | 'verify'} name */
  const command = (name) => {
    const template = commands[name];
    const resolved = template?.replaceAll('{feature}', task.feature).replaceAll('{task}', task.id);
    return /** @type {Step} */ ({ kind: 'command', name, label: resolved ?? `commands.${name}（未設定）`, command: resolved });
  };
  const featuresDir = config.featureMap.featuresDir ?? '機能のフォルダ';
  switch (task.type) {
    case 'feature':
      return [{ kind: 'condition', name: 'feature-map', label: `${featureDir}/${task.feature}.md の4見出しを埋める` }, command('check'), command('test'), command('verify')];
    case 'ui-flow':
      return [command('check'), command('test'), command('verify')];
    case 'ui-look':
      return [command('check'), command('verify')];
    case 'logic':
      return [{ kind: 'condition', name: 'model-test', label: `${featuresDir}/${task.feature}/model/ にテストがある` }, command('check'), command('test')];
    case 'bugfix':
      return [
        { kind: 'condition', name: 'repro-recorded', label: 'repro の記録' },
        { kind: 'command', name: 'repro', label: '同じテストが通る', command: task.repro },
        command('check'),
        command('test'),
      ];
    case 'refactor':
      return [{ kind: 'condition', name: 'tests-unchanged', label: 'テストファイルを start のときから変えない' }, command('check'), command('test')];
    case 'chore':
      return [command('check')];
  }
}

/**
 * 条件の確かめ。通らなければ理由を返す。
 *
 * @param {Step & { kind: 'condition' }} step
 * @param {import('./tasks.js').Task} task
 * @param {import('./index.js').BugyoConfig} config
 * @param {string} cwd
 * @returns {string | null}
 */
function checkCondition(step, task, config, cwd) {
  switch (step.name) {
    case 'feature-map': {
      const feature = loadFeatures(cwd).find((candidate) => candidate.id === task.feature);
      if (feature === undefined) return `${featureDir}/${task.feature}.md がありません`;
      const unfilled = unfilledSections(feature);
      return unfilled.length === 0 ? null : `${feature.file} の見出しが空か雛形のままです: ${unfilled.join('、')}`;
    }
    case 'model-test': {
      if (config.featureMap.featuresDir === null) return 'featureMap.featuresDir が null なので model/ を探せません';
      const dir = `${config.featureMap.featuresDir}/${task.feature}/model`;
      return walk(cwd, dir).some((file) => testFilePattern.test(file)) ? null : `${dir} にテスト（*.test.*）がありません`;
    }
    case 'repro-recorded':
      return task.repro === undefined ? `直す前に bugyo task repro ${task.id} -- <テストコマンド> で失敗を記録してください` : null;
    case 'tests-unchanged':
      if (task['tests-hash'] === undefined) return 'start のときのテストファイルのハッシュがありません';
      return testsHash(cwd, config.evidence.tree) === task['tests-hash'] ? null : `テストファイルが start のときから変わっています（${config.evidence.tree.join(', ')} の *.test.* / *.spec.*）`;
  }
}

/**
 * @param {string} cwd
 */
function readVerifySummary(cwd) {
  const path = join(cwd, summaryFile);
  if (!existsSync(path)) return undefined;
  try {
    return { file: summaryFile, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return undefined;
  }
}

/**
 * @typedef {{ name: string, command: string, status: number, ms: number, results?: unknown }} StepRecord
 * @typedef {{ ok: true, evidence: object, file: string, tree: string }
 *   | { ok: false, step: Step, reason: string, output: string }} CollectOutcome
 */

/**
 * 完了に必要なものを順に確かめ、すべて通れば証拠ファイルを書く。
 *
 * @param {import('./tasks.js').Task} task gate-attempts を数え終えたタスク
 * @param {import('./index.js').BugyoConfig} config
 * @param {string} cwd
 * @returns {CollectOutcome}
 */
export function collectEvidence(task, config, cwd) {
  /** @type {StepRecord[]} */
  const records = [];
  /** @type {string[]} */
  const conditions = [];
  for (const step of requirements(task, config)) {
    if (step.kind === 'condition') {
      const reason = checkCondition(step, task, config, cwd);
      if (reason !== null) return { ok: false, step, reason, output: '' };
      conditions.push(step.label);
      continue;
    }
    const command = step.command ?? '';
    const run = runCommand(command, cwd);
    /** @type {StepRecord} */
    const record = { name: step.name, command, status: run.status, ms: run.ms };
    if (step.name === 'verify') {
      const summary = readVerifySummary(cwd);
      if (summary !== undefined) record.results = summary;
    }
    records.push(record);
    if (run.status !== 0) {
      const what = step.label === command ? '' : `${command} が`;
      return { ok: false, step, reason: `${what}終了コード ${run.status} で落ちました`, output: tail(run.output) };
    }
  }
  const tree = treeHash(cwd, config.evidence.tree);
  const file = `${evidenceDir}/${task.id}.json`;
  const evidence = {
    task: task.id,
    type: task.type,
    feature: task.feature,
    closedAt: new Date().toISOString(),
    attempt: task['gate-attempts'],
    rework: task.rework,
    conditions,
    steps: records,
    ...(task.repro === undefined ? {} : { repro: { command: task.repro, failedAt: task['repro-at'] } }),
    tree: { paths: config.evidence.tree, hash: tree },
  };
  mkdirSync(join(cwd, evidenceDir), { recursive: true });
  writeFileSync(join(cwd, file), `${JSON.stringify(evidence, null, 2)}\n`);
  return { ok: true, evidence, file, tree };
}

/**
 * @param {string} cwd
 * @param {string} file
 * @returns {Record<string, unknown> | undefined}
 */
export function readEvidence(cwd, file) {
  const path = join(cwd, file);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}
