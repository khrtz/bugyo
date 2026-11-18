# Architecture (summary)

## Layout
- src/app — routing and providers only
- src/features/<name>/{ui,model,api,index.ts} — only index.ts is used from outside
- src/shared/{ui,lib,api} — fetch only in shared/api, useEffect only in shared/lib

The boundaries are enforced by both ESLint (no-restricted-imports / import-x/no-restricted-paths) and dependency-cruiser (.dependency-cruiser.cjs). Circular dependencies are caught by dependency-cruiser's no-circular.

## What "done" needs, by kind of change

| Kind of change | Evidence |
| --- | --- |
| Domain logic (model/) | Vitest unit tests and fast-check property tests pass |
| Bug fix | Reproduce it with a failing test before the fix; the test passes after |
| UI flow | Run the flow in Playwright and attach the video or trace |
| UI look | Playwright screenshot comparison shows only the intended difference |
| Saving data | Read the saved value back and check it matches |
| Performance | Put the before and after measurements side by side (React Profiler, Lighthouse, etc.) |
| Refactoring | Record the current behavior in tests before the change; they still pass after |

## Adding a feature
1. Create ui, model, api, and index.ts under src/features/<name>/
2. Write docs/features/<name>.md with the four headings and add it to the regression order in the README. Write e2e/<name>.spec.ts (pnpm test catches anything missing)
3. pnpm check → pnpm verify <name>
