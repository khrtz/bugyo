import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { commandEnv } from './run.js';

/** bugyo が禁止ごとに数えるファイル。禁止ごとの件数を持ち、件数が変わったら baseline save で書き直す */
export const baselineFile = '.bugyo/baseline.json';
/** ESLint の抑制ファイル（ESLint の既定の場所） */
export const eslintSuppressionsFile = 'eslint-suppressions.json';
/** dependency-cruiser の既知の違反のファイル（dependency-cruiser の既定の場所） */
export const depcruiseKnownFile = '.dependency-cruiser-known-violations.json';

const depcruiseConfigs = ['.dependency-cruiser.cjs', '.dependency-cruiser.js', '.dependency-cruiser.mjs', '.dependency-cruiser.json'];
/** 複数の禁止を1つのルールにまとめるルール。これらはメッセージごとに別の禁止として数える */
const combinedRules = new Set(['no-restricted-imports', 'no-restricted-globals', 'no-restricted-syntax', 'no-restricted-properties']);

/**
 * @param {string} cwd
 * @param {string} command
 * @param {string[]} args
 */
function runTool(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    env: commandEnv(cwd),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}${result.error ? result.error.message : ''}` };
}

/**
 * ESLint の1件の違反を、禁止の名前にする。no-restricted-* はメッセージで分ける（useEffect と useLayoutEffect を別に数えるため）。
 *
 * @param {{ ruleId: string | null, message: string }} message
 */
export function banOf(message) {
  if (message.ruleId === null) return 'eslint: 構文エラー';
  const ruleId = message.ruleId.replace(warnedPrefix, '');
  return combinedRules.has(ruleId) ? `${ruleId}: ${message.message}` : ruleId;
}

/** @bugyo/lint で warn に下げた禁止のルール ID の頭。下げても同じ禁止として数える */
const warnedPrefix = /^bugyo-warn\//;

/**
 * ESLint の違反を、抑制ファイルで隠れているものも含めて、禁止ごとに数える。`eslint-disable`（理由つきのコメント）で止めたものは数えない。
 *
 * @param {string} cwd
 * @returns {{ counts: Map<string, number>, warned: Map<string, number>, files: Map<string, Set<string>> } | { error: string }}
 */
export function eslintCounts(cwd) {
  const run = runTool(cwd, 'eslint', ['.', '--format', 'json']);
  let results;
  try {
    results = JSON.parse(run.stdout);
  } catch {
    return { error: `eslint . --format json の出力を読めません（終了コード ${run.status}）: ${run.stderr.trim().slice(0, 500)}` };
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Map<string, Set<string>>} */
  const files = new Map();
  /** @type {Map<string, number>} warn に下げた禁止の件数（counts にも入っている） */
  const warned = new Map();
  for (const result of results) {
    const all = [
      ...(result.messages ?? []),
      ...(result.suppressedMessages ?? []).filter((/** @type {any} */ message) => (message.suppressions ?? []).every((/** @type {any} */ s) => s.kind === 'file')),
    ];
    for (const message of all) {
      const ban = banOf(message);
      counts.set(ban, (counts.get(ban) ?? 0) + 1);
      if (message.severity === 1) warned.set(ban, (warned.get(ban) ?? 0) + 1);
      files.set(ban, (files.get(ban) ?? new Set()).add(result.filePath));
    }
  }
  return { counts, warned, files };
}

/** @param {string} cwd */
export function depcruiseConfig(cwd) {
  return depcruiseConfigs.find((file) => existsSync(join(cwd, file)));
}

/**
 * dependency-cruiser の違反を、既知の違反のファイルで隠れているものも含めて、ルールごとに数える。設定ファイルがなければ undefined。
 *
 * @param {string} cwd
 * @param {string[]} dirs
 * @returns {Map<string, number> | { error: string } | undefined}
 */
export function depcruiseCounts(cwd, dirs) {
  const config = depcruiseConfig(cwd);
  if (config === undefined || dirs.length === 0) return undefined;
  const run = runTool(cwd, 'depcruise', [...dirs, '--config', config, '--no-ignore-known', '--output-type', 'json']);
  try {
    const report = JSON.parse(run.stdout);
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const violation of report.summary?.violations ?? []) {
      const key = `depcruise: ${violation.rule?.name ?? '?'}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  } catch {
    return { error: `depcruise の出力を読めません（終了コード ${run.status}）: ${run.stderr.trim().slice(0, 500)}` };
  }
}

/**
 * tsconfig を当てたときの tsc のエラーの件数。
 *
 * @param {string} cwd
 * @param {string} tsconfig
 */
export function tscErrors(cwd, tsconfig) {
  const run = runTool(cwd, 'tsc', ['--noEmit', '-p', tsconfig, '--pretty', 'false']);
  return [...`${run.stdout}${run.stderr}`.matchAll(/error TS\d+/g)].length;
}

/**
 * 禁止ごとの件数の、ESLint と dependency-cruiser をまとめたもの。キーの順にそろえる。
 *
 * @param {string} cwd
 * @param {string[]} dirs dependency-cruiser に渡すフォルダ
 * @returns {{ counts: Record<string, number>, warned: Record<string, number>, errors: string[] }}
 */
