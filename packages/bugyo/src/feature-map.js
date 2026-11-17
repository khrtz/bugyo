import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { parseFrontmatter } from './frontmatter.js';

export const featureDir = 'docs/features';
export const requiredSections = ['何があるか', 'どう辿り着くか', 'どう操作して確かめるか', 'よく嘘をつくところ'];

const relativePath = z
  .string()
  .min(1)
  .refine((path) => !isAbsolute(path) && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), {
    message: 'プロジェクトのルートからの相対パスを / 区切りで書いてください（.. と絶対パスは使えません）',
  });

const Frontmatter = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  route: z.string().startsWith('/').optional(),
  spec: relativePath,
});

/**
 * @param {string} file
 * @param {string} text
 * @returns {import('./index.js').Feature}
 */
function parse(file, text) {
  const { fields, body } = parseFrontmatter(file, text);
  const parsed = Frontmatter.safeParse(fields);
  if (!parsed.success) throw new Error(`${file}: frontmatter が不正です: ${parsed.error.message}`);
  const { id, route, spec } = parsed.data;
  return route === undefined ? { id, spec, file, body } : { id, route, spec, file, body };
}

/** @param {string} [cwd] */
export function loadFeatures(cwd = process.cwd()) {
  const dir = join(cwd, featureDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => parse(`${featureDir}/${name}`, readFileSync(join(dir, name), 'utf8')));
}

/** @param {string} [cwd] */
export function loadSweepOrder(cwd = process.cwd()) {
  const readme = readFileSync(join(cwd, featureDir, 'README.md'), 'utf8');
  return [...readme.matchAll(/\]\(([a-z0-9-]+)\.md\)/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}
