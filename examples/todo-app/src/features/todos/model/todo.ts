import { z } from 'zod';

export const TodoId = z.string().min(1).brand<'TodoId'>();
export type TodoId = z.infer<typeof TodoId>;

export const Todo = z.object({
  id: TodoId,
  title: z.string(),
  done: z.boolean(),
});
export type Todo = z.infer<typeof Todo>;

export const filters = ['all', 'active', 'done'] as const;
export type Filter = (typeof filters)[number];

export function toggleId(toggled: ReadonlySet<TodoId>, id: TodoId): ReadonlySet<TodoId> {
  const next = new Set(toggled);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function withToggles(todos: readonly Todo[], toggled: ReadonlySet<TodoId>): Todo[] {
  return todos.map((todo) => (toggled.has(todo.id) ? { ...todo, done: !todo.done } : todo));
}

export function applyFilter(todos: readonly Todo[], filter: Filter): Todo[] {
  switch (filter) {
    case 'all':
      return [...todos];
    case 'active':
      return todos.filter((todo) => !todo.done);
    case 'done':
      return todos.filter((todo) => todo.done);
  }
}

export function remaining(todos: readonly Todo[]): number {
  return todos.filter((todo) => !todo.done).length;
}

export function todoTitle(todos: readonly Todo[] | undefined): string {
  return todos === undefined ? 'Todo' : `${String(remaining(todos))} left`;
}
