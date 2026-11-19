import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CLI の出力の言語。`en`（既定）と `ja`。環境変数 `BUGYO_LOCALE`、`.bugyo/config.json` の `locale` の順に見る（@bugyo/lint と同じ）。
 *
 * @typedef {'en' | 'ja'} Locale
 * @typedef {{ en: string, ja: string }} Text
 */

/** @param {unknown} chosen @returns {Locale} */
function checked(chosen) {
  if (chosen !== 'en' && chosen !== 'ja') throw new Error(`BUGYO_LOCALE must be en or ja / BUGYO_LOCALE は en か ja です: ${String(chosen)}`);
  return chosen;
}

/**
 * @param {{ locale?: 'en' | 'ja' | undefined }} config
 * @returns {Locale}
 */
export function cliLocale(config) {
  const chosen = process.env.BUGYO_LOCALE || config.locale;
  return chosen === undefined ? 'en' : checked(chosen);
}

/**
 * 設定を検証せずに、`.bugyo/config.json` の `locale` だけを読む。設定が読めないときのエラーも、選んだ言語で出すため。
 *
 * @param {string} cwd
 * @returns {Locale}
 */
export function localeFor(cwd) {
  if (process.env.BUGYO_LOCALE) return checked(process.env.BUGYO_LOCALE);
  const path = join(cwd, '.bugyo', 'config.json');
  if (!existsSync(path)) return 'en';
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))?.locale;
    return value === 'ja' ? 'ja' : 'en';
  } catch {
    return 'en';
  }
}

/** @type {Locale | undefined} */
let current;

/** CLI の言語を決める。bin から1回だけ呼ぶ。呼ばなければ、最初に使うときに今のフォルダで決める @param {Locale} locale */
export function setLocale(locale) {
  current = locale;
}

/** @returns {Locale} */
export function locale() {
  current ??= localeFor(process.cwd());
  return current;
}

/**
 * 言語に合う文を選ぶ。
 *
 * @param {Text} text
 */
export const tr = (text) => text[locale()];

/**
 * @typedef {{
 *   verifyUsage: (p: { features: string }) => string,
 *   playwrightEvidence: string,
 *   steps: string,
 *   evidence: string,
 *   notInSandbox: (p: { runners: string, command: string, status: number }) => string,
 *   noEvidenceFiles: (p: { globs: string }) => string,
 *   done: string,
 * }} CliMessages
 */

/** @type {Record<Locale, CliMessages>} */
const catalogs = {
  en: {
    verifyUsage: ({ features }) => `Usage: bugyo verify <feature>|--all  (features: ${features})`,
    playwrightEvidence: ' (video, screenshots, traces)',
    steps: 'steps:',
    evidence: 'evidence:',
    notInSandbox: ({ runners, command, status }) => `Not in a sandbox, so the runners that require one (${runners}) were not run: ${command} exited with ${status}`,
    noEvidenceFiles: ({ globs }) => `Exit code was 0, but there are no evidence files (written during the run and matching ${globs})`,
    done: 'evidence:',
  },
  ja: {
    verifyUsage: ({ features }) => `使い方: bugyo verify <feature>|--all  (候補: ${features})`,
    playwrightEvidence: '（動画・スクリーンショット・トレース）',
    steps: '確認手順:',
    evidence: '証拠:',
    notInSandbox: ({ runners, command, status }) => `隔離環境ではないので、隔離環境が要る確かめ方（${runners}）を動かしませんでした: ${command} が終了コード ${status}`,
    noEvidenceFiles: ({ globs }) => `終了コードは 0 ですが、証拠のファイルがありません（${globs} に当たり、実行のあいだに書かれたもの）`,
    done: '証拠:',
  },
};

/**
 * @param {Locale} locale
 * @returns {CliMessages}
 */
export const cliMessages = (locale) => catalogs[locale];
