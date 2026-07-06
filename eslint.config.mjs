// Workspace lint gate — enforces the hard rules in CLAUDE.md that the compiler can't.
// Run via `npm run lint` (part of `npm run check`); CI and the edit hook both call it.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/.open-next/**", "**/.next/**", "**/.test-dist/**", "**/node_modules/**"] },
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: "latest" } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // CLAUDE.md rule 2: no `any`. New code must be typed; legacy dirs below are the debt ledger.
      "@typescript-eslint/no-explicit-any": "error",
      // CLAUDE.md rule 5: a file that keeps growing is several concepts in a trench coat.
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // DEBT LEDGER — legacy code written before the `any` ban. Remove each glob as its domain is
    // converted to the query-layer / typed-registry pattern (reference slice: trades).
    files: [
      "apps/api/src/read/**",
      "apps/api/src/indexer/**",
      "apps/api/src/reputation/**",
      "apps/api/src/{admin,index,legacy,verify}.ts",
      "apps/web/src/**",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  }
);
