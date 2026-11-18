import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * bugyo の禁止のメッセージの言語。`en`（既定）と `ja`。
 *
 * @typedef {'ja' | 'en'} Locale
 */

/** @type {readonly Locale[]} */
export const locales = ['en', 'ja'];

/**
 * メッセージの言語を決める。`bugyo({ locale })`、環境変数 `BUGYO_LOCALE`、`<root>/.bugyo/config.json` の `locale` の順に見て、どれもなければ `en`。
 *
 * @param {string} root
 * @param {unknown} [option]
 * @returns {Locale}
 */
export function resolveLocale(root, option) {
  const chosen = option ?? (process.env.BUGYO_LOCALE || undefined) ?? configLocale(root);
  if (chosen === undefined) return 'en';
  if (typeof chosen !== 'string' || !locales.some((locale) => locale === chosen)) {
    throw new Error(`locale は ${locales.join(' / ')} のどれかです / locale must be one of ${locales.join(', ')}: ${String(chosen)}`);
  }
  return /** @type {Locale} */ (chosen);
}

/** @param {string} root */
function configLocale(root) {
  const file = join(root, '.bugyo', 'config.json');
  if (!existsSync(file)) return undefined;
  try {
    const locale = JSON.parse(readFileSync(file, 'utf8')).locale;
    return typeof locale === 'string' ? locale : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 設定の書き方の誤りを知らせるエラーの文を、言語に合わせて選ぶ。言語は `BUGYO_LOCALE`、今のフォルダの `.bugyo/config.json` の順に見る。
 *
 * @param {{ en: string, ja: string }} text
 */
export function say(text) {
  try {
    return text[resolveLocale(process.cwd())];
  } catch {
    return text.en;
  }
}

/**
 * 場所の名前をいくつも並べるときのつなぎ。
 *
 * @param {Locale} locale
 * @param {string[]} list
 */
export const joinList = (locale, list) => list.join(locale === 'en' ? ', ' : '・');

/**
 * @typedef {{
 *   fetch: (p: { apiClientDir: string }) => string,
 *   sharedIsLeaf: (p: { shared: string, features: string, app: string }) => string,
 *   featuresNotToApp: (p: { features: string, app: string }) => string,
 *   modelIsPure: (p: { model: string, pure: string }) => string,
 *   sharedModelIsPure: (p: { sharedModel: string, pure: string }) => string,
 *   featureInternals: (p: { features: string }) => string,
 *   modelLayers: (p: { model: string, outer: string, ui: string, api: string }) => string,
 *   modelLayersDefault: () => string,
 *   modelSharedLayers: () => string,
 * }} Catalog
 */

/** @type {Record<Locale, Catalog>} */
const catalogs = {
  ja: {
    fetch: ({ apiClientDir }) => `fetchを直接呼ばないでください。${apiClientDir} のクライアントを使い、スキーマで応答を検証してください。`,
    sharedIsLeaf: ({ shared, features, app }) => `${shared} は ${features} や ${app} に依存できません。`,
    featuresNotToApp: ({ features, app }) => `${features} は ${app} に依存できません。`,
    modelIsPure: ({ model, pure }) => `${model} が使えるのは自分の${model}と ${pure} だけです。`,
    sharedModelIsPure: ({ sharedModel, pure }) => `${sharedModel} が使えるのは ${pure} だけです。`,
    featureInternals: ({ features }) => `featureの内部ファイルは直接importできません。${features}/<名前>/index.ts から公開されたものを使ってください。`,
    modelLayers: ({ model, outer, ui, api }) => `${model} から ${outer} はimportできません。依存の向きは ${ui} → ${api} → ${model} です。`,
    modelLayersDefault: () => 'model/ から ui/ や api/ はimportできません。依存の向きは ui → api → model です。',
    modelSharedLayers: () => 'model/ が使えるのは自分のmodelと shared/lib だけです。',
  },
  en: {
    fetch: ({ apiClientDir }) => `Do not call fetch directly. Use the client in ${apiClientDir} and validate the response with a schema.`,
    sharedIsLeaf: ({ shared, features, app }) => `${shared} cannot depend on ${features} or ${app}.`,
    featuresNotToApp: ({ features, app }) => `${features} cannot depend on ${app}.`,
    modelIsPure: ({ model, pure }) => `${model} can only use its own ${model} and ${pure}.`,
    sharedModelIsPure: ({ sharedModel, pure }) => `${sharedModel} can only use ${pure}.`,
    featureInternals: ({ features }) => `Do not import a feature's internal files. Use what ${features}/<name>/index.ts exports.`,
    modelLayers: ({ model, outer, ui, api }) => `${model} cannot import ${outer}. Dependencies go ${ui} → ${api} → ${model}.`,
    modelLayersDefault: () => 'model/ cannot import ui/ or api/. Dependencies go ui → api → model.',
    modelSharedLayers: () => 'model/ can only use its own model and shared/lib.',
  },
};

/**
 * @param {Locale} locale
 * @returns {Catalog}
 */
export const messagesFor = (locale) => catalogs[locale];
