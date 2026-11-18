import { describe, expect, it } from 'vitest';
import { findings, reviewStatus, summary, type Asset } from './asset-review';

const ready: Asset = { id: 'a', name: 'PROP_LAMP_01.fbx', category: 'Prop', triangles: 80000, textureMb: 256, owner: 'Art' };

describe('asset review', () => {
  it('境界値は通し、命名・三角形数・容量の違反を個別に出す', () => {
    expect(findings(ready)).toEqual([]);
    expect(findings({ ...ready, name: 'lamp.fbx', triangles: 80001, textureMb: 257 })).toHaveLength(3);
  });

  it('未レビューの問題と差し戻しを分けて集計する', () => {
    const bad = { ...ready, id: 'b', triangles: 90000 };
    expect(reviewStatus(bad, undefined)).toBe('issues');
    expect(summary([ready, bad], { a: { decision: 'approved', note: '' }, b: { decision: 'changes', note: '軽量化' } }))
      .toEqual({ total: 2, approved: 1, issues: 0, changes: 1 });
  });
});
