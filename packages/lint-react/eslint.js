import reactHooks from 'eslint-plugin-react-hooks';

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
      src: {
        paths: [{ value: { name: 'react', importNames: ['useEffect', 'useLayoutEffect'], message: effectMessage }, exempt: ['effects'] }],
        syntax: [
          {
            value: { selector: "MemberExpression[object.name='React'][property.name=/^use(Layout)?Effect$/]", message: effectMessage },
            exempt: ['effects', 'tests'],
          },
        ],
      },
      ui: {
        globals: ['setTimeout', 'setInterval', 'requestAnimationFrame'].map((name) => ({
          value: {
            name,
            message: `UIで${name}によるタイミング合わせはできません。根本原因（状態の持ち方・データの流れ）を直してください。時間に依存する処理が本当に必要なら ${context.effectHooksDir} に専用フックを作ってください。`,
          },
          exempt: ['tests'],
        })),
      },
      model: {
        patterns: [
          {
            value: {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*', '@tanstack/*'],
              message: 'model/ は純粋関数だけです。Reactや通信に依存する処理は ui/ か api/ に置いてください。',
            },
          },
        ],
      },
    };
  },
};
