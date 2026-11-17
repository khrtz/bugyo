import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';

export const mistakesDir = '.bugyo/mistakes';

const kindPattern = /^[a-z0-9][a-z0-9-]*$/;
const count = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number(value));

const Fields = z
  .object({
    count: count,
    rule: z.string().default(''),
    'ruled-count': count.optional(),
  })
  .strict();

/**
 * @typedef {{ kind: string, count: number, rule: string, ruledCount: number | undefined, body: string, file: string }} Mistake
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
      if (!parsed.success) throw new Error(`${file}: frontmatter が不正です: ${parsed.error.message}`);
      return { kind: name.replace(/\.md$/, ''), count: parsed.data.count, rule: parsed.data.rule, ruledCount: parsed.data['ruled-count'], body, file };
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
    stringifyFrontmatter({ count: mistake.count, rule: mistake.rule, 'ruled-count': mistake.ruledCount }, mistake.body),
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
  const base = existing ?? { kind, count: 0, rule: '', ruledCount: undefined, body: `\n# ${kind}\n\n`, file: `${mistakesDir}/${kind}.md` };
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
 * @returns {Mistake}
 */
export function recordRule(cwd, kind, at) {
  const mistake = loadMistakes(cwd).find((candidate) => candidate.kind === kind);
  if (mistake === undefined) throw new Error(`ミスの種類 ${kind} はまだ記録されていません`);
  if (!existsSync(join(cwd, at))) throw new Error(`${at} がありません。ルールを書いたファイルを --at に渡してください`);
  const ruled = { ...mistake, rule: at.split('\\').join('/'), ruledCount: mistake.count };
  save(cwd, ruled);
  return ruled;
}

/** @param {Mistake} mistake */
export function mistakeLine(mistake) {
  const state = mistakeState(mistake);
  const rule = mistake.rule === '' ? 'ルール: なし' : `ルール: ${mistake.rule}`;
  const note = { leak: '  ← ルールが漏れている（ルール化のあとにまた起きた）', unruled: '  ← ルール化が必要', ruled: '', once: '' }[state];
  return `${mistake.kind} ${mistake.count}回  ${rule}${note}`;
}
