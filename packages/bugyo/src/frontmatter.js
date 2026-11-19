import { tr } from './locale.js';

/**
 * 先頭の `---` で囲んだ `key: value` 1段だけの frontmatter と本文に分ける。
 *
 * @param {string} file エラー文に出す名前
 * @param {string} text
 * @returns {{ fields: Record<string, string>, body: string }}
 */
export function parseFrontmatter(file, text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (match === null) throw new Error(tr({ en: `${file}: no frontmatter between --- lines at the top`, ja: `${file}: 先頭に --- で囲んだ frontmatter がありません` }));
  const head = match[1] ?? '';
  const body = match[2] ?? '';
  const fields = Object.fromEntries(
    head
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const at = line.indexOf(':');
        if (at < 0) throw new Error(tr({ en: `${file}: the frontmatter line "${line}" must look like "key: value"`, ja: `${file}: frontmatter の行 "${line}" は "key: value" の形にしてください` }));
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
  return { fields, body };
}

/**
 * frontmatter と本文を1つの文字列に戻す。値が undefined の項目は書かない。
 *
 * @param {Record<string, string | number | undefined>} fields
 * @param {string} body
 */
export function stringifyFrontmatter(fields, body) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`.trimEnd());
  return `---\n${lines.join('\n')}\n---\n${body.startsWith('\n') ? body : `\n${body}`}`;
}
