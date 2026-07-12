// Workspace lint gate — enforces the hard rules in CLAUDE.md that the compiler can't.
// Run via `npm run lint` (part of `npm run check`); CI and the edit hook both call it.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/.open-next/**", "**/.next/**", "**/.wrangler/**", "**/.test-dist/**", "**/node_modules/**"] },
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["./*", "../*"],
              message: "Use the @/ path alias so every web module has one searchable import identity.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: "latest" } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // CLAUDE.md rule 2: no `any`. Unknown boundary data must be narrowed explicitly.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/naming-convention": ["error", { selector: "typeLike", format: ["PascalCase"] }],
      // A review signal, not an architectural boundary. Split only when the file has distinct reasons to change.
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
);
