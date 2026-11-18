import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyFilter, filters, remaining, Todo, TodoId, todoTitle, toggleId, withToggles } from './todo';

const todoArb = fc.record({ id: fc.string({ minLength: 1 }), title: fc.string(), done: fc.boolean() }).map((raw) => Todo.parse(raw));
const todosArb = fc.uniqueArray(todoArb, { selector: (todo) => todo.id });
const filterArb = fc.constantFrom(...filters);

describe('todo model', () => {
  it('toggling the same id twice restores the list', () => {
    fc.assert(
      fc.property(todosArb, fc.string({ minLength: 1 }), (todos, raw) => {
        const id = TodoId.parse(raw);
        const twice = toggleId(toggleId(new Set(), id), id);
        expect(withToggles(todos, twice)).toEqual(todos);
      }),
    );
  });

  it('active and done together cover every todo without overlap', () => {
    fc.assert(
      fc.property(todosArb, (todos) => {
        const active = applyFilter(todos, 'active');
        const done = applyFilter(todos, 'done');
        expect(active.length + done.length).toBe(todos.length);
        expect(active.some((todo) => done.includes(todo))).toBe(false);
      }),
    );
  });

  it('remaining equals the number of active todos', () => {
    fc.assert(
      fc.property(todosArb, filterArb, (todos, filter) => {
        expect(remaining(todos)).toBe(applyFilter(todos, 'active').length);
        expect(applyFilter(todos, filter).length).toBeLessThanOrEqual(todos.length);
      }),
    );
  });

  it('rejects an empty id as a TodoId', () => {
    expect(TodoId.safeParse('').success).toBe(false);
  });
});

describe('todoTitle', () => {
  it('shows no count before the data arrives', () => {
    expect(todoTitle(undefined)).toBe('Todo');
  });

  it('shows the remaining count once the data arrives', () => {
    fc.assert(
      fc.property(todosArb, (todos) => {
        expect(todoTitle(todos)).toBe(`${String(remaining(todos))} left`);
      }),
    );
  });
});
