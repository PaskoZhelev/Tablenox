# Contributing to Tablenox

Thanks for your interest! Bug reports, ideas and pull requests are all welcome.

## Reporting bugs and suggesting features

Open a GitHub issue. For bugs, include the browser and OS, the steps to reproduce, and (if you can) an exported `.tablenox.zip` of a small game that shows the problem. Please only attach images you are allowed to share.

## Development setup

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium firefox   # once, for the E2E tests
npm run dev                               # http://localhost:5173
```

[LLM_CONTEXT.md](LLM_CONTEXT.md) gives a quick overview of how the code is organised and the rules that are easy to break. [docs/adr/README.md](docs/adr/README.md) records the design decisions.

## Before opening a pull request

Run all checks locally:

```bash
npm run typecheck
npm run lint
npx prettier --check src e2e
npm test
npm run build
npm run test:e2e
```

Please also:

- Keep pull requests focused on one change.
- Add or update tests: unit tests for domain logic (`src/tests/`) and/or Playwright tests (`e2e/`) for UI behaviour.
- For user-visible changes, update `README.md` (features and shortcut table) and the in-app help (`src/features/table/HelpDialog.tsx`), and add an ADR entry in `docs/adr/README.md` for notable design decisions.
- Keep the app fully offline: no backend, no accounts, no network calls.
- Don't commit third-party artwork (cards, boards, rulebooks) unless its license allows it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
