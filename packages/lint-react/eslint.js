import reactHooks from 'eslint-plugin-react-hooks';
import { normalizeBan } from '@bugyo/lint';

/**
 * React: `useEffect` の禁止と例外の場所（effectHooksDir）、react-hooks、feature の UI でのタイマー禁止、`model` から React への依存の禁止。
 * `@bugyo/lint` の `bugyo({ parts: [common, structure, react] })` に渡して使う。
 *
 * @type {import('@bugyo/lint').BugyoPart & { build: (context: { effectHooksDir: string, featuresLabel?: string }) => object }}
 */
export const react = {
  name: 'react',
  rank: 1,
  build: (context) => {
    const effectMessage = `製品コードでuseEffectは使えません。データ取得は ${context.featuresLabel ?? 'features'}/*/api の useXxxQuery、購読やタイマーは ${context.effectHooksDir} の専用フックを使ってください。該当するフックがなければ ${context.effectHooksDir} に追加してください。`;
    return {
      srcPlugins: { 'react-hooks': reactHooks },
      srcRules: { ...reactHooks.configs.recommended.rules },
      bans: [
        normalizeBan({
          name: 'use-effect',
          allow: ['effects'],
          imports: { paths: [{ name: 'react', importNames: ['useEffect', 'useLayoutEffect'], message: effectMessage }] },
          syntax: [{ selector: "MemberExpression[object.name='React'][property.name=/^use(Layout)?Effect$/]", message: effectMessage }],
        }),
        normalizeBan({
          name: 'ui-timers',
          scope: 'ui',
          allow: ['tests'],
          globals: ['setTimeout', 'setInterval', 'requestAnimationFrame'].map((name) => ({
            name,
            message: `UIで${name}によるタイミング合わせはできません。根本原因（状態の持ち方・データの流れ）を直してください。時間に依存する処理が本当に必要なら ${context.effectHooksDir} に専用フックを作ってください。`,
          })),
        }),
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
    };
  },
};
