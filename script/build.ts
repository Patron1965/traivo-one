import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// ESM-only packages that must never be bundled (causes CJS interop issues)
const forceExternal = [
  "memoizee",
  "p-limit", 
  "p-retry",
  "openid-client",
  "resend",
  "papaparse",
  "passport",
  "express-session",
  "connect-pg-simple",
  "@modelcontextprotocol/sdk",
  "google-auth-library",
  "@google-cloud/storage",
];

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = [
    ...allDeps.filter((dep) => !allowlist.includes(dep)),
    ...forceExternal,
  ];

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: false,
    sourcemap: true,
    external: externals,
    logLevel: "info",
    mainFields: ["module", "main"],
    conditions: ["import", "node", "default"],
    keepNames: true,
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
