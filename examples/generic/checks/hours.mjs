import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
assert.match(html, /<title>Opening hours<\/title>/);
const items = [...html.matchAll(/<li>(.+?)<\/li>/g)].map((match) => match[1]);
assert.deepEqual(items, ['Mon–Fri: 9:00–18:00', 'Sat: 10:00–16:00', 'Sun: closed']);

console.log(`hours: ok (${items.length} rows)`);
