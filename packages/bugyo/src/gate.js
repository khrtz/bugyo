import { mistakeState } from './mistakes.js';

/**
 * 直近の完了タスクとミスの記録から、任せる範囲を広げてよいかを計算する。
 *
 * @param {import('./tasks.js').Task[]} tasks
 * @param {import('./mistakes.js').Mistake[]} mistakes
 * @param {import('./index.js').BugyoConfig['gate']} gate
 */
export function evaluateGate(tasks, mistakes, gate) {
  const recent = tasks
    .filter((task) => task.status === 'done')
    .sort((a, b) => (b['evidence-at'] ?? '').localeCompare(a['evidence-at'] ?? '') || b.id.localeCompare(a.id))
    .slice(0, gate.window);
  const reworked = recent.filter((task) => task.rework > 0).length;
  const firstPass = recent.filter((task) => task['gate-attempts'] === 1).length;
  const repeated = mistakes.filter((mistake) => ['unruled', 'leak'].includes(mistakeState(mistake))).map((mistake) => mistake.kind);
  const conditions = [
    { name: 'count', label: '完了タスク', value: recent.length, limit: `${gate.window}件以上`, ok: recent.length >= gate.window },
    { name: 'rework', label: '手直しが要ったタスク', value: reworked, limit: `${gate.maxRework}件以下`, ok: reworked <= gate.maxRework },
    { name: 'first-pass', label: '1回で通ったタスク', value: firstPass, limit: `${gate.minFirstPass}件以上`, ok: firstPass >= gate.minFirstPass },
    { name: 'repeated-mistakes', label: 'ルール化されていない再発', value: repeated.length, limit: '0種類', ok: repeated.length === 0, kinds: repeated },
  ];
  return { passed: conditions.every((condition) => condition.ok), window: gate.window, conditions };
}
