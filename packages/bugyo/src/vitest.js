import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { featureDir, loadFeatures, loadSweepOrder, requiredSections } from './feature-map.js';

/**
 * feature map（docs/features/*.md）と、spec・src/features・README の回帰順の整合を検査するテストを登録する。
 *
 * @param {{ cwd?: string, src?: string }} [options]
 */
export function registerFeatureMapTests(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const src = options.src ?? 'src';
  const features = loadFeatures(cwd);

  describe(`feature map (${featureDir})`, () => {
    it('ファイル名と id が一致している', () => {
      for (const feature of features) {
        expect(feature.file, `${feature.file} の id は ${feature.id} です`).toBe(`${featureDir}/${feature.id}.md`);
      }
    });

    it('すべての機能に4つの見出しがある', () => {
      for (const feature of features) {
        for (const section of requiredSections) {
          expect(feature.body.includes(`## ${section}`), `${feature.file} に「## ${section}」がありません`).toBe(true);
        }
      }
    });

    it('すべての機能に、存在するE2E specがある', () => {
      for (const feature of features) {
        expect(existsSync(join(cwd, feature.spec)), `${feature.file}: ${feature.spec} がありません`).toBe(true);
      }
    });

    it('すべてのE2E specが、どれかの機能に対応している', () => {
      const mapped = new Set(features.map((feature) => feature.spec));
      for (const spec of readdirSync(join(cwd, 'e2e')).filter((name) => name.endsWith('.spec.ts'))) {
        expect(mapped.has(`e2e/${spec}`), `e2e/${spec} に対応する ${featureDir}/*.md がありません`).toBe(true);
      }
    });

    it(`${src}/features のフォルダがすべて feature map に載っている`, () => {
      const ids = new Set(features.map((feature) => feature.id));
      for (const dir of readdirSync(join(cwd, src, 'features'))) {
        expect(ids.has(dir), `${src}/features/${dir} に対応する ${featureDir}/${dir}.md がありません`).toBe(true);
      }
    });

    it('README の回帰の順番に、すべての機能がちょうど1回ずつ載っている', () => {
      const order = loadSweepOrder(cwd);
      expect([...order].sort()).toEqual(features.map((feature) => feature.id).sort());
    });
  });
}
