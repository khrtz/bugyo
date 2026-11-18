import reactHooks from 'eslint-plugin-react-hooks';
import { defineBan, normalizeBan } from '@bugyo/lint';

/**
 * 禁止のメッセージ。言語（`context.locale`）ごとに持つ。
 *
 * @type {Record<'ja' | 'en', { modelReact: string, useEffect: (p: { features: string, effects: string }) => string, uiTimer: (p: { name: string, effects: string }) => string }>}
 */
const messages = {
  ja: {
    modelReact: 'model/ は純粋関数だけです。Reactや通信に依存する処理は ui/ か api/ に置いてください。',
    useEffect: ({ features, effects }) =>
      `製品コードでuseEffectは使えません。データ取得は ${features}/*/api の useXxxQuery、購読やタイマーは ${effects} の専用フックを使ってください。該当するフックがなければ ${effects} に追加してください。`,
    uiTimer: ({ name, effects }) =>
      `UIで${name}によるタイミング合わせはできません。根本原因（状態の持ち方・データの流れ）を直してください。時間に依存する処理が本当に必要なら ${effects} に専用フックを作ってください。`,
  },
  en: {
    modelReact: 'model/ is pure functions only. Put code that depends on React or the network in ui/ or api/.',
    useEffect: ({ features, effects }) =>
      `useEffect is not allowed in product code. Fetch data with useXxxQuery in ${features}/*/api, and use a dedicated hook in ${effects} for subscriptions and timers. If no such hook exists, add one to ${effects}.`,
    uiTimer: ({ name, effects }) =>
      `Do not time things with ${name} in UI. Fix the root cause (how state is held, how data flows). If you really need time-dependent code, write a dedicated hook in ${effects}.`,
  },
};

/** @param {{ locale?: string }} context */
const messagesOf = (context) => (context.locale === 'ja' ? messages.ja : messages.en);

/**
 * React: react-hooks の推奨ルールと、`model` から React への依存の禁止。
 * `@bugyo/lint` の `bugyo({ parts: [common, structure, react] })` に渡して使う。
 *
 * @type {import('@bugyo/lint').BugyoPart & { build: (context: { effectHooksDir: string, featuresLabel?: string, locale?: string }) => object }}
 */
export const react = {
  name: 'react',
  rank: 1,
  build: (context) => ({
    srcPlugins: { 'react-hooks': reactHooks },
    srcRules: { ...reactHooks.configs.recommended.rules },
    bans: [
      normalizeBan({
        name: 'model-react',
        scope: 'model',
        imports: {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*', '@tanstack/*'],
              message: messagesOf(context).modelReact,
            },
          ],
        },
      }),
    ],
  }),
};

/**
 * `useEffect` / `useLayoutEffect` の禁止（`react` からの import と `React.useEffect` の形）。effectHooksDir（既定は `shared/lib`）でだけ書ける。
 */
export const noUseEffect = defineBan({
  name: 'use-effect',
  allow: ['effects'],
  build: (context) => {
    const message = messagesOf(context).useEffect({ features: context.featuresLabel, effects: context.effectHooksDir });
    return {
      imports: { paths: [{ name: 'react', importNames: ['useEffect', 'useLayoutEffect'], message }] },
      syntax: [{ selector: "MemberExpression[object.name='React'][property.name=/^use(Layout)?Effect$/]", message }],
    };
  },
});

/**
 * feature の UI での `setTimeout`・`setInterval`・`requestAnimationFrame` の禁止。テストでは書ける。
 */
export const noUiTimers = defineBan({
  name: 'ui-timers',
  scope: 'ui',
  allow: ['tests'],
  build: (context) => ({
    globals: ['setTimeout', 'setInterval', 'requestAnimationFrame'].map((name) => ({
      name,
      message: messagesOf(context).uiTimer({ name, effects: context.effectHooksDir }),
    })),
  }),
});
