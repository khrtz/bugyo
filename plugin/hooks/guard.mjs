/**
 * PreToolUse のフック。完了の判定を決めるファイルを、エージェントが直接書き換えるのを断る。
 * 設定・証拠・ベースラインは人か bugyo のコマンドが書くもの、タスク台帳の状態の項目は bugyo task が書くもの。
 * 標準入力にツールの呼び出し（JSON）を受け取り、断るときだけ理由を JSON で返す。
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** CLI だけが書く、タスク台帳の frontmatter の項目 */
const managedField = /^(status|assignee|model|harness|rework|gate-attempts|tests-hash|repro(-[a-z]+)?|drop-reason|dropped-at|evidence-[a-z]+)\s*:/m;

const rules = [
  {
    path: /(^|\/)\.bugyo\/config\.json$/,
    reason: '.bugyo/config.json は、task done が実行するコマンドと門番のしきい値を決めるファイルなので、変えるのは人だけです。変えたいときは、変更案と理由をユーザーに伝えてください',
  },
  {
    path: /(^|\/)\.bugyo\/evidence\//,
    reason: '証拠ファイルは bugyo task done だけが書きます。完了させるには bugyo task done <id> を実行してください',
  },
  {
    path: /(^|\/)(\.bugyo\/baseline\.json|eslint-suppressions\.json|\.dependency-cruiser-known-violations\.json)$/,
    reason: 'ベースラインは違反を直して減らすものです。手で書き換えず、違反を直してから bugyo baseline save を実行してください（増やすのは人が確かめてからです）',
  },
];

/**
 * コマンドの中の、守るファイルのパス。リダイレクトは、行き先がこのパスのときだけ書き換えとみなす
 * （PR の本文などの文の中に、パスと `<名前>` の `>` が一緒に出てくるだけでは断らない）
 */
const protectedInCommand = String.raw`\.bugyo/(config\.json|evidence/|baseline\.json|tasks/)|eslint-suppressions\.json|dependency-cruiser-known-violations`;

const taskFile =/(^|\/)\.bugyo\/tasks\/.+\.md$/;
const taskReason =
  'タスク台帳の状態の項目（status・assignee・rework・gate-attempts・repro・evidence など）は bugyo task のコマンドだけが書きます。bugyo task start / done / rework / drop を使ってください';

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
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = normalize(String(input.command ?? ''));
    const touches = new RegExp(protectedInCommand).test(command);
    const redirects = new RegExp(`(^|[^0-9&>])>{1,2}(?!&)\\s*["']?[^\\s"'|;&<>]*(${protectedInCommand})`).test(command);
    const writes = /\btee\b|\bsed\s+(-[a-zA-Z]*i|--in-place)|\b(rm|mv|cp|truncate)\s|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item/.test(command);
    return redirects || (touches && writes)
      ? 'コマンドで、完了の判定を決めるファイル（.bugyo/config.json・証拠・ベースライン・タスク台帳）を書き換えようとしています。設定は人が変えるものです。証拠・ベースライン・台帳は bugyo task と bugyo baseline のコマンドで変えてください'
      : undefined;
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
    if (!existsSync(full)) return 'タスクは bugyo task add で作ってください（id の割り当てと着手の記録を CLI が持つため）';
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
