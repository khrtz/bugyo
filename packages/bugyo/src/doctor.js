import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { commandEnv, runCommand } from './run.js';
import { tr } from './locale.js';

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

/** @bugyo/lint がメッセージの頭に付ける、禁止の名前 */
const banTag = /\[bugyo:[a-z0-9-]+\]/;

/**
 * ESLint の1件の違反を、禁止の名前にする。no-restricted-* はメッセージで分ける（useEffect と useLayoutEffect を別に数えるため）。
 * no-restricted-paths は、import したパスを除いた、境界ごとのメッセージで分ける。
 * メッセージに @bugyo/lint の名前（`[bugyo:<名前>]`）があれば、そこまでで切る。後ろの説明の文が言語や言い回しで変わっても、同じ禁止として数えるため。
 *
 * @param {{ ruleId: string | null, message: string }} message
 */
export function banOf(message) {
  if (message.ruleId === null) return 'eslint: parse-error';
  const key = messageKey(message.ruleId, message.message);
  if (key === undefined) return message.ruleId.replace(warnedPrefix, '');
  const tag = banTag.exec(key.text);
  return `${key.ruleId}: ${tag === null ? key.text : key.text.slice(0, tag.index + tag[0].length)}`;
}

/**
 * 名前で数える前のベースライン（`version` のない `.bugyo/baseline.json`）と同じ数え方。名前を除いた、メッセージの文そのもので分ける。
 *
 * @param {{ ruleId: string | null, message: string }} message
 */
export function legacyBanOf(message) {
  if (message.ruleId === null) return 'eslint: 構文エラー';
  const key = messageKey(message.ruleId, message.message);
  if (key === undefined) return message.ruleId.replace(warnedPrefix, '');
  return `${key.ruleId}: ${key.text.replace(new RegExp(`${banTag.source} `), '')}`;
}

/**
 * メッセージで分けるルールなら、ルール ID と、分けるのに使うメッセージの部分を返す。
 *
 * @param {string} rawRuleId
 * @param {string} text
 * @returns {{ ruleId: string, text: string } | undefined}
 */
function messageKey(rawRuleId, text) {
  const ruleId = rawRuleId.replace(warnedPrefix, '');
  if (ruleId === 'import-x/no-restricted-paths' || ruleId === 'import/no-restricted-paths') {
    return { ruleId, text: text.replace(/^Unexpected path ".*?" imported in restricted zone\.\s*/, '') };
  }
  return combinedRules.has(ruleId) ? { ruleId, text } : undefined;
}

/** @bugyo/lint で warn に下げた禁止のルール ID の頭。下げても同じ禁止として数える */
const warnedPrefix = /^bugyo-warn\//;

/**
 * ESLint の違反を、抑制ファイルで隠れているものも含めて、禁止ごとに数える。`eslint-disable`（理由つきのコメント）で止めたものは数えない。
 *
 * 構文エラー（ルールのない違反）は、ファイルと場所とメッセージも返す。ESLint がそのファイルを読めておらず、ほかの禁止が当たっていないため。
 *
 * @param {string} cwd
 * @returns {{ counts: Map<string, number>, legacy: Map<string, number>, warned: Map<string, number>, files: Map<string, Set<string>>, parseErrors: ParseError[] } | { error: string }}
 */
