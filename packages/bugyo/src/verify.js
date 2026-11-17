import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadConfig } from './config.js';
import { loadFeatures } from './feature-map.js';
import { runCommand, tail } from './run.js';

const artifactsDir = 'artifacts';
const reportFile = `${artifactsDir}/results.json`;
/** verify が最後に書く、機能ごとの合否と証拠の場所の要約。task done が証拠に写す */
export const summaryFile = `${artifactsDir}/verify.json`;

/**
 * @param {string} cwd
 * @param {string[]} specs
 */
function runPlaywright(cwd, specs) {
  return spawnSync('pnpm', ['exec', 'playwright', 'test', ...specs, '--reporter=line,json,html'], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
      PLAYWRIGHT_HTML_OUTPUT_DIR: `${artifactsDir}/report`,
      PLAYWRIGHT_HTML_OPEN: 'never',
    },
  });
}

/**
 * Playwright の JSON レポートから、spec ファイル（cwd からの相対パス）ごとの合否を読む。
 *
 * @param {string} cwd
 * @returns {Map<string, boolean>}
 */
function resultsBySpec(cwd) {
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
 * @typedef {{ id: string, ok: boolean | undefined }} FeatureResult
 * @typedef {{ status: 0 | 1 | 2, lines: string[], results: FeatureResult[], evidence: string[] }} VerifyOutcome
 * @typedef {{ passed: boolean, output: string, results: FeatureResult[], evidence: string[] }} RunnerOutcome
 */

/**
 * @param {string} cwd
 * @param {import('./index.js').Feature[]} targets
 * @returns {RunnerOutcome}
 */
function viaPlaywright(cwd, targets) {
  const result = runPlaywright(
    cwd,
    targets.map((feature) => feature.spec),
  );
  const passed = result.status === 0;
  const bySpec = resultsBySpec(cwd);
  return {
    passed,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    results: targets.map((feature) => ({ id: feature.id, ok: bySpec.get(feature.spec) })),
    evidence: [`${artifactsDir}/test-results（動画・スクリーンショット・トレース）`, `${artifactsDir}/report/index.html`],
  };
}

/**
 * @param {string} cwd
 * @param {string} command
 * @param {import('./index.js').Feature[]} targets
 * @returns {RunnerOutcome}
 */
function viaCommand(cwd, command, targets) {
  mkdirSync(join(cwd, artifactsDir, 'verify'), { recursive: true });
  const failedOutput = [];
  const results = [];
  const evidence = [];
  for (const feature of targets) {
    const line = command.replaceAll('{id}', feature.id).replaceAll('{spec}', feature.spec);
    const run = runCommand(line, cwd);
    const log = `${artifactsDir}/verify/${feature.id}.log`;
    writeFileSync(join(cwd, log), `$ ${line}\n${run.output}`);
    results.push({ id: feature.id, ok: run.status === 0 });
    evidence.push(log);
    if (run.status !== 0) failedOutput.push(`$ ${line}\n${run.output}`);
  }
  return { passed: failedOutput.length === 0, output: failedOutput.join('\n'), results, evidence };
}

/**
 * 機能を実際に動かし、機能ごとの合否と証拠の場所を返す。表示は lines をそのまま出す。
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
  rmSync(join(cwd, artifactsDir), { recursive: true, force: true });
  const outcome =
    config.verify.runner === 'command' ? viaCommand(cwd, config.verify.command ?? '', targets) : viaPlaywright(cwd, targets);
  const lines = targets.map((feature, index) => {
    const ok = outcome.results[index]?.ok;
    const label = ok === undefined ? (outcome.passed ? 'PASS' : 'FAIL?') : ok ? 'PASS' : 'FAIL';
    return `${label} ${feature.id}  確認手順: ${feature.file}`;
  });
  lines.push(`証拠: ${outcome.evidence.join(', ')}`);
  if (!outcome.passed) lines.push(tail(outcome.output));
  mkdirSync(join(cwd, artifactsDir), { recursive: true });
  writeFileSync(
    join(cwd, summaryFile),
    `${JSON.stringify({ runner: config.verify.runner, passed: outcome.passed, features: outcome.results, evidence: outcome.evidence }, null, 2)}\n`,
  );
  return { status: outcome.passed ? 0 : 1, lines, results: outcome.results, evidence: outcome.evidence };
}
