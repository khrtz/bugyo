---
name: bugyo-sync-feature-map
description: Keep the feature map (docs/features/<id>.md) in step with a change that alters what users see or do — a screen, a route, a command, an endpoint, or how a feature is checked. Use before reporting any UI or behavior change, when pnpm test reports a feature map mismatch, when verify fails because the steps in the map are stale, or when asked "update the feature map", "the map is out of date" (「feature map を直して」「地図が古い」). Not for drafting a map from scratch; use bugyo-map-features for that.
---

# bugyo-sync-feature-map

A feature map that drifts from the code sends the next agent to the wrong place, and it believes the map. Fix the map in the same change that changed the behavior.

## 1. Find the features the change touches

- Look at the diff (`git diff` against the base). A file under `<featuresDir>/<id>/` belongs to feature `<id>`; a changed spec file belongs to the feature whose `spec` names it; a changed route, command, or endpoint belongs to the feature whose "How to reach it" names it
- Shared code (`shared/`, `lib/`) can change several features. Check the features that use it, starting with the ones in the regression order
- Open only the map files of the touched features

## 2. Fix each map file

For each touched feature, read the four headings against the new behavior.

- What is there: add what users can now see or do, remove what is gone
- How to reach it: update menus, routes, commands, endpoints, and `route` in the frontmatter
- How to check it: update the success, error, and empty paths. If the spec changed, the steps here must match what it does
- Where it lies: add the new fragile spots the change brought in; remove ones that no longer apply

Write only what you confirmed in the code or by running it. Do not leave template items (only `(…)` / `（…）`, or ending with `:` / `：`).

## 3. Features added, removed, or renamed

- Added: create it with `bugyo new feature <id>` where the template supports it; otherwise add the map file and its spec by hand. Then fill the four headings
- Removed: delete `docs/features/<id>.md`, its spec, and its line in the regression order of `docs/features/README.md`
- Renamed: rename the map file, `id` in its frontmatter, the feature folder, the spec, and the line in the regression order together. Update `feature:` in the open task files that name the old id (that field may be edited; the status fields may not)

## 4. Check

- Run `pnpm test`. The feature map checks must pass
- Run `pnpm verify <id>` for every touched feature, and follow the steps in "How to check it" once to see that they still lead where they say

## Report

Write it in the user's language: which map files you changed and why, any features added, removed, or renamed, and the verify result of each touched feature.
