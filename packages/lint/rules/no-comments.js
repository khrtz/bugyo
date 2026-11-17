/** @type {import('eslint').Rule.RuleModule} */
export const noComments = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      forbidden:
        'コメントは書けません。意図は名前・型・テストで表してください。許可されるのは公開APIのJSDoc（/** */）と、理由つきのeslint-disable（-- 理由）だけです。',
    },
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
