import { describe, expect, it } from 'vitest';
import { featureMapChecks } from './feature-map-checks.js';
import { featureDir } from './feature-map.js';

/**
 * feature map（docs/features/*.md）と、spec・機能のフォルダ・README の回帰順の整合を検査するテストを Vitest に登録する。
 *
 * @param {import('./index.js').FeatureMapOptions} [options]
 */
export function registerFeatureMapTests(options = {}) {
  const checks = featureMapChecks(options);

  describe(`feature map (${featureDir})`, () => {
    for (const check of checks) {
      const title = check.skip === null ? check.title : `${check.title}（対象なし: ${check.skip}）`;
      it.skipIf(check.skip !== null)(title, () => {
        expect(check.problems()).toEqual([]);
      });
    }
  });
}
