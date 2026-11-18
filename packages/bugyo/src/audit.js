import { isDeepStrictEqual } from 'node:util';
import { collectEvidence, readEvidence, treeHash } from './evidence.js';
import { evidenceDir } from './tasks.js';

/** @param {unknown} value */
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Re-run a closed task's requirements without replacing its committed evidence.
 * Only stable facts are compared: duration and completion time naturally differ.
 *
 * @param {import('./tasks.js').Task} task
 * @param {import('./index.js').BugyoConfig} config
 * @param {string} cwd
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function auditTask(task, config, cwd) {
  if (task.status !== 'done') return { ok: false, reason: `${task.id} は完了していません` };
  const file = `${evidenceDir}/${task.id}.json`;
  if (task['evidence-file'] !== file) return { ok: false, reason: `証拠の場所は ${file} にしてください` };
  const saved = readEvidence(cwd, file);
  if (!object(saved)) return { ok: false, reason: `${file} を読めません` };
  if (saved.task !== task.id || saved.type !== task.type || saved.feature !== task.feature ||
      saved.attempt !== task['gate-attempts'] || saved.rework !== task.rework) {
    return { ok: false, reason: '証拠のタスク情報が台帳と一致しません' };
  }
  if (!object(saved.tree) || !isDeepStrictEqual(saved.tree.paths, config.evidence.tree) ||
      saved.tree.hash !== task['evidence-tree'] || saved.tree.hash !== treeHash(cwd, config.evidence.tree)) {
    return { ok: false, reason: '証拠のハッシュが現在のコードまたは設定と一致しません' };
  }

  const fresh = collectEvidence(task, config, cwd, { persist: false });
  if (!fresh.ok) return { ok: false, reason: `${fresh.step.label}: ${fresh.reason}${fresh.output ? `\n${fresh.output}` : ''}` };
  if (fresh.tree !== saved.tree.hash) return { ok: false, reason: '検証中に証拠の対象ファイルが変わりました' };
  if (!isDeepStrictEqual(saved.conditions, fresh.evidence.conditions)) {
    return { ok: false, reason: '記録された完了条件が再検証の結果と一致しません' };
  }

  const steps = saved.steps;
  const actual = fresh.evidence.steps;
  if (!Array.isArray(steps) || steps.length !== actual.length) return { ok: false, reason: '証拠のコマンド数が一致しません' };
  for (let i = 0; i < actual.length; i++) {
    const previous = steps[i];
    const current = actual[i];
    if (!object(previous) || !object(current) || previous.name !== current.name ||
        previous.command !== current.command || previous.status !== 0) {
      return { ok: false, reason: `${i + 1}番目のコマンドの記録が再検証と一致しません` };
    }
    if (current.name === 'verify') {
      const old = previous.results;
      const next = current.results;
      if (!object(old) || !object(next) || old.runner !== next.runner || old.passed !== true ||
          !isDeepStrictEqual(old.features, next.features)) {
        return { ok: false, reason: 'verify の機能別の結果が再検証と一致しません' };
      }
    }
  }
  return { ok: true };
}
