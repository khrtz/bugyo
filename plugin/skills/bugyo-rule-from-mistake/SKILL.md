---
name: bugyo-rule-from-mistake
description: When an agent (you or another) or a person makes the same kind of mistake again, turn it into lint, types, an API, a dependency rule, or a test instead of adding a written note, so it never happens again. Use when told "this again", "same mistake as before", "write it in CLAUDE.md", "make it a rule" (「またこれ」「前も同じミス」「CLAUDE.md に書いておいて」「ルールにして」), or when the same review finding comes up a second time. Always go through this before adding a line to CLAUDE.md.
---

# bugyo-rule-from-mistake

Written notes get skipped and go stale. Rules that a machine enforces keep stopping the mistake.
Try the layers from the top and **stop at the first layer that stops it**.

## 1. Will it happen again?

If it was a one-off accident, fix it and stop. Every rule adds weight.
If the same shape of mistake happened a second time, or it is left in a shape existing code would copy, go on.

## 2. Make it impossible with types or an API

The strongest layer. Make the mistake impossible to write.

- Impossible states → use a discriminated union
- Values that are easy to mix up → give them their own type with Zod's `.brand()`
- Functions that are easy to misuse → wrap them in a dedicated hook or function that only allows correct use, and ban the original call with lint

## 3. Stop it with lint or a dependency rule

Write a lint ban with `defineBan` in `eslint.config.js` and add it to `bugyo({ parts })`. What you want to stop decides which key to write.

```js
import { bugyo, common, defineBan, structure } from '@bugyo/lint';

const clock = defineBan({
  name: 'clock',
  allow: ['effects', 'tests'],
  properties: [{ object: 'Date', property: 'now', message: 'Do not use Date.now() in product code. Use useClock() from shared/lib.' }],
});

export default bugyo({ root: import.meta.dirname, parts: [common, structure, /* existing bans */ clock] });
```

| What to stop | Key | Example |
| --- | --- | --- |
| Importing a module | `imports: { paths, patterns }` | `import moment from 'moment'` |
| A global variable | `globals: [{ name, message }]` | `localStorage`, `alert` |
| An object property | `properties: [{ object, property, message }]` | `Date.now`, `Math.random`, `console.log` |
| A syntax shape | `syntax: [{ selector, message }]` | `new Date()` with no arguments is `"NewExpression[callee.name='Date'][arguments.length=0]"` |
| Other ESLint rules | `rules: { '<rule ID>': 'error' }` | `no-console` |
| Dependencies across layers or features | `config({ forbidden: [...] })` in `.dependency-cruiser.cjs` | — |

- `scope` narrows where it applies (`src`, `ui`, `model`). The default is everything under `src`. A glob scope works for bans that use only `rules`
- `allow` lists where the "right entrance" to the banned thing lives (`effects` is `src/shared/lib`, `api` is `src/shared/api`, `tests` is tests, or a glob). Build the entrance there (e.g. `systemClock` in `shared/lib/clock.ts`)
- `name` uses lowercase letters, digits, and hyphens. A name an existing ban already uses is refused

Do not set `no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties`, or `no-restricted-syntax` directly in your own block. They override bugyo's bans, which then silently disappear. Always add them with `defineBan`.
If you need a ban `defineBan` cannot express, bugyo is missing an extension point, so tell the user that (do not work around it in your own block).

**Write "what to use instead" in the error message.** Agents fix things by reading the error message, so a bare ban makes them hunt for a loophole. For `imports`, `globals`, `syntax`, and `properties`, `defineBan` refuses an item without `message`.

Good: `'Do not use Date.now() in product code. Use useClock() from shared/lib. Tests can pass fakeClock.'`
Bad: `'Date.now() is banned'`

Write the message in the project's language (the `locale` in `.bugyo/config.json`).

## 4. Fix every existing violation right away

After adding the rule, run `pnpm check` and fix every existing violation it finds, in the same change.
Do not leave them in an exception list or with `eslint-disable`. Whatever you leave, the next agent takes as a model.

## 5. If it cannot be stopped, catch it with verification

If neither types nor lint can stop it (a behavior problem, for example), catch it with a test or the feature map.

- Add a test that reproduces it (check that it fails first)
- Add a line to "Where it lies" in `docs/features/<id>.md`

## 6. CLAUDE.md only when nothing else works

Only when none of 1–5 can stop it, add a line to CLAUDE.md.
If that line can later become a rule, promote it and remove it from the text.

## Record

If the mistake is in `.bugyo/mistakes/<kind>.md`, record it with `bugyo mistake rule <kind> --at <file with the rule> --name <rule name>` (the name is the `name` of `defineBan`, a rule ID, a test name, ...). `bugyo mistake ls` shows the rules per kind and how many kinds became rules.

## Report

Write which layer stopped it, the error message of the new rule, and how many existing violations you fixed. Write code that breaks the rule on purpose once, confirm that the rule really reports an error, and include that result (delete the code after checking). Write the report in the user's language.
