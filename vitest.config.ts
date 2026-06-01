import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // vitest 4 bundles rolldown-vite (oxc), which ignores the `esbuild` option in
  // favour of `oxc`. JSX in client `.tsx` files only transforms when JSX is
  // configured here; otherwise oxc parses `.tsx` as plain TS and fails.
  oxc: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    projects: [
      {
        extends: true,
        test: {
          name: "api",
          environment: "node",
          include: ["tests/api/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          include: ["tests/client/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/client/setup.ts"],
        },
      },
    ],
  },
});
