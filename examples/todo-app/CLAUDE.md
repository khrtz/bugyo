# Development rules

## Commands
- pnpm check — types, lint, dependencies, unused code. Run it after every change
- pnpm test — unit tests and the feature map consistency check
- pnpm verify <feature> — actually run the feature and keep evidence in artifacts/

## Definition of done
- Passing pnpm check alone is not done
- You are not done until you produce the evidence for your kind of change (the table in docs/architecture.md)
- For a bug fix, reproduce it with a failing test first

## When unsure
- How to check a feature: open only that feature's file from docs/features/README.md
- When you change the UI, fix docs/features/<id>.md in the same change
- When lint stops you, follow the message. Do not disable the rule
