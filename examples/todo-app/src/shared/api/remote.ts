import { useQuery, type QueryKey } from '@tanstack/react-query';

export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; data: T };

export function useRemoteQuery<T>(key: QueryKey, load: () => Promise<T>): Remote<T> {
  const query = useQuery({ queryKey: key, queryFn: load });
  switch (query.status) {
    case 'pending':
      return { status: 'loading' };
    case 'error':
      return { status: 'error', error: query.error };
    case 'success':
      return { status: 'ready', data: query.data };
  }
}
