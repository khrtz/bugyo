/** 見出しの文字列を、URL に使える小文字・数字・ハイフンだけの名前に変える */
export function toSlug(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