export function eslintCounts(cwd) {
  const run = runTool(cwd, 'eslint', ['.', '--format', 'json']);
  let results;
  try {
    results = JSON.parse(run.stdout);
  } catch {
    return { error: `${tr({ en: `Cannot read the output of eslint . --format json (exit code ${run.status})`, ja: `eslint . --format json の出力を読めません（終了コード ${run.status}）` })}: ${run.stderr.trim().slice(0, 500)}` };
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Map<string, number>} 名前で数える前の数え方（legacyBanOf）での件数 */
  const legacy = new Map();
  /** @type {Map<string, Set<string>>} */
  const files = new Map();
  /** @type {Map<string, number>} warn に下げた禁止の件数（counts にも入っている） */
  const warned = new Map();
  /** @type {ParseError[]} */
  const parseErrors = [];
  for (const result of results) {
    const all = [
      ...(result.messages ?? []),
      ...(result.suppressedMessages ?? []).filter((/** @type {any} */ message) => (message.suppressions ?? []).every((/** @type {any} */ s) => s.kind === 'file')),
    ];
    for (const message of all) {
      const ban = banOf(message);
      counts.set(ban, (counts.get(ban) ?? 0) + 1);
      const old = legacyBanOf(message);
      legacy.set(old, (legacy.get(old) ?? 0) + 1);
      if (message.severity === 1) warned.set(ban, (warned.get(ban) ?? 0) + 1);
      files.set(ban, (files.get(ban) ?? new Set()).add(result.filePath));
      if (message.ruleId === null) {
        parseErrors.push({ file: relativePath(cwd, result.filePath), line: message.line ?? 0, message: message.message });
      }
    }
  }
  return { counts, legacy, warned, files, parseErrors };
}

/**
 * @typedef {{ file: string, line: number, message: string }} ParseError
 */

/**
 * @param {string} cwd
 * @param {string} path
 */
