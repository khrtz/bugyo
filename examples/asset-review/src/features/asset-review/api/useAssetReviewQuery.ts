import { z } from 'zod';
import { getJson, useRemoteQuery, type Remote } from '@/shared/api';
import { Asset } from '../model/asset-review';

export function useAssetReviewQuery(): Remote<Asset[]> {
  return useRemoteQuery(['asset-review'], () => getJson('/api/asset-review.json', z.array(Asset)));
}
