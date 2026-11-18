# Feature map

A map of the features as users see them. To check a change, open **only the one** file for that feature. You don't need to read them all.

## How to write one
- One feature, one file (`docs/features/<id>.md`). `<id>` matches `src/features/<id>`
- Put `id`, `route`, and `spec` in the frontmatter. `pnpm test` checks that the spec exists and that nothing is missing
- The body answers four headings. Keep it short and at the level of behavior, so someone can operate the feature without reading the source
  1. **What is there**
  2. **How to reach it**
  3. **How to check it** (`pnpm verify <id>`, and each path: success, cancel, error, empty, persistence)
  4. **Where it lies** (places where it looks fine but is broken)
- When you change the UI, fix this file in the same PR

## Regression order
To check the whole app, go from top to bottom.

1. [todos](todos.md)