export function banCounts(cwd, dirs) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, number>} */
  const merged = new Map();
  /** @type {Record<string, number>} */
  let warned = {};
  const eslint = eslintCounts(cwd);
  if ('error' in eslint) errors.push(eslint.error);
  else {
    for (const [key, value] of eslint.counts) merged.set(key, value);
    warned = Object.fromEntries(eslint.warned);
  }
  const depcruise = depcruiseCounts(cwd, dirs);
  if (depcruise !== undefined) {
    if (depcruise instanceof Map) for (const [key, value] of depcruise) merged.set(key, value);
    else errors.push(depcruise.error);
  }
  return { counts: Object.fromEntries([...merged].sort(([a], [b]) => a.localeCompare(b))), warned, errors };
}

const codeFile = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * 層のフォルダをまとめたフォルダ（`web` など）の中で、どの層にも入っていないコードのファイル。
 * ここにあるファイルには、層の境界のルールが当たらない。
 *
 * @param {string} cwd
 * @param {string[]} layers 層のフォルダ（プロジェクトのルートからの相対パス）
 * @param {string} root 層のフォルダをまとめたフォルダ
 */
export function filesOutsideLayers(cwd, layers, root) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = (dir) => {
    if (!existsSync(join(cwd, dir))) return;
    for (const entry of readdirSync(join(cwd, dir), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
      if (layers.includes(path)) continue;
      if (entry.isDirectory()) walk(path);
      else if (codeFile.test(entry.name)) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

/**
 * @param {string} cwd
 * @returns {Record<string, number> | undefined}
 */
export function readBaseline(cwd) {
  const path = join(cwd, baselineFile);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')).counts ?? {};
}

/**
 * 今の違反をすべてベースラインにする。ESLint の抑制ファイル、dependency-cruiser の既知の違反、禁止ごとの件数を書き直す。
 *
 * @param {string} cwd
 * @param {string[]} dirs
 */
export function saveBaseline(cwd, dirs) {
  rmSync(join(cwd, eslintSuppressionsFile), { force: true });
  const suppress = runTool(cwd, 'eslint', ['.', '--suppress-all']);
  if (suppress.status === 2) throw new Error(`eslint . --suppress-all が失敗しました: ${`${suppress.stdout}${suppress.stderr}`.trim().slice(0, 500)}`);
  const config = depcruiseConfig(cwd);
  if (config !== undefined && dirs.length > 0) {
    rmSync(join(cwd, depcruiseKnownFile), { force: true });
    const known = runTool(cwd, 'depcruise', [...dirs, '--config', config, '--baseline', depcruiseKnownFile]);
    if (!existsSync(join(cwd, depcruiseKnownFile))) throw new Error(`depcruise の既知の違反を書けませんでした（終了コード ${known.status}）: ${known.stderr.trim().slice(0, 500)}`);
  }
  const { counts, errors } = banCounts(cwd, dirs);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  mkdirSync(dirname(join(cwd, baselineFile)), { recursive: true });
  writeFileSync(join(cwd, baselineFile), `${JSON.stringify({ counts }, null, 2)}\n`);
  return counts;
}

/**
 * 今の件数をベースラインと比べる。増えた禁止と減った禁止を返す。
 *
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} current
 */
export function compareCounts(baseline, current) {
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort();
  const grew = keys.filter((key) => (current[key] ?? 0) > (baseline[key] ?? 0)).map((key) => ({ key, from: baseline[key] ?? 0, to: current[key] ?? 0 }));
  const shrank = keys.filter((key) => (current[key] ?? 0) < (baseline[key] ?? 0)).map((key) => ({ key, from: baseline[key] ?? 0, to: current[key] ?? 0 }));
  return { grew, shrank };
}

/**
 * ベースラインのファイル（禁止ごとの件数、ESLint の抑制、dependency-cruiser の既知の違反）が `base` より増えたところを返す。
 *
 * @param {string} cwd
 * @param {string} base
 * @returns {string[]}
 */
export function baselineGrowth(cwd, base) {
  /** @param {string} file */
  const atBase = (file) => {
    const run = spawnSync('git', ['show', `${base}:./${file}`], { cwd, encoding: 'utf8' });
    return run.status === 0 ? run.stdout : undefined;
  };
  /** @param {string} file */
  const now = (file) => (existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), 'utf8') : undefined);
  /** @type {string[]} */
  const grown = [];

  const parse = (/** @type {string | undefined} */ text) => (text === undefined ? {} : JSON.parse(text));
  const bans = compareCounts(parse(atBase(baselineFile)).counts ?? {}, parse(now(baselineFile)).counts ?? {});
  grown.push(...bans.grew.map(({ key, from, to }) => `${baselineFile}: ${key} ${from} → ${to}`));

  /** @param {Record<string, Record<string, { count: number }>>} suppressions */
  const flatten = (suppressions) =>
    Object.fromEntries(Object.entries(suppressions).flatMap(([file, rules]) => Object.entries(rules).map(([rule, value]) => [`${file} ${rule}`, value.count])));
  const eslint = compareCounts(flatten(parse(atBase(eslintSuppressionsFile))), flatten(parse(now(eslintSuppressionsFile))));
  grown.push(...eslint.grew.map(({ key, from, to }) => `${eslintSuppressionsFile}: ${key} ${from} → ${to}`));

  /** @param {unknown} known */
  const knownCounts = (known) => {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const violation of Array.isArray(known) ? known : []) {
      const key = `${violation.rule?.name ?? '?'} ${violation.from ?? ''} → ${violation.to ?? ''}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };
  const depcruise = compareCounts(knownCounts(parse(atBase(depcruiseKnownFile))), knownCounts(parse(now(depcruiseKnownFile))));
  grown.push(...depcruise.grew.map(({ key, from, to }) => `${depcruiseKnownFile}: ${key} ${from} → ${to}`));
  return grown;
}
