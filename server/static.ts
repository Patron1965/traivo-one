import express, { type Express, type Response } from "express";
import fs from "fs";
import path from "path";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function setCacheHeadersForBuildAsset(res: Response, filePath: string) {
  // Vite emits hashed filenames in /assets/, so they are safe to cache forever.
  // Everything else (notably index.html, manifest.json, sw.js, favicon.png) must
  // be revalidated on every request so a fresh deploy is picked up immediately
  // and we don't load a stale index.html that points to a deleted JS chunk
  // (which causes "Failed to fetch dynamically imported module" errors).
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader("Cache-Control", `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    return;
  }
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(
    express.static(distPath, {
      setHeaders: setCacheHeadersForBuildAsset,
    }),
  );

  // Task #1394: saknade byggda assets (t.ex. en gammal hash-chunk efter ny
  // deploy) får ALDRIG SPA-fallbacka till index.html — då får webbläsaren HTML
  // för en JS-modulbegäran → "'text/html' is not a valid JavaScript MIME type".
  // 404 låter klientens stale-chunk-detektor ladda om sidan istället.
  app.use("*", (req, res, next) => {
    const pathname = (req.originalUrl || "").split("?")[0];
    if (pathname.startsWith("/assets/")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.status(404).type("text/plain").send("Not found");
    }
    next();
  });

  // SPA fallback: serve index.html for unknown routes, never cached so a fresh
  // deploy is reflected on the next navigation.
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
