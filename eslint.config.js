import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "release/**",
      "node_modules/**",
      "artifacts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "electron"],
              message: "Host APIs belong in the Electron adapter.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.mjs", "eslint.config.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
  },
);
