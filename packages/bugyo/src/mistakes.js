import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { tr } from './locale.js';

export const mistakesDir = '.bugyo/mistakes';

const kindPattern = /^[a-z0-9][a-z0-9-]*$/;
/** ルールの名前（禁止の名前、ルール ID、テストの名前など）。一覧の1行に書くので空白は使えない */
const ruleNamePattern = /^[A-Za-z0-9@][A-Za-z0-9@._:/-]*$/;
const count = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number(value));

const Fields = z
  .object({
    count: count,
    rule: z.string().default(''),
    'rule-name': z.string().regex(ruleNamePattern).optional(),
    'ruled-count': count.optional(),
  })
  .strict();

/**
 * @typedef {{ kind: string, count: number, rule: string, ruleName: string | undefined, ruledCount: number | undefined, body: string, file: string }} Mistake
 * @typedef {'leak' | 'unruled' | 'ruled' | 'once'} MistakeState
 */

/** @param {string} kind */
export function isMistakeKind(kind) {
  return kindPattern.test(kind);
}

/**
 * @param {string} [cwd]
 * @returns {Mistake[]}
 */
export function loadMistakes(cwd = process.cwd()) {
  const dir = join(cwd, mistakesDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const file = `${mistakesDir}/${name}`;
      const { fields, body } = parseFrontmatter(file, readFileSync(join(dir, name), 'utf8'));
      const parsed = Fields.safeParse(fields);
      if (!parsed.success) throw new Error(tr({ en: `${file}: invalid frontmatter: ${parsed.error.message}`, ja: `${file}: frontmatter が不正です: ${parsed.error.message}` }));
      return { kind: name.replace(/\.md$/, ''), count: parsed.data.count, rule: parsed.data.rule, ruleName: parsed.data['rule-name'], ruledCount: parsed.data['ruled-count'], body, file };
    });
}

/**
 * ルール化したあとにまた起きた（leak）、2回以上起きてまだルールがない（unruled）、ルール化済み（ruled）、1回だけ（once）。
 *
 * @param {Mistake} mistake
 * @returns {MistakeState}
 */
export function mistakeState(mistake) {
  if (mistake.rule !== '') return mistake.count > (mistake.ruledCount ?? 0) ? 'leak' : 'ruled';
  return mistake.count >= 2 ? 'unruled' : 'once';
}

const stateOrder = { leak: 0, unruled: 1, ruled: 2, once: 3 };

/** @param {Mistake[]} mistakes */
export function sortMistakes(mistakes) {
  return [...mistakes].sort((a, b) => stateOrder[mistakeState(a)] - stateOrder[mistakeState(b)] || b.count - a.count || a.kind.localeCompare(b.kind));
}

/**
 * @param {string} cwd
 * @param {Mistake} mistake
 */
function save(cwd, mistake) {
  mkdirSync(join(cwd, mistakesDir), { recursive: true });
  writeFileSync(
    join(cwd, mistake.file),
    stringifyFrontmatter({ count: mistake.count, rule: mistake.rule, 'rule-name': mistake.ruleName, 'ruled-count': mistake.ruledCount }, mistake.body),
  );
}

/**
 * 手直しを1回記録する。その種類のファイルがなければ作る。
 *
 * @param {string} cwd
 * @param {string} kind
 * @param {{ task: string, reason: string, day: string }} entry
 * @returns {Mistake}
 */
export function recordMistake(cwd, kind, entry) {
  const existing = loadMistakes(cwd).find((mistake) => mistake.kind === kind);
  const base = existing ?? { kind, count: 0, rule: '', ruleName: undefined, ruledCount: undefined, body: `\n# ${kind}\n\n`, file: `${mistakesDir}/${kind}.md` };
  const body = `${base.body.trimEnd()}\n${base.body.includes('\n- ') ? '' : '\n'}- ${entry.task}（${entry.day}）: ${entry.reason}\n`;
  const mistake = { ...base, count: base.count + 1, body };
  save(cwd, mistake);
  return mistake;
}

