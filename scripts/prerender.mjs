#!/usr/bin/env node
// Runs after `vite build`: renders the public landing page to HTML and puts it inside <div id="root">
// of dist/client/index.html. Search engines and link-preview bots that do not run JavaScript then see
// the real content, and first-time visitors see the page before the script loads. The app replaces it
// on start (src/main.tsx uses createRoot), showing the same landing page to signed-out visitors.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(root, "dist", "client", "index.html");

const vite = await createServer({
  root,
  configFile: false,
  plugins: [react()],
  logLevel: "warn",
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const { Landing } = await vite.ssrLoadModule("/src/Landing.tsx");
  const markup = renderToString(createElement(Landing));
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes('<div id="root"></div>')) throw new Error("no empty #root in dist/client/index.html");
  await writeFile(htmlPath, html.replace('<div id="root"></div>', `<div id="root"><div class="prerendered">${markup}</div></div>`));
  console.log(`prerender: landing page written into index.html (${Math.round(markup.length / 1024)} KB)`);
} finally {
  await vite.close();
}
