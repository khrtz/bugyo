import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { featureMapChecks } from './feature-map-checks.js';
import { featureDir } from './feature-map.js';

/**
 * feature map（docs/features/*.md）と、spec・機能のフォルダ・README の回帰順の整合を検査するテストを node:test に登録する。
 *
 * @param {import('./index.js').FeatureMapOptions} [options]
 */
export function registerFeatureMapTests(options = {}) {
  const checks = featureMapChecks(options);

  void describe(`feature map (${featureDir})`, () => {
    for (const check of checks) {
      const skip = check.skip === null ? false : `対象なし: ${check.skip}`;
      void it(check.title, { skip }, () => {
        assert.deepEqual(check.problems(), []);
      });
    }
  });
}
