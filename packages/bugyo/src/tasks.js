import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { tr } from './locale.js';

export const tasksDir = '.bugyo/tasks';
export const archiveDir = `${tasksDir}/archive`;
export const evidenceDir = '.bugyo/evidence';

export const statuses = /** @type {const} */ (['open', 'active', 'done', 'dropped']);
export const types = /** @type {const} */ (['feature', 'ui-flow', 'ui-look', 'logic', 'bugfix', 'refactor', 'chore']);
/** 証拠に機能の verify か model/ が要るので、add で --feature を必須にする種類 */
export const typesNeedingFeature = new Set(['feature', 'ui-flow', 'ui-look', 'logic']);

const idPattern = /^t-\d{3,}$/;
/**
 * 課題の参照（`123`、`PROJ-45`、URL）。通知のコマンドにそのまま埋め込むので、シェルで意味を持つ文字は使えない。
 * 先頭は英数字に限る（先頭の `#` はシェルでコメントに、`-` はオプションになるため）
 */
export const issuePattern = /^[A-Za-z0-9][A-Za-z0-9#._:/-]*$/;
/** 作業したモデルとハーネスの名前（`model-a`、`cli` など）。frontmatter の1行に収まる文字だけ */
export const agentNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const count = z
  .string()
  .regex(/^\d+$/, { error: () => tr({ en: 'must be an integer of 0 or more', ja: '0 以上の整数にしてください' }) })
  .transform((value) => Number(value));

/** frontmatter に書ける項目。順番は書き出すときの順番 */
const Fields = z
  .object({
    status: z.enum(statuses),
    type: z.enum(types),
    feature: z.string().default(''),
    issue: z
      .string()
      .regex(issuePattern, { error: () => tr({ en: 'must start with a letter or digit and use only letters, digits, and # . _ : / -', ja: '英数字で始め、英数字と # . _ : / - だけにしてください' }) })
      .optional(),
    'blocked-by': z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== ''),
      )
      .refine((ids) => ids.every((id) => idPattern.test(id)), { error: () => tr({ en: 'list ids like t-001, separated by commas', ja: 't-001 の形の id をカンマで区切ってください' }) }),
    assignee: z.string().default(''),
    model: z.string().regex(agentNamePattern, { error: () => tr({ en: 'must start with a letter or digit and use only letters, digits, and . _ : / @ + -', ja: '英数字で始め、英数字と . _ : / @ + - だけにしてください' }) }).optional(),
    harness: z.string().regex(agentNamePattern, { error: () => tr({ en: 'must start with a letter or digit and use only letters, digits, and . _ : / @ + -', ja: '英数字で始め、英数字と . _ : / @ + - だけにしてください' }) }).optional(),
    rework: count.default(0),
    'gate-attempts': count.default(0),
    created: z.string().default(''),
    'tests-hash': z.string().optional(),
    repro: z.string().optional(),
    'repro-at': z.string().optional(),
    'repro-status': count.optional(),
    'repro-tests-hash': z.string().optional(),
    'repro-log': z.string().optional(),
    'repro-expect': z.string().optional(),
    'drop-reason': z.string().optional(),
    'dropped-at': z.string().optional(),
    'evidence-file': z.string().optional(),
    'evidence-tree': z.string().optional(),
    'evidence-at': z.string().optional(),
  })
  .strict();

/**
 * @typedef {z.output<typeof Fields>} TaskFields
 * @typedef {TaskFields & { id: string, title: string, body: string, file: string, archived: boolean }} Task
 */

/** @param {string} id */
export function isTaskId(id) {
  return idPattern.test(id);
}

/**
 * @param {string} cwd
 * @param {string} file cwd からの相対パス
 * @returns {Task}
 */
function readTask(cwd, file) {
  const id = file.split('/').pop()?.replace(/\.md$/, '') ?? '';
  const { fields, body } = parseFrontmatter(file, readFileSync(join(cwd, file), 'utf8'));
  const parsed = Fields.safeParse(fields);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ');
    throw new Error(tr({ en: `${file}: invalid frontmatter: ${issues}`, ja: `${file}: frontmatter が不正です: ${issues}` }));
  }
  const title = /^# (.+)$/m.exec(body)?.[1]?.trim() ?? '';
  return { ...parsed.data, id, title, body, file, archived: file.startsWith(`${archiveDir}/`) };
}

/**
 * @param {string} cwd
 * @param {string} dir
 */
