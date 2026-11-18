import type { BugyoPart } from '@bugyo/lint';

/** React: react-hooks の推奨ルールと、model から React への依存の禁止 */
export const react: BugyoPart;
/** 禁止 `use-effect`: useEffect / useLayoutEffect は effectHooksDir でだけ書ける */
export const noUseEffect: BugyoPart;
/** 禁止 `ui-timers`: feature の UI で setTimeout・setInterval・requestAnimationFrame を使えない（テストでは書ける） */
export const noUiTimers: BugyoPart;
