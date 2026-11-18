/** 言語ごとのメッセージ */
const forbidden = {
  ja: 'コメントは書けません。意図は名前・型・テストで表してください。許可されるのは公開APIのJSDoc（/** */）と、理由つきのeslint-disable（-- 理由）だけです。',
  en: 'Comments are not allowed. Express intent with names, types, and tests. Only JSDoc on public APIs (/** */) and eslint-disable with a reason (-- reason) are allowed.',
};

/**
 * コメントの禁止のルールを、メッセージの言語を決めて作る。
 *
 * @param {'ja' | 'en'} locale
 * @returns {import('eslint').Rule.RuleModule}
 */
export function noCommentsFor(locale) {
  return {
    meta: {
      type: 'suggestion',
      schema: [],
      messages: { forbidden: forbidden[locale] },
    },
    create(context) {
      return {
        Program() {
          for (const comment of context.sourceCode.getAllComments()) {
            const text = comment.value.trim();
            const isJsDoc = comment.type === 'Block' && comment.value.startsWith('*');
            const isDirective = /^eslint-(disable|enable)/.test(text);
            if (isJsDoc || isDirective) continue;
            context.report({ loc: comment.loc ?? { line: 1, column: 0 }, messageId: 'forbidden' });
          }
        },
      };
    },
  };
}

export const noComments = noCommentsFor('en');