/**
 * ルールに変えたことを記録する。ルールを書いたファイルが実在しなければ断る。
 *
 * @param {string} cwd
 * @param {string} kind
 * @param {string} at
 * @param {string} [name] ルールの名前（禁止の名前、ルール ID、テストの名前など）
 * @returns {Mistake}
 */
export function recordRule(cwd, kind, at, name) {
  const mistake = loadMistakes(cwd).find((candidate) => candidate.kind === kind);
  if (mistake === undefined) throw new Error(tr({ en: `The mistake kind ${kind} has not been recorded`, ja: `ミスの種類 ${kind} はまだ記録されていません` }));
  if (!existsSync(join(cwd, at))) throw new Error(tr({ en: `${at} does not exist. Pass the file that holds the rule to --at`, ja: `${at} がありません。ルールを書いたファイルを --at に渡してください` }));
  if (name !== undefined && !ruleNamePattern.test(name)) throw new Error(tr({ en: `The rule name ${name} must start with a letter, digit, or @ and use only letters, digits, and @ . _ : / -`, ja: `ルールの名前 ${name} は、英数字か @ で始め、英数字と @ . _ : / - だけにしてください` }));
  const ruled = { ...mistake, rule: at.split('\\').join('/'), ruleName: name, ruledCount: mistake.count };
  save(cwd, ruled);
  return ruled;
}

/** @param {Mistake} mistake */
export function mistakeLine(mistake) {
  const state = mistakeState(mistake);
  const where = mistake.ruleName === undefined ? mistake.rule : `${mistake.ruleName}（${mistake.rule}）`;
  const ruled = String(mistake.ruledCount ?? 0);
  const rule =
    mistake.rule === ''
      ? tr({ en: 'rule: none', ja: 'ルール: なし' })
      : tr({ en: `rule: ${where}  ${ruled} when ruled`, ja: `ルール: ${where}  ルール化のとき ${ruled}回` });
  const note = {
    leak: tr({ en: '  ← the rule leaks (it happened again after the rule)', ja: '  ← ルールが漏れている（ルール化のあとにまた起きた）' }),
    unruled: tr({ en: '  ← needs a rule', ja: '  ← ルール化が必要' }),
    ruled: '',
    once: '',
  }[state];
  return `${mistake.kind} ${tr({ en: `${mistake.count}x`, ja: `${mistake.count}回` })}  ${rule}${note}`;
}

/**
 * ミスの種類を状態ごとに数える。ルール化済み（ruled）には、ルール化のあとにまた起きたもの（leak）も入る。
 *
 * @param {Mistake[]} mistakes
 */
export function mistakeSummary(mistakes) {
  const states = mistakes.map(mistakeState);
  const counted = (/** @type {MistakeState[]} */ ...wanted) => states.filter((state) => wanted.includes(state)).length;
  return { kinds: mistakes.length, ruled: counted('ruled', 'leak'), leak: counted('leak'), unruled: counted('unruled'), once: counted('once') };
}

/** @param {ReturnType<typeof mistakeSummary>} summary */
export function mistakeSummaryLine(summary) {
  return tr({
    en: `mistakes: ${summary.kinds} kinds  ruled ${summary.ruled} (rule leaks: ${summary.leak})  needs a rule ${summary.unruled}  once ${summary.once}`,
    ja: `ミス ${summary.kinds}種類  ルール化済み ${summary.ruled}種類（うちルールが漏れている ${summary.leak}種類）  ルール化が必要 ${summary.unruled}種類  1回だけ ${summary.once}種類`,
  });
}

/** @param {Mistake} mistake */
export function mistakeJson(mistake) {
  return {
    kind: mistake.kind,
    count: mistake.count,
    rule: mistake.rule,
    ...(mistake.ruleName === undefined ? {} : { ruleName: mistake.ruleName }),
    ...(mistake.ruledCount === undefined ? {} : { ruledCount: mistake.ruledCount }),
    state: mistakeState(mistake),
  };
}
