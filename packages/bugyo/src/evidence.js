import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { featureRoots, taskCommands } from './config.js';
import { featureDir, loadFeatures, sectionHeadings, unfilledSections } from './feature-map.js';
import { tr } from './locale.js';
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
 * ファイルの中身。テキスト（NUL を含まない）は改行を LF にそろえる。
 * git の改行変換（Windows の core.autocrlf）で、手元と CI のハッシュが食い違わないようにするため。
 *
 * @param {string} path
 */
function normalized(path) {
  const buffer = readFileSync(path);
  return buffer.includes(0) ? buffer : Buffer.from(buffer.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

/**
 * @param {string} cwd
 * @param {string[]} files
 */
function hashFiles(cwd, files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(`${file}\0`);
    hash.update(createHash('sha256').update(normalized(join(cwd, file))).digest('hex'));
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
    return /** @type {Step} */ ({ kind: 'command', name, label: resolved ?? tr({ en: `commands.${name} (not set)`, ja: `commands.${name}（未設定）` }), command: resolved });
  };
  const modelDirs = featureRoots(config)
    .flatMap(({ featuresDir, parts }) => parts.model.map((name) => `${featuresDir}/${task.feature}/${name}/`))
    .join(tr({ en: ' or ', ja: ' か ' }));
  switch (task.type) {
    case 'feature':
      return [{ kind: 'condition', name: 'feature-map', label: tr({ en: `fill the four headings of ${featureDir}/${task.feature}.md`, ja: `${featureDir}/${task.feature}.md の4見出しを埋める` }) }, command('check'), command('test'), command('verify')];
    case 'ui-flow':
      return [command('check'), command('test'), command('verify')];
    case 'ui-look':
      return [command('check'), command('verify')];
    case 'logic':
      return [{ kind: 'condition', name: 'model-test', label: tr({ en: `tests exist in ${modelDirs || 'model/ of the feature folder'}`, ja: `${modelDirs || '機能のフォルダの model/'} にテストがある` }) }, command('check'), command('test')];
    case 'bugfix':
      return [
        { kind: 'condition', name: 'repro-recorded', label: tr({ en: 'a recorded repro', ja: 'repro の記録' }) },
        { kind: 'command', name: 'repro', label: tr({ en: 'the same test passes', ja: '同じテストが通る' }), command: task.repro },
        command('check'),
        command('test'),
      ];
    case 'refactor':
      return [{ kind: 'condition', name: 'tests-unchanged', label: tr({ en: 'test files unchanged since start', ja: 'テストファイルを start のときから変えない' }) }, command('check'), command('test')];
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
      if (feature === undefined) return tr({ en: `${featureDir}/${task.feature}.md does not exist`, ja: `${featureDir}/${task.feature}.md がありません` });
      const unfilled = unfilledSections(feature);
      return unfilled.length === 0
        ? null
        : tr({ en: `${feature.file} has empty or template headings: ${unfilled.map((ja) => sectionHeadings.find((heading) => heading.ja === ja)?.en ?? ja).join(', ')}`, ja: `${feature.file} の見出しが空か雛形のままです: ${unfilled.join('、')}` });
    }
    case 'model-test': {
      if (config.featureMap.featuresDir === null) return tr({ en: 'featureMap.featuresDir is null, so model/ cannot be found', ja: 'featureMap.featuresDir が null なので model/ を探せません' });
      const dirs = featureRoots(config).flatMap(({ featuresDir, parts }) => parts.model.map((name) => `${featuresDir}/${task.feature}/${name}`));
      return dirs.some((dir) => walk(cwd, dir).some((file) => testFilePattern.test(file))) ? null : tr({ en: `no tests (*.test.*) in ${dirs.join(' or ')}`, ja: `${dirs.join(' と ')} にテスト（*.test.*）がありません` });
    }
    case 'repro-recorded':
      return task.repro === undefined ? tr({ en: `Before fixing, record the failure with bugyo task repro ${task.id} -- <test command>`, ja: `直す前に bugyo task repro ${task.id} -- <テストコマンド> で失敗を記録してください` }) : null;
    case 'tests-unchanged':
      if (task['tests-hash'] === undefined) return tr({ en: 'There is no hash of the test files from start', ja: 'start のときのテストファイルのハッシュがありません' });
      return testsHash(cwd, config.evidence.tree) === task['tests-hash'] ? null : tr({
            en: `Test files changed since start (*.test.* / *.spec.* in ${config.evidence.tree.join(', ')})`,
            ja: `テストファイルが start のときから変わっています（${config.evidence.tree.join(', ')} の *.test.* / *.spec.*）`,
          });
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
 * @typedef {{ ok: true, evidence: object, file: string, tree: string, warnings: string[] }
 *   | { ok: false, step: Step, reason: string, output: string }} CollectOutcome
 */

/**
 * 完了に必要なものを順に確かめ、すべて通れば証拠ファイルを書く。
 *
 * @param {import('./tasks.js').Task} task gate-attempts を数え終えたタスク
 * @param {import('./index.js').BugyoConfig} config
 * @param {string} cwd
 * @param {{ write?: boolean }} [options] write: false なら証拠ファイルを書かない（CI での取り直し）
 * @returns {CollectOutcome}
 */
export function collectEvidence(task, config, cwd, options = {}) {
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
      const same = step.label === command;
      const reason = tr({
        en: `${same ? 'failed' : `${command} failed`} with exit code ${run.status}`,
        ja: `${same ? '' : `${command} が`}終了コード ${run.status} で落ちました`,
      });
      return { ok: false, step, reason, output: tail(run.output) };
    }
  }
  const tree = treeHash(cwd, config.evidence.tree);
  /** @type {string[]} */
  const warnings = [];
  if (task['repro-tests-hash'] !== undefined && testsHash(cwd, config.evidence.tree) !== task['repro-tests-hash']) {
    warnings.push(
      tr({
        en: `Test files changed after the repro. Check the diff to make sure the test that failed before the fix was not weakened (*.test.* / *.spec.* in ${config.evidence.tree.join(', ')})`,
        ja: `repro のあとにテストファイルが変わっています。直す前に落ちたテストを弱めていないか、差分を確かめてください（${config.evidence.tree.join(', ')} の *.test.* / *.spec.*）`,
      }),
    );
  }
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
    ...(task.repro === undefined
      ? {}
      : {
          repro: {
            command: task.repro,
            failedAt: task['repro-at'],
            status: task['repro-status'],
            testsHash: task['repro-tests-hash'],
            log: task['repro-log'],
            expect: task['repro-expect'],
          },
        }),
    warnings,
    tree: { paths: config.evidence.tree, hash: tree },
  };
  if (options.write ?? true) {
    mkdirSync(join(cwd, evidenceDir), { recursive: true });
    writeFileSync(join(cwd, file), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return { ok: true, evidence, file, tree, warnings };
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
