import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // vitest <=4.1.5 bundled rolldown-vite (oxc) som ignorerar `esbuild`;
  // vitest >=4.1.10 använder vanlig vite (esbuild) igen. Behåll BÅDA
  // JSX-konfigurationerna så att `.tsx` transformeras oavsett variant —
  // annars "React is not defined" i alla client-tester.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  esbuild: {
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
