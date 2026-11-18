import type { z } from 'zod';

class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`GET ${path} returned ${String(status)}`);
  }
}

export async function getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  const res = await fetch(path);
  if (!res.ok) throw new HttpError(res.status, path);
  const body: unknown = await res.json();
  return schema.parse(body);
}
