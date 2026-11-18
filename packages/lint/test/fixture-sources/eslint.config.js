import { readFileSync } from 'node:fs';
import { bugyo, common, defineBan, fetchOnlyInApi, noComments, structure } from '../../eslint.js';

const { sources } = JSON.parse(readFileSync(new URL('./.bugyo/config.json', import.meta.url), 'utf8'));

const noDateInModel = defineBan({ name: 'no-date-in-model', scope: 'model', globals: [{ name: 'Date', message: 'model では Date を使わない' }] });

const readBody = defineBan({
  name: 'read-body',
  allow: ['server/src/http/body.ts', 'tests'],
  syntax: [
    {
      selector: "CallExpression[callee.property.name=/^(json|text|formData|parseBody)$/][callee.object.property.name='req']",
      message: 'リクエストの本文は server/src/http/body.ts の readBody(c, schema) で読んでください',
    },
  ],
});

const dbClient = defineBan({
  name: 'db-client',
  allow: ['server/src/db', 'server/src/features', 'tests'],
  imports: { patterns: [{ group: ['**/db/client', '**/db/client.ts'], message: 'データベースのクライアントは features か services からだけ使ってください' }] },
});

export default bugyo({
  root: import.meta.dirname,
  sources: [
    { ...sources.web, parts: [common, structure, fetchOnlyInApi, noComments, noDateInModel] },
    { ...sources.server, parts: [common, structure, fetchOnlyInApi, readBody, dbClient] },
  ],
});
