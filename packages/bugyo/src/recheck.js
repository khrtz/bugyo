import { spawnSync } from 'node:child_process';
import { collectEvidence, readEvidence, requirements } from './evidence.js';
import { runCommand, tail } from './run.js';
import { archiveDir } from './tasks.js';

/**
 * `base...HEAD` で追加・変更された完了タスクのファイルから、タスクの id を返す。
 * cwd より下のファイルだけを見る。
 *
 * @param {string} cwd
 * @param {string} base
 * @returns {string[]}
 */
export function changedArchiveIds(cwd, base) {
  const run = spawnSync('git', ['diff', '--name-only', '--relative', '--diff-filter=AM', `${base}...HEAD`, '--', archiveDir], {
    cwd,
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`git diff ${base}...HEAD が失敗しました: ${(run.stderr ?? '').trim()}`);
  return run.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.md'))
    .map((line) => line.split('/').pop()?.replace(/\.md$/, '') ?? '')
    .sort();
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function gitOut(cwd, args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} が失敗しました: ${(run.stderr ?? '').trim()}`);
  return run.stdout;
}

/** @param {string} path */
const idOf = (path) => path.split('/').pop()?.replace(/\.md$/, '') ?? '';

/** @param {string} text */
const createdOf = (text) => /^created: ?(.*)$/m.exec(text)?.[1]?.trim() ?? '';

/**
 * `base...HEAD` で新しく足したタスクのうち、`base` にすでに同じ id の別のタスク（作った日時が違うもの）があるものを返す。
 * 別々のブランチで同じ id を振ったとき、マージする前に見つけるため。
 *
 * @param {string} cwd
 * @param {string} base
 * @returns {string[]}
 */
export function duplicateIdsAgainst(cwd, base) {
  const tasksRoot = archiveDir.replace(/\/archive$/, '');
  const added = gitOut(cwd, ['diff', '--name-only', '--relative', '--diff-filter=A', `${base}...HEAD`, '--', tasksRoot])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.md'));
  const existing = new Map(
    gitOut(cwd, ['ls-tree', '-r', '--name-only', base, '--', tasksRoot])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.md'))
      .map((line) => [idOf(line), line]),
  );
  /** @type {string[]} */
  const errors = [];
  for (const file of added) {
    const id = idOf(file);
    const before = existing.get(id);
    if (before === undefined) continue;
    const ours = createdOf(gitOut(cwd, ['show', `HEAD:./${file}`]));
    const theirs = createdOf(gitOut(cwd, ['show', `${base}:./${before}`]));
    if (ours !== theirs) errors.push(`${file}: ${id} は ${base} の ${before} と同じ id の別のタスクです（作った日時 ${ours} / ${theirs}）。id を振り直してください`);
  }
  return errors;
}

/**
 * @typedef {{ id: string, ok: boolean, reason: string, output: string }} RecheckResult
 */

const safeValue = /^[A-Za-z0-9.][A-Za-z0-9#._:/-]*$/;

/**
 * 証拠を取り直して通ったタスクを、課題に知らせる。`notify.verified` のコマンドの `{issue}`・`{task}`・`{evidence}` を置き換えてシェルで実行する。
 * 同じ値とタイトルを環境変数（BUGYO_ISSUE・BUGYO_TASK・BUGYO_EVIDENCE・BUGYO_TITLE）にも入れる。
 * 知らせられなかったことは返すだけで、照合の合否は変えない。
 *
 * @param {import('./tasks.js').Task} task
 * @param {string} command
 * @param {string} cwd
 * @returns {{ ok: boolean, message: string }}
 */
export function notifyVerified(task, command, cwd) {
  const issue = task.issue ?? '';
  const evidence = task['evidence-file'] ?? '';
  if (!safeValue.test(issue) || !safeValue.test(evidence)) return { ok: false, message: `${task.id} の issue か evidence-file に、コマンドに埋め込めない文字があります` };
  const filled = command.replaceAll('{issue}', issue).replaceAll('{task}', task.id).replaceAll('{evidence}', evidence);
  const run = runCommand(filled, cwd, { BUGYO_ISSUE: issue, BUGYO_TASK: task.id, BUGYO_EVIDENCE: evidence, BUGYO_TITLE: task.title });
  return run.status === 0
    ? { ok: true, message: `${task.id} を ${issue} に知らせました` }
    : { ok: false, message: `${task.id} を ${issue} に知らせられませんでした（終了コード ${run.status}）: ${tail(run.output, 5)}` };
}

/**
 * 完了タスクの証拠を取り直し、手順が今も通ることと、ツリーのハッシュが台帳と一致することを確かめる。
 * 証拠ファイルは書き換えない。
 *
 * @param {import('./tasks.js').Task} task
 * @param {import('./index.js').BugyoConfig} config
 * @param {string} cwd
 * @returns {RecheckResult}
 */
export function recheckTask(task, config, cwd) {
  const fail = (/** @type {string} */ reason, output = '') => ({ id: task.id, ok: false, reason, output });
  if (task.status !== 'done') return { id: task.id, ok: true, reason: `${task.status} なので照合しません`, output: '' };
  const file = task['evidence-file'];
  const evidence = file === undefined ? undefined : readEvidence(cwd, file);
  if (file === undefined || evidence === undefined) return fail('証拠ファイルがありません');

  const recorded = Array.isArray(evidence['steps'])
    ? evidence['steps'].map((/** @type {{ command?: unknown }} */ step) => String(step.command))
    : [];
  const expected = requirements(task, config)
    .filter((step) => step.kind === 'command')
    .map((step) => step.command ?? '');
  if (JSON.stringify(recorded) !== JSON.stringify(expected)) {
    return fail(`証拠に記録されたコマンド（${recorded.join(' → ') || 'なし'}）が、今の設定で必要なコマンド（${expected.join(' → ')}）と違います`);
  }

  const outcome = collectEvidence(task, config, cwd, { write: false });
  if (!outcome.ok) return fail(`取り直すと ${outcome.step.label} が通りません: ${outcome.reason}`, outcome.output);
  if (outcome.tree !== task['evidence-tree']) {
    return fail(`今のコードのハッシュ（${outcome.tree}）が evidence-tree（${task['evidence-tree'] ?? 'なし'}）と違います。閉じたあとにコードが変わったか、証拠が手で書かれています`);
  }
  return { id: task.id, ok: true, reason: '手順が通り、ハッシュが一致しました', output: '' };
}
