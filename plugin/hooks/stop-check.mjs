/**
 * Stop のフック。エージェントが作業を終える前に bugyo task lint を実行し、落ちたら終わらせずに理由を返す。
 * 台帳の誤り（証拠のない完了、読めない frontmatter など）を、pnpm check を待たずにその場で見つける。
 * 2回目の Stop（stop_hook_active）では止めないので、直せない誤りでも終わらせられなくなることはない。
 * 台帳が正しく、作業中（active）のタスクが残っていれば、止めずに人へ知らせる。
 * プロジェクト（.bugyo/tasks のあるフォルダ）か、そこから使える bugyo が見つからなければ何もしない。
 */
import { eventCwd, findProject, hookLocale, parseList, readEvent } from './project.mjs';

/**
 * @param {{ cwd?: unknown, stop_hook_active?: unknown }} event
 * @returns {{ decision: 'block', reason: string } | { systemMessage: string } | undefined}
 */
export function stopOutput(event) {
  const project = findProject(eventCwd(event));
  if (project === undefined) return undefined;
  const ja = hookLocale(project.root) === 'ja';
  if (event.stop_hook_active !== true) {
    const lint = project.run(['task', 'lint']);
    if (lint.status !== 0) {
      const output = `${lint.stdout}${lint.stderr}`.trim().split('\n').slice(-20).join('\n');
      return {
        decision: 'block',
        reason: ja
          ? `bugyo task lint が落ちました（${project.root}）。下のエラーを直してから終えてください。状態の項目は手で書き換えず、bugyo task start / done / rework / drop を使ってください。\n${output}`
          : `bugyo task lint failed (${project.root}). Fix the errors below before you finish. Do not edit the status fields by hand; use bugyo task start / done / rework / drop.\n${output}`,
      };
    }
  }
  const active = parseList(project.run(['task', 'ls', '--json']).stdout).filter(
    (task) => typeof task === 'object' && task !== null && 'status' in task && task.status === 'active',
  );
  if (active.length === 0) return undefined;
  const lines = active.map((task) =>
    ja ? `${String(task.id)} ${String(task.title)}（担当: ${String(task.assignee)}）` : `${String(task.id)} ${String(task.title)} (assignee: ${String(task.assignee)})`,
  );
  return {
    systemMessage: ja
      ? `作業中のタスクが ${active.length}件残っています。終えたなら bugyo task done <id>、やめるなら bugyo task drop <id> -r "<理由>" を実行してください。\n${lines.join('\n')}`
      : `${active.length} active tasks remain. Run bugyo task done <id> if you finished, or bugyo task drop <id> -r "<reason>" to stop.\n${lines.join('\n')}`,
  };
}

const event = await readEvent();
const output = event === undefined ? undefined : stopOutput(event);
if (output !== undefined) process.stdout.write(JSON.stringify(output));