function taskFiles(cwd, dir) {
  const full = join(cwd, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

/**
 * 台帳を読む。読めないファイルは errors に入れ、読めたものだけを返す。
 *
 * @param {string} [cwd]
 * @returns {{ tasks: Task[], errors: string[] }}
 */
export function readLedger(cwd = process.cwd()) {
  const tasks = [];
  const errors = [];
  for (const file of [...taskFiles(cwd, tasksDir), ...taskFiles(cwd, archiveDir)]) {
    try {
      tasks.push(readTask(cwd, file));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { tasks, errors };
}

/**
 * 台帳を読む。読めないファイルがあれば断る。
 *
 * @param {string} [cwd]
 */
export function loadTasks(cwd = process.cwd()) {
  const { tasks, errors } = readLedger(cwd);
  if (errors.length > 0) throw new Error(`${tr({ en: 'Cannot read the ledger (check it with bugyo task lint):', ja: '台帳を読めません（bugyo task lint で確かめてください）:' })}\n${errors.join('\n')}`);
  return tasks;
}

/**
 * @param {Task[]} tasks
 * @param {string} id
 */
export function findTask(tasks, id) {
  const task = tasks.find((candidate) => candidate.id === id);
  if (task === undefined) throw new Error(tr({ en: `There is no task ${id}`, ja: `タスク ${id} はありません` }));
  return task;
}

/** @param {Task[]} tasks */
export function nextTaskId(tasks) {
  const max = tasks.reduce((highest, task) => Math.max(highest, Number(task.id.slice(2))), 0);
  return `t-${String(max + 1).padStart(3, '0')}`;
}

/**
 * タスクを書き、状態に合った場所（open / active は tasks、done / dropped は archive）に置く。
 *
 * @param {string} cwd
 * @param {Task} task
 * @returns {Task}
 */
export function saveTask(cwd, task) {
  const archived = task.status === 'done' || task.status === 'dropped';
  const file = `${archived ? archiveDir : tasksDir}/${task.id}.md`;
  /** @type {Record<string, string | number | undefined>} */
  const fields = {
    status: task.status,
    type: task.type,
    feature: task.feature,
    issue: task.issue,
    'blocked-by': task['blocked-by'].join(','),
    assignee: task.assignee,
    model: task.model,
    harness: task.harness,
    rework: task.rework,
    'gate-attempts': task['gate-attempts'],
    created: task.created,
    'tests-hash': task['tests-hash'],
    repro: task.repro,
    'repro-at': task['repro-at'],
    'repro-status': task['repro-status'],
    'repro-tests-hash': task['repro-tests-hash'],
    'repro-log': task['repro-log'],
    'repro-expect': task['repro-expect'],
    'drop-reason': task['drop-reason'],
    'dropped-at': task['dropped-at'],
    'evidence-file': task['evidence-file'],
    'evidence-tree': task['evidence-tree'],
    'evidence-at': task['evidence-at'],
  };
  mkdirSync(join(cwd, archived ? archiveDir : tasksDir), { recursive: true });
  writeFileSync(join(cwd, file), stringifyFrontmatter(fields, task.body));
  if (task.file !== '' && task.file !== file && existsSync(join(cwd, task.file))) rmSync(join(cwd, task.file));
  return { ...task, file, archived };
}

/**
 * @param {Task} task
 * @param {Task[]} tasks
 * @returns {string[]} まだ done になっていない blocked-by の id
 */
export function openBlockers(task, tasks) {
  return task['blocked-by'].filter((id) => tasks.find((candidate) => candidate.id === id)?.status !== 'done');
}

/** @param {Task} task */
export function taskLine(task) {
  const extras = [
    task.feature === '' ? '' : tr({ en: 'feature: ', ja: '機能: ' }) + task.feature,
    task.issue === undefined ? '' : tr({ en: 'issue: ', ja: '課題: ' }) + task.issue,
    task.assignee === '' ? '' : tr({ en: 'assignee: ', ja: '担当: ' }) + task.assignee,
    task['blocked-by'].length === 0 ? '' : tr({ en: 'blocked by: ', ja: '待ち: ' }) + task['blocked-by'].join(','),
  ].filter((extra) => extra !== '');
  return `${task.id} [${task.status}/${task.type}] ${task.title}${extras.length === 0 ? '' : `  (${extras.join(', ')})`}`;
}

/** @param {Task} task */
export function taskJson(task) {
  return {
    id: task.id,
    status: task.status,
    type: task.type,
    title: task.title,
    feature: task.feature,
    ...(task.issue === undefined ? {} : { issue: task.issue }),
    assignee: task.assignee,
    ...(task.model === undefined ? {} : { model: task.model }),
    ...(task.harness === undefined ? {} : { harness: task.harness }),
    blockedBy: task['blocked-by'],
    rework: task.rework,
    gateAttempts: task['gate-attempts'],
  };
}
