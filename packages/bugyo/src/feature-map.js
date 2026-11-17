import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const featureDir = 'docs/features';
export const requiredSections = ['何があるか', 'どう辿り着くか', 'どう操作して確かめるか', 'よく嘘をつくところ'];

const Frontmatter = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  route: z.string().startsWith('/'),
  spec: z.string().regex(/^e2e\/.+\.spec\.ts$/),
});

/**
 * @param {string} file
 * @param {string} text
 * @returns {import('./index.js').Feature}
 */
function parse(file, text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (match === null) throw new Error(`${file}: 先頭に --- で囲んだ frontmatter がありません`);
  const head = match[1] ?? '';
  const body = match[2] ?? '';
  const fields = Object.fromEntries(
    head
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const at = line.indexOf(':');
        if (at < 0) throw new Error(`${file}: frontmatter の行 "${line}" は "key: value" の形にしてください`);
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
  const parsed = Frontmatter.safeParse(fields);
  if (!parsed.success) throw new Error(`${file}: frontmatter が不正です: ${parsed.error.message}`);
  return { ...parsed.data, file, body };
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
