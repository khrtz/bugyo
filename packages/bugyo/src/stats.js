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
 *   cost: { tokens: CostSum, usd: CostSum },
 * }} StatsRow
 *
 * 完了したタスクのうち、コストを記録したものの合計。`tasks` は記録した件数、`firstPass` はそのうち1回で通った件数
 * @typedef {{ tasks: number, firstPass: number, sum: number }} CostSum
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
    const row = rows.get(key) ?? {
      type: task.type,
      model,
      harness,
      closed: 0,
      done: 0,
      firstPass: 0,
      reworked: 0,
      dropped: 0,
      firstPassInterval: { low: 0, high: 1 },
      cost: { tokens: { tasks: 0, firstPass: 0, sum: 0 }, usd: { tasks: 0, firstPass: 0, sum: 0 } },
    };
    row.closed += 1;
    if (task.status === 'dropped') row.dropped += 1;
    else {
      row.done += 1;
      if (task['gate-attempts'] === 1) row.firstPass += 1;
      if (task.rework > 0) row.reworked += 1;
      addCost(row.cost.tokens, task['cost-tokens'], task['gate-attempts'] === 1);
      addCost(row.cost.usd, task['cost-usd'] === undefined ? undefined : Number(task['cost-usd']), task['gate-attempts'] === 1);
    }
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, firstPassInterval: wilsonInterval(row.firstPass, row.done) }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.model.localeCompare(b.model) || a.harness.localeCompare(b.harness));
}

/**
 * @param {CostSum} total
 * @param {number | undefined} value
 * @param {boolean} firstPass
 */
function addCost(total, value, firstPass) {
  if (value === undefined) return;
  total.tasks += 1;
  total.sum = Math.round((total.sum + value) * 1e6) / 1e6;
  if (firstPass) total.firstPass += 1;
}

/** 書き出したファイルの形の名前と版。読むときにこれで見分ける */
export const statsFormat = { name: 'bugyo-stats', version: 1 };

/**
 * @typedef {{
 *   format: string,
 *   version: number,
 *   project: string,
 *   exportedAt: string,
 *   commands: Record<string, string>,
 *   rows: StatsRow[],
 * }} StatsExport
 */

/**
 * 書き出した実績のファイルを読む。形が違えば断る。
 *
 * @param {unknown} data
 * @param {string} file
 * @param {(text: { en: string, ja: string }) => string} tr
 * @returns {StatsExport}
 */
export function readStatsExport(data, file, tr) {
  const record = /** @type {Record<string, unknown>} */ (data);
  if (typeof data !== 'object' || data === null || record['format'] !== statsFormat.name || !Array.isArray(record['rows'])) {
    throw new Error(tr({ en: `${file} is not a file written by bugyo stats --export`, ja: `${file} は bugyo stats --export で書いたファイルではありません` }));
  }
  if (record['version'] !== statsFormat.version) {
    throw new Error(tr({ en: `${file} has format version ${String(record['version'])}; this bugyo reads version ${statsFormat.version}`, ja: `${file} の形の版は ${String(record['version'])} です。この bugyo が読めるのは ${statsFormat.version} です` }));
  }
  return /** @type {StatsExport} */ (data);
}
