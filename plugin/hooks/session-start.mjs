/**
 * SessionStart のフック。セッションの始めに、作業中のタスクと着手できるタスクをエージェントに見せる。
 * プロジェクト（.bugyo/tasks のあるフォルダ）か、そこから使える bugyo が見つからなければ何もしない。
 */
import { eventCwd, findProject, hookLocale, parseList, readEvent } from './project.mjs';

/** 見せる着手できるタスクの数 */
const readyLimit = 10;

/**
 * @param {unknown} task
 * @param {{ feature: string }} words
 */
const line = (task, words) => {
  const record = /** @type {Record<string, unknown>} */ (task);
  const feature = typeof record.feature === 'string' && record.feature !== '' ? `  ${words.feature}: ${record.feature}` : '';
  return `- ${String(record.id)} [${String(record.type)}] ${String(record.title)}${feature}`;
};

const text = {
  en: {
    feature: 'feature',
    assignee: 'assignee',
    intro: (/** @type {string} */ root) => `This project (${root}) manages its work in the bugyo task ledger (.bugyo/tasks).`,
    active: 'Active tasks:',
    ready: 'Ready tasks:',
    more: (/** @type {number} */ count) => `\n(${count} more. See them all with bugyo task ready)`,
    none: 'There are no active or ready tasks.',
    how: 'Start with bugyo task start <id> --as <name>, read with bugyo task show <id>, and finish with bugyo task done <id> (only done decides that a task is complete).',
  },
  ja: {
    feature: '機能',
    assignee: '担当',
    intro: (/** @type {string} */ root) => `このプロジェクト（${root}）は、仕事を bugyo のタスク台帳（.bugyo/tasks）で管理しています。`,
    active: '作業中のタスク:',
    ready: '着手できるタスク:',
    more: (/** @type {number} */ count) => `\n（ほか ${count}件。bugyo task ready で全部見られます）`,
    none: '作業中のタスクも、着手できるタスクもありません。',
    how: '着手は bugyo task start <id> --as <名前>、内容は bugyo task show <id>、完了は bugyo task done <id> です（完了を決めるのは done だけです）。',
  },
};

/**
 * @param {{ cwd?: unknown }} event
 * @returns {string | undefined} エージェントに渡す文
 */
export function sessionContext(event) {
  const project = findProject(eventCwd(event));
  if (project === undefined) return undefined;
  const words = text[hookLocale(project.root)];
  const active = parseList(project.run(['task', 'ls', '--json']).stdout).filter(
    (task) => typeof task === 'object' && task !== null && 'status' in task && task.status === 'active',
  );
  const ready = parseList(project.run(['task', 'ready', '--json']).stdout);
  const sections = [words.intro(project.root)];
  if (active.length > 0) {
    const lines = active.map((task) => `${line(task, words)}  ${words.assignee}: ${String(/** @type {Record<string, unknown>} */ (task).assignee)}`);
    sections.push(`${words.active}\n${lines.join('\n')}`);
  }
  if (ready.length > 0) {
    const more = ready.length > readyLimit ? words.more(ready.length - readyLimit) : '';
    sections.push(`${words.ready}\n${ready
      .slice(0, readyLimit)
      .map((task) => line(task, words))
      .join('\n')}${more}`);
  }
  if (active.length === 0 && ready.length === 0) sections.push(words.none);
  sections.push(words.how);
  return sections.join('\n\n');
}

const event = await readEvent();
const context = event === undefined ? undefined : sessionContext(event);
if (context !== undefined) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
}
