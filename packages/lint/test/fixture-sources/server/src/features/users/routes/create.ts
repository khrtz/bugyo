import { db } from '../../../db/client';

export const create = async (c: { req: { json: () => Promise<unknown> } }) => ({ body: await c.req.json(), db });
