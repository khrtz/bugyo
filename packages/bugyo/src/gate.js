import { mistakeState } from './mistakes.js';

/**
 * `gate.scopes` がないときのまとまり。任せる判断は、作業の種類のまとまりごとに実績で決める。
 *
 * @type {Record<string, { types: import('./tasks.js').Task['type'][] }>}
 */
export const defaultScopes = {
  ui: { types: ['feature', 'ui-flow', 'ui-look'] },
  code: { types: ['logic', 'bugfix', 'refactor'] },
  chore: { types: ['chore'] },
};

/** @param {import('./tasks.js').Task} task */
const closedAt = (task) => (task.status === 'done' ? task['evidence-at'] : task['dropped-at']) ?? '';

/**
 * 直近の閉じたタスク（完了と中止）とミスの記録から、まとまりごとに任せる範囲を広げてよいかを計算する。
 *
 * @param {import('./tasks.js').Task[]} tasks
 * @param {import('./mistakes.js').Mistake[]} mistakes
 * @param {import('./index.js').BugyoConfig['gate']} gate
 * @param {string} [only] このまとまりだけを計算する
 */
export function evaluateGate(tasks, mistakes, gate, only) {
  const all = Object.entries(gate.scopes ?? defaultScopes);
  const scopes = only === undefined ? all : all.filter(([name]) => name === only);
  if (scopes.length === 0) throw new Error(`まとまり "${only}" はありません。使える名前: ${all.map(([name]) => name).join(', ')}`);
  const repeated = mistakes.filter((mistake) => ['unruled', 'leak'].includes(mistakeState(mistake))).map((mistake) => mistake.kind);

  const results = scopes.map(([name, scope]) => {
    const window = scope.window ?? gate.window;
    const maxRework = scope.maxRework ?? gate.maxRework;
    const minFirstPass = scope.minFirstPass ?? gate.minFirstPass;
    const maxDropped = scope.maxDropped ?? gate.maxDropped;
    const recent = tasks
      .filter((task) => (task.status === 'done' || task.status === 'dropped') && scope.types.includes(task.type))
      .sort((a, b) => closedAt(b).localeCompare(closedAt(a)) || b.id.localeCompare(a.id))
      .slice(0, window);
    const done = recent.filter((task) => task.status === 'done');
    const dropped = recent.length - done.length;
    const reworked = done.filter((task) => task.rework > 0).length;
    const firstPass = done.filter((task) => task['gate-attempts'] === 1).length;
    const conditions = [
      { name: 'count', label: '閉じたタスク（完了と中止）', value: recent.length, limit: `${window}件以上`, ok: recent.length >= window },
      { name: 'dropped', label: '中止したタスク', value: dropped, limit: `${maxDropped}件以下`, ok: dropped <= maxDropped },
      { name: 'rework', label: '手直しが要ったタスク', value: reworked, limit: `${maxRework}件以下`, ok: reworked <= maxRework },
      { name: 'first-pass', label: '1回で通ったタスク', value: firstPass, limit: `${minFirstPass}件以上`, ok: firstPass >= minFirstPass },
      { name: 'repeated-mistakes', label: 'ルール化されていない再発', value: repeated.length, limit: '0種類', ok: repeated.length === 0, kinds: repeated },
    ];
    return { name, types: scope.types, window, passed: conditions.every((condition) => condition.ok), conditions };
  });
  return { passed: results.every((result) => result.passed), scopes: results };
}
