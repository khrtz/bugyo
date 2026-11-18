import { z } from 'zod';
import { Asset, Review } from '../model/asset-review';

const key = 'bugyo.asset-review.v1';
const Store = z.object({ added: z.array(Asset), reviews: z.record(z.string(), Review) });
export type Store = z.infer<typeof Store>;

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const result = Store.safeParse(JSON.parse(raw));
      if (result.success) return result.data;
    }
  } catch {
    return { added: [], reviews: {} };
  }
  return { added: [], reviews: {} };
}

export function saveStore(store: Store): void {
  localStorage.setItem(key, JSON.stringify(store));
}
