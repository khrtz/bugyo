import { z } from 'zod';
import { getJson, useRemoteQuery, type Remote } from '@/shared/api';
import { Todo } from '../model/todo';

export function useTodosQuery(): Remote<Todo[]> {
  return useRemoteQuery(['todos'], () => getJson('/api/todos.json', z.array(Todo)));
}
