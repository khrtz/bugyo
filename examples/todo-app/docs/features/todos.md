---
id: todos
route: /
spec: e2e/todos.spec.ts
---

# todos

## What is there
- The todo list (fetched from `/api/todos.json` and validated with Zod)
- A checkbox on each row toggles done / not done (in-page state only; nothing is saved)
- Filter buttons: All / Active / Done
- "N left", and the same text in the tab title

## How to reach it
- Open the top page `/`. No login or other setup

## How to check it
- `pnpm verify todos` (video, screenshots, and a trace are kept in `artifacts/`)
- Success - three todos show and the page says "2 left". Checking one changes it to "1 left", and the title follows
- Filter - "Active" shows only open todos, "Done" only finished ones. The selected button has `aria-pressed`
- Error - if `/api/todos.json` fails or has the wrong shape, `role="alert"` shows "Failed to load"
- Loading - `role="status"` shows "Loading…"
- Empty - with zero todos the page says "0 left" and the list is empty
- Persistence - none. Reloading undoes the toggles (this is correct)

## Where it lies
- "N left" counts **all** todos, not the filtered ones. It is correct even when it differs from the filtered count
- While loading and on failure the title is "Todo" with no count (`todoTitle` in `model/todo.ts`). "0 left" there means the count was taken without data
- The tab title is updated by `shared/lib/useDocumentTitle`. The body can be right while only the title is wrong
- When finding the "Done" button by name, use `exact: true` so the lookup stays exact as labels change
