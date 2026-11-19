import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readEvidence } from './evidence.js';
import { featureDir, loadFeatures } from './feature-map.js';
import { loadMistakes, mistakeLine, mistakeState } from './mistakes.js';
import { tr } from './locale.js';
import { archiveDir, readLedger, tasksDir } from './tasks.js';

/**
 * 台帳の整合を検査する。errors が1件でもあれば不合格。warnings は再発したミス。
 *
 * @param {string} [cwd]
 * @returns {{ count: number, errors: string[], warnings: string[] }}
 */
export function lintTasks(cwd = process.cwd()) {
  const { tasks, errors } = readLedger(cwd);
  /** @param {import('./tasks.js').Task} task @param {string} message */
  const fail = (task, message) => errors.push(`${task.file}: ${message}`);

  const seen = new Map();
  for (const task of tasks) {
    const other = seen.get(task.id);
    if (other !== undefined) fail(task, tr({ en: `${other} has a task with the same id`, ja: `同じ id のタスクが ${other} にもあります` }));
    seen.set(task.id, task.file);
  }

  /** @param {import('./tasks.js').Task} task */
  const closed = (task) => task.status === 'done' || task.status === 'dropped';
  for (const task of tasks) {
    if (closed(task) && !task.archived) fail(
        task,
        tr({
          en: `${task.status} tasks belong in ${archiveDir} (if you edited status by hand, use bugyo task done / drop instead)`,
          ja: `${task.status} のタスクは ${archiveDir} に置きます（手で status を書き換えたなら、bugyo task done / drop を使ってください）`,
        }),
      );
    if (!closed(task) && task.archived) fail(task, tr({ en: `${task.status} tasks belong in ${tasksDir}`, ja: `${task.status} のタスクは ${tasksDir} に置きます` }));
    if (task.title === '') fail(task, tr({ en: 'The body has no "# Title" line', ja: '本文に「# タイトル」の行がありません' }));
    if (task.status === 'active' && task.assignee === '') fail(task, tr({ en: 'active but has no assignee (bugyo task start <id> --as <name>)', ja: 'active なのに assignee がいません（bugyo task start <id> --as <名前>）' }));
    for (const id of task['blocked-by']) {
      if (!tasks.some((candidate) => candidate.id === id)) fail(task, tr({ en: `blocked-by: there is no task ${id}`, ja: `blocked-by の ${id} というタスクはありません` }));
    }
    if (task.status === 'done') {
      const file = task['evidence-file'];
      const evidence = file === undefined ? undefined : readEvidence(cwd, file);
      if (file === undefined || evidence === undefined) {
        fail(task, tr({ en: 'No evidence file. Only bugyo task done can mark a task done', ja: '証拠ファイルがありません。done にできるのは bugyo task done だけです' }));
      } else {
        const tree = /** @type {{ hash?: unknown } | undefined} */ (evidence['tree']);
        if (evidence['task'] !== task.id) fail(task, tr({ en: `${file} is evidence for ${String(evidence['task'])}`, ja: `${file} は ${String(evidence['task'])} の証拠です` }));
        if (tree?.hash !== task['evidence-tree']) fail(task, tr({ en: `evidence-tree does not match ${file}`, ja: `evidence-tree が ${file} と合いません` }));
        if (evidence['rework'] !== task.rework) fail(task, tr({ en: `rework does not match ${file} (there is no evidence after the rework)`, ja: `rework が ${file} と合いません（手直しのあとの証拠がありません）` }));
        if (evidence['attempt'] !== task['gate-attempts']) fail(task, tr({ en: `gate-attempts does not match ${file}`, ja: `gate-attempts が ${file} と合いません` }));
      }
    }
  }

  const assignees = new Map();
  for (const task of tasks.filter((candidate) => candidate.status === 'active' && candidate.assignee !== '')) {
    assignees.set(task.assignee, [...(assignees.get(task.assignee) ?? []), task.id]);
  }
  for (const [assignee, ids] of assignees) {
    if (ids.length > 1) errors.push(`${tasksDir}: ${tr({ en: `${assignee} is working on ${ids.join(', ')} at once. One task per worker`, ja: `${assignee} が ${ids.join(', ')} を同時に作業中です。1人1件にしてください` })}`);
  }

  const live = tasks.filter((task) => !closed(task) && task.feature !== '');
  if (live.length > 0) {
    const ids = existsSync(join(cwd, featureDir)) ? new Set(loadFeatures(cwd).map((feature) => feature.id)) : new Set();
    for (const task of live) {
      if (!ids.has(task.feature)) fail(task, tr({ en: `feature ${task.feature} is not in ${featureDir}`, ja: `feature の ${task.feature} が ${featureDir} にありません` }));
    }
  }

  const warnings = loadMistakes(cwd)
    .filter((mistake) => ['unruled', 'leak'].includes(mistakeState(mistake)))
    .map((mistake) => tr({ en: 'mistake: ', ja: 'ミス: ' }) + mistakeLine(mistake));

  return { count: tasks.length, errors, warnings };
}
