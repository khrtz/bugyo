import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { commonDir, dirsOfLayers, featureRoots, loadConfig, sourcesOf } from './config.js';
import {
  baselineFile,
  baselineGrowth,
  banCounts,
  compareCounts,
  depcruiseConfig,
  depcruiseKnownFile,
  eslintSuppressionsFile,
  featurePartsReport,
  filesOutsideLayers,
  readBaseline,
  saveBaseline,
  tscErrors,
} from './doctor.js';
import { UsageError } from './task-cli.js';

export const doctorUsage = `  bugyo doctor [--dirs <a,b>] [--tsconfig <path>]  何も変えずに、禁止ごとの違反の件数と、どの層にも入っていないファイルを出す（入れる前の見積もり）
  bugyo baseline save [--dirs <a,b>]  今の違反をすべてベースラインにする（ESLint の抑制・dependency-cruiser の既知の違反・禁止ごとの件数）
  bugyo baseline check [--dirs <a,b>] 禁止ごとの件数がベースラインと同じか確かめる（pnpm check に入れる）
  bugyo baseline diff --base <ref>    ベースラインのファイルが <ref> より増えていないか確かめる（CI 用）`;

/** @param {string[]} args */
function parse(args) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: { dirs: { type: 'string' }, tsconfig: { type: 'string' }, base: { type: 'string' }, json: { type: 'boolean' } },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * dependency-cruiser に渡すフォルダ。指定がなければ、layers の層をまとめたフォルダ、layers がなければ src（なければ渡さない）。
 *
 * @param {string} cwd
 * @param {string | undefined} option
 */
function dirsOf(cwd, option) {
  if (option !== undefined) return option.split(',').map((dir) => dir.trim()).filter((dir) => dir !== '');
  return sourceRoots(loadConfig(cwd)).filter((root) => existsSync(join(cwd, root)));
}

/**
 * ソースごとの、層のフォルダをまとめたフォルダ。layers も sources もなければ src。
 *
 * @param {import('./index.js').BugyoConfig} config
 */
function sourceRoots(config) {
  return sourcesOf(config).map((source) => (source.custom ? commonDir(dirsOfLayers(source.layers)) : 'src'));
}

