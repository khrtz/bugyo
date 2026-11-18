/**
 * Stop のフック。エージェントが作業を終える前に bugyo task lint を実行し、落ちたら終わらせずに理由を返す。
 * 台帳の誤り（証拠のない完了、読めない frontmatter など）を、pnpm check を待たずにその場で見つける。
 * 2回目の Stop（stop_hook_active）では止めないので、直せない誤りでも終わらせられなくなることはない。
 * プロジェクト（.bugyo/tasks のあるフォルダ）か、そこから使える bugyo が見つからなければ何もしない。
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

/**
 * @param {{ cwd?: unknown, stop_hook_active?: unknown }} event
 * @returns {string | undefined} 終わらせない理由
 */
export function stopReason(event) {
  if (event.stop_hook_active === true) return undefined;
  const cwd = typeof event.cwd === 'string' ? event.cwd : process.cwd();
  const project = findUp(cwd, (dir) => existsSync(join(dir, '.bugyo', 'tasks')));
  if (project === undefined) return undefined;
  const home = findUp(project, (dir) => existsSync(join(dir, 'node_modules', 'bugyo', 'bin', 'bugyo.js')));
  if (home === undefined) return undefined;
  const run = spawnSync(process.execPath, [join(home, 'node_modules', 'bugyo', 'bin', 'bugyo.js'), 'task', 'lint'], { cwd: project, encoding: 'utf8', timeout: 60_000 });
  if (run.status === 0) return undefined;
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-20).join('\n');
  return `bugyo task lint が落ちました（${project}）。下のエラーを直してから終えてください。状態の項目は手で書き換えず、bugyo task start / done / rework / drop を使ってください。\n${output}`;
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let event;
try {
  event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  process.exit(0);
}
const reason = stopReason(event ?? {});
if (reason !== undefined) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
