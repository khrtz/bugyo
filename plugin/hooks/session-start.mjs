/**
 * SessionStart のフック。セッションの始めに、作業中のタスクと着手できるタスクをエージェントに見せる。
 * プロジェクト（.bugyo/tasks のあるフォルダ）か、そこから使える bugyo が見つからなければ何もしない。
 */
import { eventCwd, findProject, parseList, readEvent } from './project.mjs';

/** 見せる着手できるタスクの数 */
const readyLimit = 10;

/** @param {unknown} task */
const line = (task) => {
  const record = /** @type {Record<string, unknown>} */ (task);
  const feature = typeof record.feature === 'string' && record.feature !== '' ? `  機能: ${record.feature}` : '';
  return `- ${String(record.id)} [${String(record.type)}] ${String(record.title)}${feature}`;
};

/**
 * @param {{ cwd?: unknown }} event
 * @returns {string | undefined} エージェントに渡す文
 */
export function sessionContext(event) {
  const project = findProject(eventCwd(event));
  if (project === undefined) return undefined;
  const active = parseList(project.run(['task', 'ls', '--json']).stdout).filter(
    (task) => typeof task === 'object' && task !== null && 'status' in task && task.status === 'active',
  );
  const ready = parseList(project.run(['task', 'ready', '--json']).stdout);
  const sections = [`このプロジェクト（${project.root}）は、仕事を bugyo のタスク台帳（.bugyo/tasks）で管理しています。`];
  if (active.length > 0) {
    sections.push(`作業中のタスク:\n${active.map((task) => `${line(task)}  担当: ${String(/** @type {Record<string, unknown>} */ (task).assignee)}`).join('\n')}`);
  }
  if (ready.length > 0) {
    const more = ready.length > readyLimit ? `\n（ほか ${ready.length - readyLimit}件。bugyo task ready で全部見られます）` : '';
    sections.push(`着手できるタスク:\n${ready.slice(0, readyLimit).map(line).join('\n')}${more}`);
  }
  if (active.length === 0 && ready.length === 0) sections.push('作業中のタスクも、着手できるタスクもありません。');
  sections.push('着手は bugyo task start <id> --as <名前>、内容は bugyo task show <id>、完了は bugyo task done <id> です（完了を決めるのは done だけです）。');
  return sections.join('\n\n');
}

const event = await readEvent();
const context = event === undefined ? undefined : sessionContext(event);
if (context !== undefined) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
}
