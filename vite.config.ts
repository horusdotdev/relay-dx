import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@relay-dx/schema": fileURLToPath(new URL("./packages/schema/src/index.ts", import.meta.url)),
      "@relay-dx/mcp": fileURLToPath(new URL("./packages/mcp/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/fixtures/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  fmt: { ignorePatterns: ["**/dist/**", "**/target/**", "**/__generated__/**", "pnpm-lock.yaml"] },
  lint: {
    ignorePatterns: ["**/dist/**", "**/__generated__/**", "examples/**", "tests/fixtures/**"],
    options: { typeAware: true, typeCheck: true },
  },
});
