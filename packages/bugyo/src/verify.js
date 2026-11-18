import { createHash } from 'node:crypto';
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadConfig } from './config.js';
import { loadFeatures } from './feature-map.js';
import { runCommand, tail } from './run.js';
import { runsOf } from './runners.js';

const artifactsDir = 'artifacts';
/** verify が最後に書く、機能ごとの合否と証拠の場所の要約。task done が証拠に写す */
export const summaryFile = `${artifactsDir}/verify.json`;

/**
 * artifacts/ の中で verify が書くもの。実行のたびに、これだけを消してから始める（ほかのファイルには触らない）。
 *
 * @param {import('./index.js').BugyoConfig['verify']} verify
 */
function ownedArtifacts(verify) {
  return ['verify.json', 'results.json', 'report', 'test-results', 'verify', 'playwright', 'command', ...Object.keys(verify.runners ?? {})];
}

/**
 * Playwright の証拠を置く場所。既定の確かめ方は artifacts/ の直下、ほかの確かめ方は artifacts/<名前>/ の下。
 *
 * @param {string} name
 * @param {boolean} isDefault
 */
function playwrightPaths(name, isDefault) {
  const base = isDefault ? artifactsDir : `${artifactsDir}/${name}`;
  return { report: `${base}/results.json`, html: `${base}/report`, testResults: `${base}/test-results`, output: isDefault ? undefined : `${base}/test-results` };
}

/**
 * Playwright を実行するコマンド。パッケージマネージャーは通さず、node_modules/.bin の playwright を直接呼ぶ。
 *
 * @param {string[]} specs
 * @param {string | undefined} output
 */
const playwrightCommand = (specs, output) =>
  ['playwright', 'test', ...specs.map((spec) => `"${spec}"`), '--reporter=line,json,html', ...(output === undefined ? [] : [`--output "${output}"`])].join(' ');

/**
 * Playwright の JSON レポートから、spec ファイル（cwd からの相対パス）ごとの合否を読む。
 *
 * @param {string} cwd
 * @param {string} reportFile
 * @returns {Map<string, boolean>}
 */
function resultsBySpec(cwd, reportFile) {
  const results = new Map();
  const path = join(cwd, reportFile);
  if (!existsSync(path)) return results;
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const rootDir = typeof report.config?.rootDir === 'string' ? report.config.rootDir : join(cwd, 'e2e');
  /** @param {any} suite */
  const visit = (suite) => {
    const file = relative(cwd, join(rootDir, String(suite.file ?? ''))).split(sep).join('/');
    for (const spec of suite.specs ?? []) results.set(file, (results.get(file) ?? true) && spec.ok === true);
    for (const child of suite.suites ?? []) visit({ file: suite.file, ...child });
  };
  for (const suite of report.suites ?? []) visit(suite);
  return results;
}

/**
 * 確かめ方の `evidence` の glob に当たり、実行が始まってから書かれたファイルと、その中身のハッシュ（sha256）。
 * ファイルシステムの時刻の粗さのぶん、始まる2秒前までに書かれたものも数える。
 *
 * @param {string} cwd
 * @param {string[]} globs `{id}` と `{spec}` を置き換えたもの
 * @param {number} startedAt
 * @returns {EvidenceFile[]}
 */
function evidenceFiles(cwd, globs, startedAt) {
  const paths = [...new Set(globs.flatMap((glob) => globSync(glob, { cwd })))].map((path) => path.split(sep).join('/')).sort();
  return paths
    .filter((path) => {
      const stat = statSync(join(cwd, path));
      return stat.isFile() && stat.mtimeMs >= startedAt - 2000;
    })
    .map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(join(cwd, path))).digest('hex') }));
}

