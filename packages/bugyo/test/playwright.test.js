import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineBugyoConfig } from 'bugyo/playwright';

test('defineBugyoConfig: 既定では同じポートのサーバーを使い回さない（CI でも手元でも）', () => {
  const ci = process.env['CI'];
  try {
    for (const value of [undefined, '1']) {
      if (value === undefined) delete process.env['CI'];
      else process.env['CI'] = value;
      const server = defineBugyoConfig({ port: 4321 }).webServer;
      assert.ok(server !== undefined && !Array.isArray(server));
      assert.equal(server.reuseExistingServer, false);
      assert.equal(server.url, 'http://localhost:4321');
    }
  } finally {
    if (ci === undefined) delete process.env['CI'];
    else process.env['CI'] = ci;
  }
  const reused = defineBugyoConfig({ reuseExistingServer: true }).webServer;
  assert.ok(reused !== undefined && !Array.isArray(reused));
  assert.equal(reused.reuseExistingServer, true);
});
