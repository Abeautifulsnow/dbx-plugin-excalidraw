// ESLint flat config. Scope is deliberately narrow: this project keeps no
// style lint, the job of this file is to catch Rules of Hooks regressions
// statically — the 0.4.0 blank-tab release (hook registered after an early
// return in App.tsx) is the class of bug unit tests cannot see.
import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: false,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
];