/**
 * @typedef {{ path: string, sha256: string }} EvidenceFile
 * @typedef {{ spec: string, runner: string, ok: boolean | undefined, command: string, files?: EvidenceFile[] }} RunResult
 * @typedef {{ id: string, ok: boolean | undefined, command: string, runs?: RunResult[], files?: EvidenceFile[] }} FeatureResult
 * @typedef {{ status: 0 | 1 | 2, lines: string[], results: FeatureResult[], evidence: string[] }} VerifyOutcome
 * @typedef {{ feature: import('./index.js').Feature, spec: string, runner: import('./runners.js').Runner }} Planned
 */

/**
 * 隔離環境が要る確かめ方が計画にあれば、`verify.sandbox` のコマンドを1回だけ実行する。なければ undefined。
 *
 * @param {Planned[]} plan
 * @param {string | undefined} command
 * @param {string} cwd
 */
function sandboxCheck(plan, command, cwd) {
  if (command === undefined || !plan.some((item) => item.runner.sandbox)) return undefined;
  const run = runCommand(command, cwd);
  return { ok: run.status === 0, command, status: run.status, output: tail(run.output) };
}

/**
 * 機能を実際に動かし、機能ごとの合否と証拠の場所を返す。表示は lines をそのまま出す。
 * spec ごとに確かめ方を決め、Playwright は確かめ方ごとに1回、command は spec ごとに1回実行する。
 *
 * @param {string | undefined} target 機能の id か `--all`
 * @param {string} [cwd]
 * @returns {VerifyOutcome}
 */
