import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Test, benchmark and browser-suite code has different, legitimate needs:
    //   - fixtures and test doubles are deliberately loosely typed
    //   - `const { dropped, ...rest } = dto` is how you assert a key is absent
    //   - tests throw bare values to exercise non-Error rejection paths
    //   - probe components capture render-scope values into an outer ref so an
    //     assertion can read them
    //   - Playwright fixtures take a callback named `use`, which the React
    //     plugin mistakes for the `use` hook
    // None of that should be linted as if it were application code.
    files: [
      "tests/**/*.ts",
      "tests/**/*.tsx",
      "bench/**/*.ts",
      "e2e/**/*.ts",
      "playwright.config.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-throw-literal": "off",
      "react/no-children-prop": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/globals": "off",
      "react-hooks/immutability": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        args: "none",
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        ignoreRestSiblings: true,
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // esbuild output from scripts/build-cli.mjs — bin/loom.ts is the source.
    // The standalone variant inlines every dependency, so linting it reports
    // on third-party code we don't own.
    "bin/*.mjs",
  ]),
]);

export default eslintConfig;
