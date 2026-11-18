import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';
import { noUiTimers, noUseEffect, react } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture');
const parts = [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers];

/** @param {'ja' | 'en'} locale */
async function messages(locale) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: bugyo({ root, parts, locale }) });
  const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
  return results.flatMap((result) => result.messages.map((message) => ({ file: result.filePath, line: message.line, ruleId: message.ruleId, message: message.message })));
}

/** 禁止の名前まで（bugyo doctor が数えるのに使う部分） @param {string} message */
const upToName = (message) => {
  const tag = /\[bugyo:[a-z0-9-]+\]/.exec(message);
  return tag === null ? undefined : message.slice(0, tag.index + tag[0].length);
};

test('locale を en にすると、禁止のメッセージが英語になり、禁止の名前までは同じまま', async () => {
  const ja = await messages('ja');
  const en = await messages('en');
  const tagged = (/** @type {typeof ja} */ list) => list.filter((m) => upToName(m.message) !== undefined);
  assert.ok(tagged(ja).length >= 6, ja.map((m) => m.message).join('\n'));
  assert.deepEqual(
    tagged(en).map((m) => [m.file, m.line, m.ruleId, upToName(m.message)]),
    tagged(ja).map((m) => [m.file, m.line, m.ruleId, upToName(m.message)]),
  );
  for (const { message } of tagged(en)) assert.ok(!/[ぁ-んァ-ヶ一-龠]/.test(message), message);
  assert.ok(tagged(en).some((m) => m.message.includes('[bugyo:use-effect] useEffect is not allowed in product code.')));
  assert.ok(tagged(en).some((m) => m.message.includes('[bugyo:fetch] Do not call fetch directly.')));
  assert.ok(tagged(ja).some((m) => m.message.includes('[bugyo:use-effect] 製品コードでuseEffectは使えません。')), '既定と同じ日本語');
});

test('locale は、オプション、BUGYO_LOCALE、.bugyo/config.json の順に見て、なければ日本語', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bugyo-locale-'));
  mkdirSync(join(dir, '.bugyo'));
  const fetchMessage = (/** @type {import('eslint').Linter.Config[]} */ config) =>
    config
      .flatMap((block) => {
        const rule = block.rules?.['no-restricted-globals'];
        return Array.isArray(rule) ? rule.slice(1) : [];
      })
      .map((entry) => (typeof entry === 'object' && entry !== null && 'message' in entry ? String(entry.message) : ''))
      .find((message) => message.startsWith('[bugyo:fetch]')) ?? '';
  const build = (/** @type {'ja' | 'en' | undefined} */ locale) => bugyo({ root: dir, parts: [common, structure, fetchOnlyInApi], ...(locale === undefined ? {} : { locale }) });
  const saved = process.env.BUGYO_LOCALE;
  try {
    delete process.env.BUGYO_LOCALE;
    assert.match(fetchMessage(build(undefined)), /fetchを直接/);
    writeFileSync(join(dir, '.bugyo/config.json'), JSON.stringify({ locale: 'en' }));
    assert.match(fetchMessage(build(undefined)), /Do not call fetch/);
    process.env.BUGYO_LOCALE = 'ja';
    assert.match(fetchMessage(build(undefined)), /fetchを直接/, 'BUGYO_LOCALE が config より先');
    assert.match(fetchMessage(build('en')), /Do not call fetch/, 'オプションがいちばん先');
    process.env.BUGYO_LOCALE = 'fr';
    assert.throws(() => build(undefined), /locale/);
  } finally {
    if (saved === undefined) delete process.env.BUGYO_LOCALE;
    else process.env.BUGYO_LOCALE = saved;
  }
});
