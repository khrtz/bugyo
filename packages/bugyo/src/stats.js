/**
 * 割合の 95% 信頼区間（Wilson の方法）。件数が少ないほど広くなる。0件なら 0〜1。
 *
 * @param {number} hits
 * @param {number} total
 * @returns {{ low: number, high: number }}
 */
export function wilsonInterval(hits, total) {
  if (total === 0) return { low: 0, high: 1 };
  const z = 1.96;
  const p = hits / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** 区間の幅がこれを超えたら、数字だけで判断しないよう警告する */
export const wideInterval = 0.3;

/** @param {number} value */
export const percent = (value) => `${(value * 100).toFixed(1)}%`;

/**
 * @typedef {{
 *   type: string,
 *   model: string,
 *   harness: string,
 *   closed: number,
 *   done: number,
 *   firstPass: number,
 *   reworked: number,
 *   dropped: number,
 *   firstPassInterval: { low: number, high: number },
 * }} StatsRow
 */

/**
 * 閉じたタスク（完了と中止）を、作業の種類・モデル・ハーネスごとに数える。
 * 1回で通った割合と手直しの割合は完了したタスクの中で、中止の割合は閉じたタスクの中で数える。
 *
 * @param {import('./tasks.js').Task[]} tasks
 * @returns {StatsRow[]}
 */
export function taskStats(tasks) {
  /** @type {Map<string, StatsRow>} */
  const rows = new Map();
  for (const task of tasks) {
    if (task.status !== 'done' && task.status !== 'dropped') continue;
    const model = task.model ?? '-';
    const harness = task.harness ?? '-';
    const key = `${task.type}\0${model}\0${harness}`;
    const row = rows.get(key) ?? { type: task.type, model, harness, closed: 0, done: 0, firstPass: 0, reworked: 0, dropped: 0, firstPassInterval: { low: 0, high: 1 } };
    row.closed += 1;
    if (task.status === 'dropped') row.dropped += 1;
    else {
      row.done += 1;
      if (task['gate-attempts'] === 1) row.firstPass += 1;
      if (task.rework > 0) row.reworked += 1;
    }
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, firstPassInterval: wilsonInterval(row.firstPass, row.done) }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.model.localeCompare(b.model) || a.harness.localeCompare(b.harness));
}
