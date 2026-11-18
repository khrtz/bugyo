import { useState } from 'react';
import { useDocumentTitle } from '@/shared/lib';
import { Button } from '@/shared/ui';
import { useTodosQuery } from '../api/useTodosQuery';
import {
  applyFilter,
  filters,
  remaining,
  todoTitle,
  toggleId,
  withToggles,
  type Filter,
  type Todo,
  type TodoId,
} from '../model/todo';

const filterLabels = { all: 'All', active: 'Active', done: 'Done' } satisfies Record<Filter, string>;

export function TodoList() {
  const query = useTodosQuery();
  const [toggled, setToggled] = useState<ReadonlySet<TodoId>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');

  useDocumentTitle(todoTitle(query.status === 'ready' ? withToggles(query.data, toggled) : undefined));

  switch (query.status) {
    case 'loading':
      return <p role="status">Loading…</p>;
    case 'error':
      return <p role="alert">Failed to load: {query.error.message}</p>;
    case 'ready': {
      const todos = withToggles(query.data, toggled);
      return (
        <section aria-label="Todo">
          <p>{remaining(todos)} left</p>
          <div role="group" aria-label="Filter">
            {filters.map((f) => (
              <Button key={f} pressed={f === filter} onClick={() => {
                setFilter(f);
              }}>
                {filterLabels[f]}
              </Button>
            ))}
          </div>
          <ul>
            {applyFilter(todos, filter).map((todo: Todo) => (
              <li key={todo.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={() => {
                      setToggled((prev) => toggleId(prev, todo.id));
                    }}
                  />
                  {todo.title}
                </label>
              </li>
            ))}
          </ul>
        </section>
      );
    }
  }
}
