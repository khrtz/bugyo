export const load = async (path: string): Promise<unknown> => {
  const response = await fetch(path);
  const body: unknown = await response.json();
  return body;
};