function relativePath(cwd, path) {
  const rel = relative(cwd, resolve(cwd, path)).replaceAll('\\', '/');
  return rel === '' || rel.startsWith('..') ? path : rel;
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
    return { error: `${tr({ en: `Cannot read the output of depcruise (exit code ${run.status})`, ja: `depcruise の出力を読めません（終了コード ${run.status}）` })}: ${run.stderr.trim().slice(0, 500)}` };
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
 * 外の lint の結果（SARIF）を、ツールとルールごとに数える（キーは `sarif: <ツール>/<ルール>`）。ファイルと行は数えない。
 * `command` があれば、`file` を消してから実行し、書かれたものを読む（終了コードは見ない。違反があると 0 でないツールが多いため）。
 * 抑制が認められた結果（`suppressions` の status が rejected でないもの）と、`kind` が fail でない結果は数えない。
 *
 * @param {string} cwd
 * @param {SarifInput[]} inputs
 * @returns {Map<string, number> | { error: string }}
 */
export function sarifCounts(cwd, inputs) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const input of inputs) {
    const path = join(cwd, input.file);
    if (input.command !== undefined) {
      rmSync(path, { force: true });
      runCommand(input.command, cwd);
    }
    if (!existsSync(path)) return {
      error: tr({
        en: `${input.file} does not exist${input.command === undefined ? '' : ` (${input.command} should write it)`}`,
        ja: `${input.file} がありません${input.command === undefined ? '' : `（${input.command} が書くはずのファイル）`}`,
      }),
    };
    /** @type {any} */
    let log;
    try {
      log = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return { error: tr({ en: `Cannot read ${input.file} as SARIF (JSON)`, ja: `${input.file} を SARIF（JSON）として読めません` }) };
    }
    for (const run of Array.isArray(log?.runs) ? log.runs : []) {
      const tool = String(run?.tool?.driver?.name ?? 'unknown');
      for (const result of Array.isArray(run?.results) ? run.results : []) {
        if (result?.kind !== undefined && result.kind !== 'fail') continue;
        if ((Array.isArray(result?.suppressions) ? result.suppressions : []).some((/** @type {any} */ s) => s?.status !== 'rejected')) continue;
        const key = `sarif: ${tool}/${String(result?.ruleId ?? result?.rule?.id ?? '?')}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * @typedef {{ command?: string | undefined, file: string }} SarifInput
 */

/**
 * 禁止ごとの件数の、ESLint と dependency-cruiser と外の lint（SARIF）をまとめたもの。キーの順にそろえる。
 *
 * @param {string} cwd
 * @param {string[]} dirs dependency-cruiser に渡すフォルダ
 * @param {SarifInput[]} [sarif] `.bugyo/config.json` の `sarif`
 * @returns {{ counts: Record<string, number>, legacy: Record<string, number>, warned: Record<string, number>, parseErrors: ParseError[], errors: string[] }}
 */
export function banCounts(cwd, dirs, sarif = []) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, number>} */
  const merged = new Map();
  /** @type {Map<string, number>} */
  const legacy = new Map();
  /** @type {Record<string, number>} */
  let warned = {};
  /** @type {ParseError[]} */
  let parseErrors = [];
  const eslint = eslintCounts(cwd);
  if ('error' in eslint) errors.push(eslint.error);
  else {
    for (const [key, value] of eslint.counts) merged.set(key, value);
    for (const [key, value] of eslint.legacy) legacy.set(key, value);
    warned = Object.fromEntries(eslint.warned);
    parseErrors = eslint.parseErrors;
  }
  const depcruise = depcruiseCounts(cwd, dirs);
  if (depcruise !== undefined) {
    if (depcruise instanceof Map) {
      for (const [key, value] of depcruise) {
        merged.set(key, value);
        legacy.set(key, value);
      }
    }
    else errors.push(depcruise.error);
  }
  if (sarif.length > 0) {
    const external = sarifCounts(cwd, sarif);
    if (external instanceof Map) {
      for (const [key, value] of external) {
        merged.set(key, value);
        legacy.set(key, value);
      }
    } else errors.push(external.error);
  }
  /** @param {Map<string, number>} map */
  const sorted = (map) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
  return { counts: sorted(merged), legacy: sorted(legacy), warned, parseErrors, errors };
}

const codeFile = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * @param {string} cwd
 * @param {string} dir
 * @returns {string[]}
 */
function filesUnder(cwd, dir) {
  if (!existsSync(join(cwd, dir))) return [];
  return readdirSync(join(cwd, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(cwd, path) : entry.isFile() ? [path] : [];
  });
}

/**
 * feature の中のフォルダを、役割（`layers.featureParts`）と照らし合わせる。
 * ui と model の禁止が当たるファイルの数と、どの役割にも入っていないフォルダを返す。
 * 当たるファイルが0件なら、フォルダ名が役割と合っておらず、その禁止が何にも効いていない。
 *
 * @param {string} cwd
 * @param {string} featuresDir
 * @param {{ ui: string[], api: string[], model: string[] }} parts
 * @returns {{ features: number, ui: number, model: number, unassigned: string[] } | undefined} 機能のフォルダがなければ undefined
 */
export function featurePartsReport(cwd, featuresDir, parts) {
  if (!existsSync(join(cwd, featuresDir))) return undefined;
  const roles = new Set([...parts.ui, ...parts.api, ...parts.model]);
  let features = 0;
  let ui = 0;
  let model = 0;
  /** @type {string[]} */
  const unassigned = [];
  for (const feature of readdirSync(join(cwd, featuresDir), { withFileTypes: true })) {
    if (!feature.isDirectory() || feature.name.startsWith('.')) continue;
    features += 1;
    for (const entry of readdirSync(join(cwd, featuresDir, feature.name), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = `${featuresDir}/${feature.name}/${entry.name}`;
      if (!roles.has(entry.name)) {
        unassigned.push(path);
        continue;
      }
      const files = filesUnder(cwd, path);
      if (parts.ui.includes(entry.name)) ui += files.filter((file) => /\.tsx?$/.test(file)).length;
      if (parts.model.includes(entry.name)) model += files.filter((file) => /\.ts$/.test(file)).length;
    }
  }
  return { features, ui, model, unassigned: unassigned.sort() };
}

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
 * ベースラインの形式。2 は禁止の名前（`[bugyo:<名前>]`）で数える。`version` のないものは、名前で数える前のもの（メッセージの文で数える）。
 */
export const baselineVersion = 2;

/**
 * @param {string} cwd
 * @returns {{ version: number, counts: Record<string, number> } | undefined}
 */
export function readBaseline(cwd) {
  const path = join(cwd, baselineFile);
  if (!existsSync(path)) return undefined;
  return parseBaseline(readFileSync(path, 'utf8'));
}

/**
 * @param {string | undefined} text
 * @returns {{ version: number, counts: Record<string, number> }}
 */
function parseBaseline(text) {
  if (text === undefined) return { version: baselineVersion, counts: {} };
  const parsed = JSON.parse(text);
  return { version: typeof parsed.version === 'number' ? parsed.version : 1, counts: parsed.counts ?? {} };
}

/**
 * 今の違反をすべてベースラインにする。ESLint の抑制ファイル、dependency-cruiser の既知の違反、禁止ごとの件数を書き直す。
 *
 * @param {string} cwd
 * @param {string[]} dirs
 * @param {SarifInput[]} [sarif]
 */
export function saveBaseline(cwd, dirs, sarif = []) {
  rmSync(join(cwd, eslintSuppressionsFile), { force: true });
  const suppress = runTool(cwd, 'eslint', ['.', '--suppress-all']);
  if (suppress.status === 2) throw new Error(`${tr({ en: 'eslint . --suppress-all failed', ja: 'eslint . --suppress-all が失敗しました' })}: ${`${suppress.stdout}${suppress.stderr}`.trim().slice(0, 500)}`);
  const config = depcruiseConfig(cwd);
  if (config !== undefined && dirs.length > 0) {
    rmSync(join(cwd, depcruiseKnownFile), { force: true });
    const known = runTool(cwd, 'depcruise', [...dirs, '--config', config, '--baseline', depcruiseKnownFile]);
    if (!existsSync(join(cwd, depcruiseKnownFile))) throw new Error(`${tr({ en: `Could not write the known depcruise violations (exit code ${known.status})`, ja: `depcruise の既知の違反を書けませんでした（終了コード ${known.status}）` })}: ${known.stderr.trim().slice(0, 500)}`);
  }
  const { counts, errors } = banCounts(cwd, dirs, sarif);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  mkdirSync(dirname(join(cwd, baselineFile)), { recursive: true });
  writeFileSync(join(cwd, baselineFile), `${JSON.stringify({ version: baselineVersion, counts }, null, 2)}\n`);
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
 * 禁止ごとの件数を、ルールごとの件数にまとめる（dependency-cruiser はもともとルールごと）。形式の違うベースラインどうしを比べるときに使う。
 *
 * @param {Record<string, number>} counts
 */
function byRule(counts) {
  /** @type {Record<string, number>} */
  const rules = {};
  for (const [key, count] of Object.entries(counts)) {
    const rule = key.startsWith('depcruise: ') ? key : (key.split(': ')[0] ?? key);
    rules[rule] = (rules[rule] ?? 0) + count;
  }
  return rules;
}

/**
 * ベースラインのファイル（禁止ごとの件数、ESLint の抑制、dependency-cruiser の既知の違反）が `base` より増えたところを返す。
 * 禁止ごとの件数の形式が `base` より新しければ（名前で数える前のものから作り直したとき）、ルールごとの件数で比べる。`base` より古い形式に戻したものは、増えたことにする。
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
  const before = parseBaseline(atBase(baselineFile));
  const after = parseBaseline(now(baselineFile));
  if (after.version < before.version) {
    grown.push(
      `${baselineFile}: ${tr({
        en: `the format went back from ${before.version} in ${base} to ${after.version} (the old format cannot find swaps within the same rule). Recreate it with bugyo baseline save`,
        ja: `形式が ${base} の ${before.version} から ${after.version} に戻っています（古い形式では、同じルールの中の入れ替えを見つけられません）。bugyo baseline save で作り直してください`,
      })}`,
    );
  }
  const sameVersion = before.version === after.version;
  const bans = compareCounts(sameVersion ? before.counts : byRule(before.counts), sameVersion ? after.counts : byRule(after.counts));
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
