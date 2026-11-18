export const readBody = (c: { req: { json: () => Promise<unknown> } }) => c.req.json();
