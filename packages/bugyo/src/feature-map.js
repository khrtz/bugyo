import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { parseFrontmatter } from './frontmatter.js';
import { tr } from './locale.js';

export const featureDir = 'docs/features';
/** feature map の4つの見出し。日本語と英語のどちらで書いてもよい */
export const sectionHeadings = Object.freeze([
  Object.freeze({ ja: '何があるか', en: 'What is there' }),
  Object.freeze({ ja: 'どう辿り着くか', en: 'How to reach it' }),
  Object.freeze({ ja: 'どう操作して確かめるか', en: 'How to check it' }),
  Object.freeze({ ja: 'よく嘘をつくところ', en: 'Where it lies' }),
]);
export const requiredSections = sectionHeadings.map((heading) => heading.ja);

/**
 * 見出しが本文の何行目にあるか。日本語と英語のどちらかの `## <見出し>` の行。なければ -1。
 *
 * @param {string[]} lines
 * @param {{ ja: string, en: string }} heading
 */
const headingLine = (lines, heading) => lines.findIndex((line) => line.trim() === `## ${heading.ja}` || line.trim() === `## ${heading.en}`);

/**
 * 4つの見出しのうち、本文にないもの（日本語の名前で返す）。
 *
 * @param {import('./index.js').Feature} feature
 * @returns {string[]}
 */
export function missingSections(feature) {
  return sectionHeadings.filter((heading) => !feature.body.includes(`## ${heading.ja}`) && !feature.body.includes(`## ${heading.en}`)).map((heading) => heading.ja);
}

const relativePath = z
  .string()
  .min(1)
  .refine((path) => !isAbsolute(path) && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), {
    error: () => tr({ en: 'use a path relative to the project root, separated by / (no .. and no absolute paths)', ja: 'プロジェクトのルートからの相対パスを / 区切りで書いてください（.. と絶対パスは使えません）' }),
  });

/** spec はコマンドの {spec} にそのまま入るので、パスに使う文字だけにする */
const specPath = relativePath.pipe(z.string().regex(/^[A-Za-z0-9._@+/-]+$/, { error: () => tr({ en: 'a spec path may use only letters, digits, and . _ @ + / -', ja: 'spec のパスは英数字と . _ @ + / - だけにしてください' }) }));

const Frontmatter = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  route: z.string().startsWith('/').optional(),
  spec: z
    .string()
    .transform((value) => value.split(',').map((item) => item.trim()))
    .pipe(z.array(specPath).min(1)),
  runner: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
});

/**
 * @param {string} file
 * @param {string} text
 * @returns {import('./index.js').Feature}
 */
function parse(file, text) {
  const { fields, body } = parseFrontmatter(file, text);
  const parsed = Frontmatter.safeParse(fields);
  if (!parsed.success) throw new Error(tr({ en: `${file}: invalid frontmatter: ${parsed.error.message}`, ja: `${file}: frontmatter が不正です: ${parsed.error.message}` }));
  const { id, route, spec: specs, runner } = parsed.data;
  const spec = /** @type {string} */ (specs[0]);
  return { id, ...(route === undefined ? {} : { route }), spec, specs, ...(runner === undefined ? {} : { runner }), file, body };
}

/** @param {string} [cwd] */
export function loadFeatures(cwd = process.cwd()) {
  const dir = join(cwd, featureDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => parse(`${featureDir}/${name}`, readFileSync(join(dir, name), 'utf8')));
}

/**
 * 4つの見出しのうち、中身が空か雛形のまま（`（…）` だけの項目や、`：` の後が空の項目が残っている。英語の見出しでは、それに加えて `(…)` と `:`）のものを、日本語の名前で返す。
 *
 * @param {import('./index.js').Feature} feature
 * @returns {string[]}
 */
export function unfilledSections(feature) {
  const lines = feature.body.split(/\r?\n/);
  return sectionHeadings
    .filter((heading) => {
      const start = headingLine(lines, heading);
      if (start < 0) return true;
      const rest = lines.slice(start + 1);
      const end = rest.findIndex((line) => /^#{1,2} /.test(line));
      const content = (end < 0 ? rest : rest.slice(0, end)).map((line) => line.trim()).filter((line) => line !== '');
      const english = lines[start]?.trim() === `## ${heading.en}`;
      const placeholder = (/** @type {string} */ line) => /^- （[^）]*）$/.test(line) || /^- [^：]+：$/.test(line) || (english && (/^- \([^)]*\)$/.test(line) || /^- [^:]+:$/.test(line)));
      return content.length === 0 || content.some(placeholder);
    })
    .map((heading) => heading.ja);
}

/** @param {string} [cwd] */
export function loadSweepOrder(cwd = process.cwd()) {
  const readme = readFileSync(join(cwd, featureDir, 'README.md'), 'utf8');
  return [...readme.matchAll(/\]\(([a-z0-9-]+)\.md\)/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}
