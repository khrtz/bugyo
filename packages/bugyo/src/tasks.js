import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';

export const tasksDir = '.bugyo/tasks';
export const archiveDir = `${tasksDir}/archive`;
export const evidenceDir = '.bugyo/evidence';

export const statuses = /** @type {const} */ (['open', 'active', 'done', 'dropped']);
export const types = /** @type {const} */ (['feature', 'ui-flow', 'ui-look', 'logic', 'bugfix', 'refactor', 'chore']);
/** 証拠に機能の verify か model/ が要るので、add で --feature を必須にする種類 */
export const typesNeedingFeature = new Set(['feature', 'ui-flow', 'ui-look', 'logic']);

const idPattern = /^t-\d{3,}$/;
const count = z
  .string()
  .regex(/^\d+$/, '0 以上の整数にしてください')
  .transform((value) => Number(value));

/** frontmatter に書ける項目。順番は書き出すときの順番 */
const Fields = z
  .object({
    status: z.enum(statuses),
    type: z.enum(types),
    feature: z.string().default(''),
    'blocked-by': z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== ''),
      )
      .refine((ids) => ids.every((id) => idPattern.test(id)), 't-001 の形の id をカンマで区切ってください'),
    assignee: z.string().default(''),
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
  if (!parsed.success) throw new Error(`${file}: frontmatter が不正です: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
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
  if (errors.length > 0) throw new Error(`台帳を読めません（bugyo task lint で確かめてください）:\n${errors.join('\n')}`);
  return tasks;
}

/**
 * @param {Task[]} tasks
 * @param {string} id
 */
export function findTask(tasks, id) {
  const task = tasks.find((candidate) => candidate.id === id);
  if (task === undefined) throw new Error(`タスク ${id} はありません`);
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
    'blocked-by': task['blocked-by'].join(','),
    assignee: task.assignee,
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
    task.feature === '' ? '' : `機能: ${task.feature}`,
    task.assignee === '' ? '' : `担当: ${task.assignee}`,
    task['blocked-by'].length === 0 ? '' : `待ち: ${task['blocked-by'].join(',')}`,
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
    assignee: task.assignee,
    blockedBy: task['blocked-by'],
    rework: task.rework,
    gateAttempts: task['gate-attempts'],
  };
}