export function verify(target, cwd = process.cwd()) {
  const config = loadConfig(cwd);
  const features = loadFeatures(cwd);
  const targets = target === '--all' ? features : features.filter((feature) => feature.id === target);
  if (targets.length === 0) {
    return {
      status: 2,
      lines: [`使い方: bugyo verify <feature>|--all  (候補: ${features.map((feature) => feature.id).join(', ')})`],
      results: [],
      evidence: [],
    };
  }
  /** @type {Planned[]} */
  const plan = [];
  /** @type {string[]} */
  const errors = [];
  for (const feature of targets) {
    const resolved = runsOf(feature, config.verify);
    if ('error' in resolved) errors.push(resolved.error);
    else plan.push(...resolved.runs.map((run) => ({ feature, ...run })));
  }
  if (errors.length > 0) return { status: 2, lines: errors.map((error) => `error ${error}`), results: [], evidence: [] };

  for (const name of ownedArtifacts(config.verify)) rmSync(join(cwd, artifactsDir, name), { recursive: true, force: true });
  mkdirSync(join(cwd, artifactsDir), { recursive: true });
  /** @type {Map<Planned, { ok: boolean | undefined, command: string, passed: boolean, files?: EvidenceFile[] }>} */
  const outcomes = new Map();
  /** @type {string[]} */
  const evidence = [];
  /** @type {string[]} */
  const failedOutput = [];

  const sandbox = sandboxCheck(plan, config.verify.sandbox, cwd);
  if (sandbox !== undefined && !sandbox.ok) {
    for (const item of plan.filter((candidate) => candidate.runner.sandbox)) outcomes.set(item, { ok: false, command: sandbox.command, passed: false });
    failedOutput.push(`隔離環境ではないので、隔離環境が要る確かめ方（${[...new Set(plan.filter((item) => item.runner.sandbox).map((item) => item.runner.name))].join(', ')}）を動かしませんでした: ${sandbox.command} が終了コード ${sandbox.status}\n${sandbox.output}`);
  }
  const runnable = plan.filter((item) => !outcomes.has(item));

  const playwrightRunners = [...new Set(runnable.filter((item) => item.runner.runner === 'playwright').map((item) => item.runner))];
  for (const runner of playwrightRunners) {
    const items = runnable.filter((item) => item.runner === runner);
    const paths = playwrightPaths(runner.name, runner.name === config.verify.runner);
    const command = playwrightCommand([...new Set(items.map((item) => item.spec))], paths.output);
    const run = runCommand(command, cwd, {
      ...runner.env,
      PLAYWRIGHT_JSON_OUTPUT_NAME: paths.report,
      PLAYWRIGHT_HTML_OUTPUT_DIR: paths.html,
      PLAYWRIGHT_HTML_OPEN: 'never',
    });
    const bySpec = resultsBySpec(cwd, paths.report);
    for (const item of items) outcomes.set(item, { ok: bySpec.get(item.spec), command, passed: run.status === 0 });
    evidence.push(`${paths.testResults}（動画・スクリーンショット・トレース）`, `${paths.html}/index.html`);
    if (run.status !== 0) failedOutput.push(run.output);
  }

  const commandItems = runnable.filter((item) => item.runner.runner === 'command');
  if (commandItems.length > 0) mkdirSync(join(cwd, artifactsDir, 'verify'), { recursive: true });
  for (const item of commandItems) {
    const mine = commandItems.filter((other) => other.feature === item.feature);
    const log = `${artifactsDir}/verify/${item.feature.id}${mine.length === 1 ? '' : `.${mine.indexOf(item) + 1}`}.log`;
    const fill = (/** @type {string} */ text) => text.replaceAll('{id}', item.feature.id).replaceAll('{spec}', item.spec);
    const line = fill(item.runner.command ?? '');
    const startedAt = Date.now();
    const run = runCommand(line, cwd, item.runner.env);
    writeFileSync(join(cwd, log), `$ ${line}\n${run.output}`);
    evidence.push(log);
    if (item.runner.evidence.length === 0) {
      outcomes.set(item, { ok: run.status === 0, command: line, passed: run.status === 0 });
      if (run.status !== 0) failedOutput.push(`$ ${line}\n${run.output}`);
      continue;
    }
    const globs = item.runner.evidence.map(fill);
    const files = evidenceFiles(cwd, globs, startedAt);
    const ok = run.status === 0 && files.length > 0;
    outcomes.set(item, { ok, command: line, passed: ok, files });
    evidence.push(...files.map((found) => found.path));
    if (run.status !== 0) failedOutput.push(`$ ${line}\n${run.output}`);
    else if (files.length === 0) failedOutput.push(`$ ${line}\n終了コードは 0 ですが、証拠のファイルがありません（${globs.join(', ')} に当たり、実行のあいだに書かれたもの）`);
  }

  const multi = plan.length !== targets.length || plan.some((item) => item.runner.name !== config.verify.runner);
  /** @type {string[]} */
  const lines = [];
  /** @type {FeatureResult[]} */
  const results = targets.map((feature) => {
    const runs = plan.filter((item) => item.feature === feature).map((item) => ({ item, outcome: outcomes.get(item) }));
    const oks = runs.map(({ outcome }) => outcome?.ok);
    const ok = oks.includes(false) ? false : oks.every((value) => value === true) ? true : undefined;
    const passed = runs.every(({ outcome }) => outcome?.passed === true);
    const label = ok === undefined ? (passed ? 'PASS' : 'FAIL?') : ok ? 'PASS' : 'FAIL';
    lines.push(`${label} ${feature.id}  確認手順: ${feature.file}`);
    const commands = [...new Set(runs.map(({ outcome }) => outcome?.command ?? ''))];
    /** @type {FeatureResult} */
    const result = { id: feature.id, ok, command: commands.join('\n') };
    const files = runs.flatMap(({ outcome }) => outcome?.files ?? []);
    if (runs.some(({ outcome }) => outcome?.files !== undefined)) result.files = files;
    if (multi) {
      result.runs = runs.map(({ item, outcome }) => ({
        spec: item.spec,
        runner: item.runner.name,
        ok: outcome?.ok,
        command: outcome?.command ?? '',
        ...(outcome?.files === undefined ? {} : { files: outcome.files }),
      }));
    }
    return result;
  });
  const passed = failedOutput.length === 0;
  lines.push(`証拠: ${evidence.join(', ')}`);
  if (!passed) lines.push(tail(failedOutput.join('\n')));
  writeFileSync(join(cwd, summaryFile), `${JSON.stringify({ runner: config.verify.runner, passed, features: results, evidence }, null, 2)}\n`);
  return { status: passed ? 0 : 1, lines, results, evidence };
}
