import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".venv/**",
      ".pytest_cache/**",
      ".mypy_cache/**",
      ".ruff_cache/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        App: "readonly",
        Page: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
);
