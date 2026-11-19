---
name: bugyo-new-feature
description: The steps for adding a new feature (a user-visible unit such as a screen, a list, or a form) to a project built on bugyo. Creates ui/model/api, the feature map, and an E2E spec with bugyo new feature, wires it into the screen, and finishes with evidence. When asked "build the X screen" or "add an X feature" (「〜の画面を作って」「〜機能を追加して」), use this before creating a folder in src/features by hand.
---

# bugyo-new-feature

## Steps

1. **Pick a name.** Lowercase letters and hyphens (e.g. `user-settings`). It must not clash with an existing one in `src/features/`
2. **Create the skeleton.** `pnpm exec bugyo new feature <id>`
   - What it creates (depends on `template` in `.bugyo/config.json`)
     - `react-vite` (default): `src/features/<id>/{ui,model,api}/`, `index.ts`, a property test for model, `e2e/<id>.spec.ts`, `docs/features/<id>.md`, `public/api/<id>.json`, and an entry in the README's regression order
     - `node-lib`: `src/features/<id>/model/` and its test, `index.ts`, `checks/<id>.ts` (a script that really runs it to check), `docs/features/<id>.md`, and an entry in the README's regression order. There is no screen, so skip the UI items of steps 3 and 4; make `checks/<id>.ts` match the real behavior, and use `index.ts` from `src/index.ts` to expose it, or from `src/app` for a command
     - `generic`: `checks/<id>.mjs` (a script that fails until you write how to really check the feature) and `docs/features/<id>.md`, plus the entry in the regression order. No product code is created; write it where the project keeps it, and make the check run it
   - For a template without a skeleton, `bugyo new feature` refuses and says why. Then do not create it by hand; tell the user
   - Do not create folders by hand. The match with the feature map goes missing and `pnpm test` fails
3. **Shape it.** Rewrite the skeleton's `Item` schema, view, and spec to the real requirements
   - Write domain calculations in `model/` as pure functions (model cannot import React)
   - Talk to the network only through `useXxxQuery` in `api/`. `fetch` goes through `getJson` in `shared/api`
   - Express state with discriminated unions. Give IDs and amounts their own types with Zod's `.brand()`
4. **Wire it into the screen.** Import only the public entry point `@/features/<id>` from `src/app`. Until it is wired in, knip stops it as "unused", which is correct
5. **Fill the feature map.** Answer the four headings of `docs/features/<id>.md` (in English: What is there / How to reach it / How to check it / Where it lies; in Japanese projects, the matching Japanese headings). Under how to check it, write the success, error, empty, and persistence paths; under where it lies, write what looks fine but breaks easily. Keep it short, at the level of behavior
6. **Check it.** `pnpm check && pnpm test && pnpm verify <id>`. Put the PASS and the evidence in `artifacts/` into the report

## When it does not go well

- `bugyo new feature` says it already exists → a feature with the same name exists. Pick another name or extend the existing feature
- You want to use the inside of another feature → add an export to that feature's `index.ts`. Do not import its internal files directly (lint and dependency-cruiser stop it)