/** @param {Record<string, number>} counts */
const countLines = (counts) =>
  Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => `  ${String(count).padStart(5)}  ${key}`);

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
export function doctorCommand(args, cwd = process.cwd()) {
  const { values } = parse(args);
  const dirs = dirsOf(cwd, values.dirs);
  const { counts, warned, parseErrors, errors } = banCounts(cwd, dirs);
  const tsc = values.tsconfig === undefined ? undefined : tscErrors(cwd, values.tsconfig);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const config = loadConfig(cwd);
  const sources = sourcesOf(config);
  const outside = sources.some((source) => source.custom)
    ? sources.flatMap((source) => filesOutsideLayers(cwd, dirsOfLayers(source.layers), commonDir(dirsOfLayers(source.layers)))).sort()
    : undefined;
  const reports = featureRoots(config).flatMap(({ featuresDir, parts: roles }) => {
    const report = featurePartsReport(cwd, featuresDir, roles);
    return report === undefined ? [] : [{ roles, report }];
  });
  const parts =
    reports.length === 0
      ? undefined
      : {
          features: reports.reduce((sum, { report }) => sum + report.features, 0),
          ui: reports.reduce((sum, { report }) => sum + report.ui, 0),
          model: reports.reduce((sum, { report }) => sum + report.model, 0),
          unassigned: reports.flatMap(({ report }) => report.unassigned).sort(),
        };
  if (values.json) {
    console.log(JSON.stringify({ total, counts, warned, parseErrors, tsc, outsideLayers: outside, featureParts: parts, errors }));
  } else {
    console.log(`doctor: 違反 ${total}件（禁止ごと、多い順。ESLint の抑制ファイルで隠れているものも数える）`);
    for (const line of countLines(counts)) console.log(line);
    const warnedTotal = Object.values(warned).reduce((sum, count) => sum + count, 0);
    if (warnedTotal > 0) {
      console.log(`うち warn に下げた禁止 ${warnedTotal}件（lint は通るが、直す借りとして残っている）`);
      for (const line of countLines(warned)) console.log(line);
    }
    if (depcruiseConfig(cwd) === undefined) console.log('  dependency-cruiser の設定がないので、依存の違反は数えていません');
    if (tsc !== undefined) console.log(`tsc（${values.tsconfig}）: エラー ${tsc}件`);
    if (outside !== undefined) {
      console.log(`どの層にも入っていないファイル ${outside.length}件（層の境界のルールが当たりません）`);
      for (const path of outside.slice(0, 20)) console.log(`  ${path}`);
      if (outside.length > 20) console.log(`  ほか ${outside.length - 20}件（--json ですべて出ます）`);
    }
    if (parseErrors.length > 0) {
      console.log(`構文エラー ${parseErrors.length}件（ESLint がこのファイルを読めず、ほかの禁止も当たっていません。パーサーか files の設定を確かめてください）`);
      for (const { file, line, message } of parseErrors.slice(0, 20)) console.log(`  ${file}:${line}  ${message}`);
      if (parseErrors.length > 20) console.log(`  ほか ${parseErrors.length - 20}件（--json ですべて出ます）`);
    }
    if (parts !== undefined && parts.features > 0) {
      const names = (/** @type {'ui' | 'model'} */ role) => [...new Set(reports.flatMap(({ roles }) => roles[role]))].join('・');
      console.log(`feature の中: ui の禁止が当たるファイル ${parts.ui}件（${names('ui')}）、model の禁止が当たるファイル ${parts.model}件（${names('model')}）`);
      const hint = parts.unassigned.length > 0;
      if (hint && parts.ui === 0) console.log('  ui の禁止が何にも当たっていません。下のフォルダが ui なら、layers.featureParts.ui に名前を書いてください');
      if (hint && parts.model === 0) console.log('  model の禁止が何にも当たっていません。下のフォルダが model なら、layers.featureParts.model に名前を書いてください');
      if (parts.unassigned.length > 0) {
        console.log(`どの役割（layers.featureParts）にも入っていないフォルダ ${parts.unassigned.length}件（ui・model の禁止が当たりません）`);
        for (const path of parts.unassigned.slice(0, 20)) console.log(`  ${path}`);
        if (parts.unassigned.length > 20) console.log(`  ほか ${parts.unassigned.length - 20}件（--json ですべて出ます）`);
      }
    }
    for (const error of errors) console.error(`error ${error}`);
  }
  return errors.length > 0 ? 1 : 0;
}

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
export function baselineCommand(args, cwd = process.cwd()) {
  const [sub, ...rest] = args;
  const { values } = parse(rest);
  const dirs = dirsOf(cwd, values.dirs);
  switch (sub) {
    case 'save': {
      const counts = saveBaseline(cwd, dirs);
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      console.log(`baseline: ${total}件をベースラインにしました（${baselineFile}）`);
      return 0;
    }
    case 'check': {
      const baseline = readBaseline(cwd);
      if (baseline === undefined) {
        const orphans = [eslintSuppressionsFile, depcruiseKnownFile].filter((file) => existsSync(join(cwd, file)));
        if (orphans.length > 0) {
          console.error(`error ${orphans.join(' と ')} があるのに ${baselineFile} がありません。抑制した違反の入れ替えを見つけられないので、bugyo baseline save で作り直してください`);
          return 1;
        }
        console.log(`baseline: ${baselineFile} がないので、確かめるものはありません`);
        return 0;
      }
      const { counts, errors } = banCounts(cwd, dirs);
      if (errors.length > 0) {
        for (const error of errors) console.error(`error ${error}`);
        return 1;
      }
      const { grew, shrank } = compareCounts(baseline, counts);
      for (const { key, from, to } of grew) console.error(`error 増えた: ${key} ${from} → ${to}。ベースラインに足さず、直してください`);
      for (const { key, from, to } of shrank) console.error(`error 減った: ${key} ${from} → ${to}。bugyo baseline save でベースラインを縮めてください`);
      const ok = grew.length === 0 && shrank.length === 0;
      (ok ? console.log : console.error)(`baseline: 増えた禁止 ${grew.length}件、減った禁止 ${shrank.length}件`);
      return ok ? 0 : 1;
    }
    case 'diff': {
      if (values.base === undefined) throw new UsageError('使い方: bugyo baseline diff --base <ref>');
      const grown = baselineGrowth(cwd, values.base);
      for (const line of grown) console.error(`error 増えた: ${line}`);
      if (grown.length > 0) {
        console.error(`baseline: ${values.base} よりベースラインが ${grown.length}か所増えています。増やすのは人が確かめてからです（CI ではラベル bugyo-baseline-approved）`);
        return 1;
      }
      console.log(`baseline: ${values.base} より増えたところはありません`);
      return 0;
    }
    default:
      throw new UsageError('bugyo baseline のサブコマンドは save / check / diff です');
  }
}
