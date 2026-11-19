/**
 * フックが使う、プロジェクトと bugyo の CLI の探し方。
 * プロジェクトは .bugyo/tasks のあるフォルダ、CLI はそこから上へたどって最初に見つかる node_modules/bugyo。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * start から上へたどり、条件に合う最初のフォルダを返す。
 *
 * @param {string} start
 * @param {(dir: string) => boolean} found
 */
function findUp(start, found) {
  let dir = start;
  for (;;) {
    if (found(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** @param {string} dir */
const cliPath = (dir) => join(dir, 'node_modules', 'bugyo', 'bin', 'bugyo.js');

/**
 * @param {string} cwd
 * @returns {{ root: string, run: (args: string[]) => { status: number | null, stdout: string, stderr: string } } | undefined}
 */
export function findProject(cwd) {
  const root = findUp(cwd, (dir) => existsSync(join(dir, '.bugyo', 'tasks')));
  if (root === undefined) return undefined;
  const home = findUp(root, (dir) => existsSync(cliPath(dir)));
  if (home === undefined) return undefined;
  return {
    root,
    run: (args) => {
      const result = spawnSync(process.execPath, [cliPath(home), ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
      return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    },
  };
}

/** 標準入力の JSON を読む。読めなければ undefined */
export async function readEvent() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof event === 'object' && event !== null ? event : undefined;
  } catch {
    return undefined;
  }
}

/** @param {{ cwd?: unknown }} event */
export const eventCwd = (event) => (typeof event.cwd === 'string' ? event.cwd : process.cwd());

/**
 * JSON の行の配列を読む。読めなければ空
 *
 * @param {string} text
 * @returns {unknown[]}
 */
export function parseList(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
