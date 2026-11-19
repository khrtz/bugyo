import { spawnSync } from 'node:child_process';
import { matchesGlob } from 'node:path';
import { tr } from './locale.js';
import { tasksDir } from './tasks.js';

/** タスクのブランチ名。`task/t-001` か、後ろに説明を付けた `task/t-001-login` */
const taskBranch = /^task\/(t-\d{3,})(?:[-/].*)?$/;

/**
 * @typedef {{ ok: true, how: 'branch' | 'ledger' | 'allowed', ids: string[] } | { ok: false, message: string }} PrCheck
 */

/**
 * @param {string} cwd
 * @param {string} base
 * @returns {string[]} base...HEAD で変わったタスクのファイルの id
 */
function changedTaskIds(cwd, base) {
  const run = spawnSync('git', ['diff', '--name-only', '--relative', `${base}...HEAD`, '--', tasksDir], { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(tr({ en: `git diff ${base}...HEAD failed: ${(run.stderr ?? '').trim()}`, ja: `git diff ${base}...HEAD が失敗しました: ${(run.stderr ?? '').trim()}` }));
  return [
    ...new Set(
      run.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.endsWith('.md'))
        .map((line) => line.split('/').pop()?.replace(/\.md$/, '') ?? ''),
    ),
  ].sort();
}

/**
 * PR の作業がタスクに紐づいているかを確かめる。
 * ブランチ名が `task/<id>` で台帳にそのタスクがあるか、base からの差分でタスクのファイルが変わっていれば紐づいている。
 * `allowBranches` の glob に合うブランチは、紐づかなくても通す。
 *
 * @param {{ cwd: string, branch: string, base?: string | undefined, allowBranches: string[], tasks: import('./tasks.js').Task[] }} input
 * @returns {PrCheck}
 */
export function prCheck({ cwd, branch, base, allowBranches, tasks }) {
  if (allowBranches.some((pattern) => matchesGlob(branch, pattern))) return { ok: true, how: 'allowed', ids: [] };
  const id = taskBranch.exec(branch)?.[1];
  if (id !== undefined) {
    const task = tasks.find((candidate) => candidate.id === id);
    if (task === undefined) return {
        ok: false,
        message: tr({
          en: `The task ${id} of the branch ${branch} is not in the ledger. Create it with bugyo task add, then work on a branch with that id`,
          ja: `ブランチ ${branch} のタスク ${id} が台帳にありません。bugyo task add で作ってから、その id のブランチで作業してください`,
        }),
      };
    if (task.status === 'dropped') return {
        ok: false,
        message: tr({
          en: `The task ${id} of the branch ${branch} was dropped. Work on the branch of another task`,
          ja: `ブランチ ${branch} のタスク ${id} は中止されています。別のタスクのブランチで作業してください`,
        }),
      };
    return { ok: true, how: 'branch', ids: [id] };
  }
  const changed = base === undefined ? [] : changedTaskIds(cwd, base);
  if (changed.length > 0) return { ok: true, how: 'ledger', ids: changed };
  return {
    ok: false,
    message: tr({
      en: `The work on the branch ${branch} is not linked to a task. Create a task and work on a task/<id> branch (git switch -c task/t-001), or change the task's file in this PR. Branches that need no task go in pullRequests.allowBranches of .bugyo/config.json as globs${base === undefined ? ' (with --base, ledger changes are checked too)' : ''}`,
      ja: `ブランチ ${branch} の作業がタスクに紐づいていません。タスクを作って task/<id> のブランチで作業するか（git switch -c task/t-001）、この PR でタスクのファイルを変えてください。タスクのいらないブランチは、.bugyo/config.json の pullRequests.allowBranches に glob で書きます${base === undefined ? '（--base を渡すと、台帳の差分でも確かめます）' : ''}`,
    }),
  };
}

/**
 * 確かめるブランチの名前。`--branch`、CI の環境変数（GitHub Actions の GITHUB_HEAD_REF）、今のブランチの順に見る。
 *
 * @param {string} cwd
 * @param {string | undefined} given
 */
export function currentBranch(cwd, given) {
  if (given !== undefined && given.trim() !== '') return given.trim();
  const fromCi = process.env['GITHUB_HEAD_REF'];
  if (fromCi !== undefined && fromCi !== '') return fromCi;
  const run = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
  const name = (run.stdout ?? '').trim();
  if (run.status !== 0 || name === '' || name === 'HEAD') throw new Error(tr({ en: 'Cannot tell the branch name. Pass it with --branch <name>', ja: 'ブランチの名前が分かりません。--branch <名前> で渡してください' }));
  return name;
}
