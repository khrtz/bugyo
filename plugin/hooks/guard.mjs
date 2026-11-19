/**
 * PreToolUse のフック。完了の判定を決めるファイルを、エージェントが直接書き換えるのを断る。
 * 設定・証拠・ベースラインは人か bugyo のコマンドが書くもの、タスク台帳の状態の項目は bugyo task が書くもの。
 * 標準入力にツールの呼び出し（JSON）を受け取り、断るときだけ理由を JSON で返す。
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { hookLocale } from './project.mjs';

/** CLI だけが書く、タスク台帳の frontmatter の項目 */
const managedField = /^(status|assignee|model|harness|cost-tokens|cost-usd|rework|gate-attempts|tests-hash|repro(-[a-z]+)?|drop-reason|dropped-at|evidence-[a-z]+)\s*:/m;

const rules = [
  {
    path: /(^|\/)\.bugyo\/config\.json$/,
    reason: {
      en: '.bugyo/config.json decides the commands task done runs and the gate thresholds, so only a person changes it. To change it, tell the user the change and why',
      ja: '.bugyo/config.json は、task done が実行するコマンドと門番のしきい値を決めるファイルなので、変えるのは人だけです。変えたいときは、変更案と理由をユーザーに伝えてください',
    },
  },
  {
    path: /(^|\/)\.bugyo\/evidence\//,
    reason: {
      en: 'Only bugyo task done writes evidence files. To finish a task, run bugyo task done <id>',
      ja: '証拠ファイルは bugyo task done だけが書きます。完了させるには bugyo task done <id> を実行してください',
    },
  },
  {
    path: /(^|\/)(\.bugyo\/baseline\.json|eslint-suppressions\.json|\.dependency-cruiser-known-violations\.json)$/,
    reason: {
      en: 'A baseline only shrinks as violations are fixed. Do not edit it by hand; fix the violations, then run bugyo baseline save (growing it needs a person to check first)',
      ja: 'ベースラインは違反を直して減らすものです。手で書き換えず、違反を直してから bugyo baseline save を実行してください（増やすのは人が確かめてからです）',
    },
  },
];

/**
 * コマンドの中の、守るファイルのパス。リダイレクトは、行き先がこのパスのときだけ書き換えとみなす
 * （PR の本文などの文の中に、パスと `<名前>` の `>` が一緒に出てくるだけでは断らない）
 */
const protectedInCommand = String.raw`\.bugyo/(config\.json|evidence/|baseline\.json|tasks/)|eslint-suppressions\.json|dependency-cruiser-known-violations`;

const taskFile =/(^|\/)\.bugyo\/tasks\/.+\.md$/;
const taskReason = {
  en: 'Only the bugyo task commands write the status fields of the task ledger (status, assignee, rework, gate-attempts, repro, evidence, ...). Use bugyo task start / done / rework / drop',
  ja: 'タスク台帳の状態の項目（status・assignee・rework・gate-attempts・repro・evidence など）は bugyo task のコマンドだけが書きます。bugyo task start / done / rework / drop を使ってください',
};

const commandReason = {
  en: 'This command would rewrite a file that decides completion (.bugyo/config.json, evidence, baselines, the task ledger). A person changes the config. Change evidence, baselines, and the ledger with the bugyo task and bugyo baseline commands',
  ja: 'コマンドで、完了の判定を決めるファイル（.bugyo/config.json・証拠・ベースライン・タスク台帳）を書き換えようとしています。設定は人が変えるものです。証拠・ベースライン・台帳は bugyo task と bugyo baseline のコマンドで変えてください',
};

const newTaskReason = {
  en: 'Create tasks with bugyo task add (the CLI owns id assignment and claims)',
  ja: 'タスクは bugyo task add で作ってください（id の割り当てと着手の記録を CLI が持つため）',
};

/** @param {string} path */
const normalize = (path) => path.replaceAll('\\', '/');

/** @param {string} text */
const managedLines = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => managedField.test(line))
    .join('\n');

/**
 * @param {string} toolName
 * @param {Record<string, any>} input
 * @param {string} cwd
 * @returns {string | undefined} 断る理由
 */
export function denyReason(toolName, input, cwd) {
  const reason = denyText(toolName, input, cwd);
  return reason === undefined ? undefined : reason[hookLocale(cwd)];
}

/**
 * @param {string} toolName
 * @param {Record<string, any>} input
 * @param {string} cwd
 * @returns {{ en: string, ja: string } | undefined}
 */
function denyText(toolName, input, cwd) {
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = normalize(String(input.command ?? ''));
    const touches = new RegExp(protectedInCommand).test(command);
    const redirects = new RegExp(`(^|[^0-9&>])>{1,2}(?!&)\\s*["']?[^\\s"'|;&<>]*(${protectedInCommand})`).test(command);
    const writes = /\btee\b|\bsed\s+(-[a-zA-Z]*i|--in-place)|\b(rm|mv|cp|truncate)\s|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item/.test(command);
    return redirects || (touches && writes) ? commandReason : undefined;
  }
  const filePath = typeof input.file_path === 'string' ? normalize(input.file_path) : undefined;
  if (filePath === undefined) return undefined;
  const rule = rules.find((candidate) => candidate.path.test(filePath));
  if (rule !== undefined) return rule.reason;
  if (!taskFile.test(filePath)) return undefined;
  if (toolName === 'Edit') return managedField.test(`${input.old_string ?? ''}\n${input.new_string ?? ''}`) ? taskReason : undefined;
  if (toolName === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    return edits.some((edit) => managedField.test(`${edit.old_string ?? ''}\n${edit.new_string ?? ''}`)) ? taskReason : undefined;
  }
  if (toolName === 'Write') {
    const full = isAbsolute(filePath) ? filePath : join(cwd, filePath);
    if (!existsSync(full)) return newTaskReason;
    return managedLines(readFileSync(full, 'utf8')) === managedLines(String(input.content ?? '')) ? undefined : taskReason;
  }
  return undefined;
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let event;
try {
  event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  process.exit(0);
}
const reason = denyReason(String(event.tool_name ?? ''), event.tool_input ?? {}, String(event.cwd ?? process.cwd()));
if (reason !== undefined) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}
