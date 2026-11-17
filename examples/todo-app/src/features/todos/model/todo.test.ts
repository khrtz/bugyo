import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyFilter, filters, remaining, Todo, TodoId, todoTitle, toggleId, withToggles } from './todo';

const todoArb = fc.record({ id: fc.string({ minLength: 1 }), title: fc.string(), done: fc.boolean() }).map((raw) => Todo.parse(raw));
const todosArb = fc.uniqueArray(todoArb, { selector: (todo) => todo.id });
const filterArb = fc.constantFrom(...filters);

describe('todo model', () => {
  it('同じIDを2回トグルすると元に戻る', () => {
    fc.assert(
      fc.property(todosArb, fc.string({ minLength: 1 }), (todos, raw) => {
        const id = TodoId.parse(raw);
        const twice = toggleId(toggleId(new Set(), id), id);
        expect(withToggles(todos, twice)).toEqual(todos);
      }),
    );
  });

  it('active と done に分けると全件になり、重ならない', () => {
    fc.assert(
      fc.property(todosArb, (todos) => {
        const active = applyFilter(todos, 'active');
        const done = applyFilter(todos, 'done');
        expect(active.length + done.length).toBe(todos.length);
        expect(active.some((todo) => done.includes(todo))).toBe(false);
      }),
    );
  });

  it('remaining は active の件数と一致する', () => {
    fc.assert(
      fc.property(todosArb, filterArb, (todos, filter) => {
        expect(remaining(todos)).toBe(applyFilter(todos, 'active').length);
        expect(applyFilter(todos, filter).length).toBeLessThanOrEqual(todos.length);
      }),
    );
  });

  it('空のIDは TodoId として受け付けない', () => {
    expect(TodoId.safeParse('').success).toBe(false);
  });
});

describe('todoTitle', () => {
  it('データが無いうちは件数を出さない', () => {
    expect(todoTitle(undefined)).toBe('Todo');
  });

  it('データがあれば残り件数を出す', () => {
    fc.assert(
      fc.property(todosArb, (todos) => {
        expect(todoTitle(todos)).toBe(`残り ${String(remaining(todos))} 件`);
      }),
    );
  });
});
