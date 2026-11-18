import reactHooks from 'eslint-plugin-react-hooks';
import { defineBan, normalizeBan } from '@bugyo/lint';

/**
 * React: react-hooks の推奨ルールと、`model` から React への依存の禁止。
 * `@bugyo/lint` の `bugyo({ parts: [common, structure, react] })` に渡して使う。
 *
 * @type {import('@bugyo/lint').BugyoPart & { build: (context: { effectHooksDir: string, featuresLabel?: string }) => object }}
 */
export const react = {
  name: 'react',
  rank: 1,
  build: () => ({
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
              message: 'model/ は純粋関数だけです。Reactや通信に依存する処理は ui/ か api/ に置いてください。',
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
    const message = `製品コードでuseEffectは使えません。データ取得は ${context.featuresLabel}/*/api の useXxxQuery、購読やタイマーは ${context.effectHooksDir} の専用フックを使ってください。該当するフックがなければ ${context.effectHooksDir} に追加してください。`;
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
      message: `UIで${name}によるタイミング合わせはできません。根本原因（状態の持ち方・データの流れ）を直してください。時間に依存する処理が本当に必要なら ${context.effectHooksDir} に専用フックを作ってください。`,
    })),
  }),
});
