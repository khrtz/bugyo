import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { commonDir, dirsOfLayers, featureRoots, loadConfig, sourcesOf } from './config.js';
import {
  baselineFile,
  baselineGrowth,
  baselineVersion,
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
import { tr } from './locale.js';
import { UsageError } from './task-cli.js';

/** @returns {string} */
export const doctorUsage = () =>
  tr({
    en: `  bugyo doctor [--dirs <a,b>] [--tsconfig <path>]  change nothing; print violations per ban and files outside every layer (an estimate before adopting)
  bugyo baseline save [--dirs <a,b>]  record every current violation as the baseline (ESLint suppressions, known dependency-cruiser violations, counts per ban)
  bugyo baseline check [--dirs <a,b>] check that the count per ban equals the baseline (put it in pnpm check)
  bugyo baseline diff --base <ref>    check that the baseline files did not grow since <ref> (for CI)`,
    ja: `  bugyo doctor [--dirs <a,b>] [--tsconfig <path>]  何も変えずに、禁止ごとの違反の件数と、どの層にも入っていないファイルを出す（入れる前の見積もり）
  bugyo baseline save [--dirs <a,b>]  今の違反をすべてベースラインにする（ESLint の抑制・dependency-cruiser の既知の違反・禁止ごとの件数）
  bugyo baseline check [--dirs <a,b>] 禁止ごとの件数がベースラインと同じか確かめる（pnpm check に入れる）
  bugyo baseline diff --base <ref>    ベースラインのファイルが <ref> より増えていないか確かめる（CI 用）`,
  });

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
 * sources があれば、ソースごとの層をまとめたフォルダ。ただし tsconfig を書いたソースは渡さない（ルートの設定はルートの tsconfig で import を解決するため）。
 *
 * @param {string} cwd
 * @param {string | undefined} option
 */
function dirsOf(cwd, option) {
  if (option !== undefined) return option.split(',').map((dir) => dir.trim()).filter((dir) => dir !== '');
  return sourcesOf(loadConfig(cwd))
    .filter((source) => source.tsconfig === undefined)
    .map((source) => (source.custom ? commonDir(dirsOfLayers(source.layers)) : 'src'))
    .filter((root) => existsSync(join(cwd, root)));
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
  const { counts, warned, parseErrors, errors } = banCounts(cwd, dirs, loadConfig(cwd).sarif ?? []);
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
    console.log(tr({ en: `doctor: ${total} violations (per ban, most first; includes those hidden by the ESLint suppressions file)`, ja: `doctor: 違反 ${total}件（禁止ごと、多い順。ESLint の抑制ファイルで隠れているものも数える）` }));
    for (const line of countLines(counts)) console.log(line);
    const warnedTotal = Object.values(warned).reduce((sum, count) => sum + count, 0);
    if (warnedTotal > 0) {
      console.log(tr({ en: `of which ${warnedTotal} come from bans lowered to warn (lint passes, but they are debt to fix)`, ja: `うち warn に下げた禁止 ${warnedTotal}件（lint は通るが、直す借りとして残っている）` }));
      for (const line of countLines(warned)) console.log(line);
    }
    if (depcruiseConfig(cwd) === undefined) console.log(tr({ en: '  no dependency-cruiser config, so dependency violations are not counted', ja: '  dependency-cruiser の設定がないので、依存の違反は数えていません' }));
    if (tsc !== undefined) console.log(tr({ en: `tsc (${values.tsconfig}): ${tsc} errors`, ja: `tsc（${values.tsconfig}）: エラー ${tsc}件` }));
    if (outside !== undefined) {
      console.log(tr({ en: `${outside.length} files outside every layer (the layer boundary rules do not apply to them)`, ja: `どの層にも入っていないファイル ${outside.length}件（層の境界のルールが当たりません）` }));
      for (const path of outside.slice(0, 20)) console.log(`  ${path}`);
      if (outside.length > 20) console.log(tr({ en: `  ${outside.length - 20} more (--json prints all)`, ja: `  ほか ${outside.length - 20}件（--json ですべて出ます）` }));
    }
    if (parseErrors.length > 0) {
      console.log(
        tr({
          en: `${parseErrors.length} parse errors (ESLint cannot read these files, so no other ban applies to them; check the parser or the files setting)`,
          ja: `構文エラー ${parseErrors.length}件（ESLint がこのファイルを読めず、ほかの禁止も当たっていません。パーサーか files の設定を確かめてください）`,
        }),
      );
      for (const { file, line, message } of parseErrors.slice(0, 20)) console.log(`  ${file}:${line}  ${message}`);
      if (parseErrors.length > 20) console.log(tr({ en: `  ${parseErrors.length - 20} more (--json prints all)`, ja: `  ほか ${parseErrors.length - 20}件（--json ですべて出ます）` }));
    }
    if (parts !== undefined && parts.features > 0) {
      const names = (/** @type {'ui' | 'model'} */ role) => [...new Set(reports.flatMap(({ roles }) => roles[role]))].join(tr({ en: ', ', ja: '・' }));
      console.log(
        tr({
          en: `inside features: ${parts.ui} files get the ui bans (${names('ui')}), ${parts.model} files get the model bans (${names('model')})`,
          ja: `feature の中: ui の禁止が当たるファイル ${parts.ui}件（${names('ui')}）、model の禁止が当たるファイル ${parts.model}件（${names('model')}）`,
        }),
      );
      const hint = parts.unassigned.length > 0;
      if (hint && parts.ui === 0) console.log(tr({ en: '  the ui bans apply to nothing. If a folder below is ui, add its name to layers.featureParts.ui', ja: '  ui の禁止が何にも当たっていません。下のフォルダが ui なら、layers.featureParts.ui に名前を書いてください' }));
      if (hint && parts.model === 0) console.log(tr({ en: '  the model bans apply to nothing. If a folder below is model, add its name to layers.featureParts.model', ja: '  model の禁止が何にも当たっていません。下のフォルダが model なら、layers.featureParts.model に名前を書いてください' }));
      if (parts.unassigned.length > 0) {
        console.log(
          tr({
            en: `${parts.unassigned.length} folders without a role in layers.featureParts (the ui and model bans do not apply to them)`,
            ja: `どの役割（layers.featureParts）にも入っていないフォルダ ${parts.unassigned.length}件（ui・model の禁止が当たりません）`,
          }),
        );
        for (const path of parts.unassigned.slice(0, 20)) console.log(`  ${path}`);
        if (parts.unassigned.length > 20) console.log(tr({ en: `  ${parts.unassigned.length - 20} more (--json prints all)`, ja: `  ほか ${parts.unassigned.length - 20}件（--json ですべて出ます）` }));
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
      const counts = saveBaseline(cwd, dirs, loadConfig(cwd).sarif ?? []);
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      console.log(tr({ en: `baseline: recorded ${total} violations as the baseline (${baselineFile})`, ja: `baseline: ${total}件をベースラインにしました（${baselineFile}）` }));
      return 0;
    }
    case 'check': {
      const baseline = readBaseline(cwd);
      if (baseline === undefined) {
        const orphans = [eslintSuppressionsFile, depcruiseKnownFile].filter((file) => existsSync(join(cwd, file)));
        if (orphans.length > 0) {
          console.error(
            `error ${tr({
              en: `${orphans.join(' and ')} exist, but ${baselineFile} does not. Swapped suppressed violations cannot be found, so recreate it with bugyo baseline save`,
              ja: `${orphans.join(' と ')} があるのに ${baselineFile} がありません。抑制した違反の入れ替えを見つけられないので、bugyo baseline save で作り直してください`,
            })}`,
          );
          return 1;
        }
        console.log(tr({ en: `baseline: there is no ${baselineFile}, so there is nothing to check`, ja: `baseline: ${baselineFile} がないので、確かめるものはありません` }));
        return 0;
      }
      const { counts, legacy, errors } = banCounts(cwd, dirs, loadConfig(cwd).sarif ?? []);
      if (errors.length > 0) {
        for (const error of errors) console.error(`error ${error}`);
        return 1;
      }
      const current = baseline.version === baselineVersion ? counts : legacy;
      if (baseline.version !== baselineVersion) {
        console.log(
          tr({
            en: `baseline: ${baselineFile} uses the format from before counting by ban name, so it is compared the old way. Recreate it with bugyo baseline save to count the same ban even when the message language or wording changes`,
            ja: `baseline: ${baselineFile} は禁止の名前で数える前の形式です。今までの数え方で比べます。bugyo baseline save で作り直すと、メッセージの言語や言い回しが変わっても同じ禁止として数えます`,
          }),
        );
      }
      const { grew, shrank } = compareCounts(baseline.counts, current);
      for (const { key, from, to } of grew) console.error(`error ${tr({ en: `grew: ${key} ${from} → ${to}. Fix it instead of adding it to the baseline`, ja: `増えた: ${key} ${from} → ${to}。ベースラインに足さず、直してください` })}`);
      for (const { key, from, to } of shrank) console.error(`error ${tr({ en: `shrank: ${key} ${from} → ${to}. Shrink the baseline with bugyo baseline save`, ja: `減った: ${key} ${from} → ${to}。bugyo baseline save でベースラインを縮めてください` })}`);
      const ok = grew.length === 0 && shrank.length === 0;
      (ok ? console.log : console.error)(tr({ en: `baseline: ${grew.length} bans grew, ${shrank.length} shrank`, ja: `baseline: 増えた禁止 ${grew.length}件、減った禁止 ${shrank.length}件` }));
      return ok ? 0 : 1;
    }
    case 'diff': {
      if (values.base === undefined) throw new UsageError(tr({ en: 'Usage: bugyo baseline diff --base <ref>', ja: '使い方: bugyo baseline diff --base <ref>' }));
      const grown = baselineGrowth(cwd, values.base);
      for (const line of grown) console.error(`error ${tr({ en: 'grew: ', ja: '増えた: ' })}${line}`);
      if (grown.length > 0) {
        console.error(
          tr({
            en: `baseline: the baseline grew in ${grown.length} places since ${values.base}. Only grow it after a human checks (in CI, the label bugyo-baseline-approved)`,
            ja: `baseline: ${values.base} よりベースラインが ${grown.length}か所増えています。増やすのは人が確かめてからです（CI ではラベル bugyo-baseline-approved）`,
          }),
        );
        return 1;
      }
      console.log(tr({ en: `baseline: nothing grew since ${values.base}`, ja: `baseline: ${values.base} より増えたところはありません` }));
      return 0;
    }
    default:
      throw new UsageError(tr({ en: 'bugyo baseline subcommands: save / check / diff', ja: 'bugyo baseline のサブコマンドは save / check / diff です' }));
  }
}
