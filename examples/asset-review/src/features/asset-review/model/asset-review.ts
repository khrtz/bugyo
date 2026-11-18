import { z } from 'zod';

export const Asset = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['Character', 'Environment', 'Prop']),
  triangles: z.number().int().nonnegative(),
  textureMb: z.number().int().nonnegative(),
  owner: z.string().min(1),
});
export type Asset = z.infer<typeof Asset>;

export const Review = z.object({ decision: z.enum(['approved', 'changes']), note: z.string() });
export type Review = z.infer<typeof Review>;

export function findings(asset: Asset): string[] {
  return [
    ...(/^(CHR|ENV|PROP)_[A-Z0-9]+(?:_[A-Z0-9]+)*\.(fbx|glb)$/.test(asset.name) ? [] : ['命名規則: CHR / ENV / PROP で始まる大文字の名前']),
    ...(asset.triangles <= 80000 ? [] : ['三角形数: 上限 80,000']),
    ...(asset.textureMb <= 256 ? [] : ['テクスチャ容量: 上限 256 MB']),
  ];
}

export function reviewStatus(asset: Asset, review: Review | undefined): 'approved' | 'changes' | 'issues' | 'ready' {
  if (review !== undefined) return review.decision;
  return findings(asset).length > 0 ? 'issues' : 'ready';
}

export function summary(assets: readonly Asset[], reviews: Record<string, Review>) {
  return {
    total: assets.length,
    approved: assets.filter((asset) => reviewStatus(asset, reviews[asset.id]) === 'approved').length,
    issues: assets.filter((asset) => reviewStatus(asset, reviews[asset.id]) === 'issues').length,
    changes: assets.filter((asset) => reviewStatus(asset, reviews[asset.id]) === 'changes').length,
  };
}
