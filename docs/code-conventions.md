# Code conventions

These are repository rules, not suggestions. `npm run check` enforces the mechanical subset.

## Imports and module boundaries

- Import concrete modules directly. Do not create barrel `index.ts` files or `export *` re-export hubs.
- Web source uses the `@/` alias, including imports within the same folder. One module should have one
  searchable import identity.
- API source currently uses explicit relative imports. Do not add a TypeScript-only API alias: emitted Node
  tests do not rewrite `paths`, and Wrangler resolution must agree with the test runtime before an alias is
  adopted. Package imports are the preferred future route if both runtimes are configured together.
- Use `import type` when an import is erased at runtime. Avoid importing the Worker composition root from
  lower-level modules; bindings live in `env.ts`.
- Feature code belongs under `features/<domain>`; shared visual primitives belong under `components/ui`;
  global shell components belong under `components/chrome`.

## Names and types

- Files use kebab-case; React components and all type-like declarations use PascalCase.
- Use `*Row` for database rows, `*Response` or `*Event` for provider payloads, `*Result` for operation output,
  and `*Options` or `*Config` for inputs. Shared public wire types keep their semantic product names.
- Prefer `interface` for object contracts intended for extension and `type` for unions, tuples, mapped types,
  and local composition. Do not convert between them cosmetically.
- `get*` expects one value, `find*` may return `null`, and `list*` returns a collection.
- Boolean names should read as predicates (`is*`, `has*`, `can*`, `should*`) except protocol fields whose
  external names must be preserved.

## Constants

- Module-level immutable policy, cadence, limit, and provider values use `UPPER_SNAKE_CASE`.
- One-use obvious literals remain local. Extract a number when it represents protocol behavior, provider
  limits, operational tuning, or appears more than once with the same meaning.
- Protocol constants stay beside the protocol handler; provider limits stay beside the provider client;
  scoring policy stays in `reputation/config.ts`. Do not create a global constants grab bag.

## Formatting and checks

- Prettier is the formatting authority; do not hand-align code against it.
- ESLint owns correctness and architectural rules; TypeScript runs in strict mode.
- Files may not grow beyond 400 nonblank, noncomment lines. Named legacy exceptions are an explicit debt
  ledger in `eslint.config.mjs`, not precedent for new large files.
- Run `npm run check` before committing. API changes also run `npm test -w xcp-api`; web changes run the
  production build and Playwright suite.
