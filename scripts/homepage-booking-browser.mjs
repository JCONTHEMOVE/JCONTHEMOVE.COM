// Browser layout/keyboard acceptance against the real homepage, with all API
// calls mocked. No application server, credentials or live payment SDK is used.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const dir = path.resolve("node_modules/.cache/homepage-browser");
await mkdir(dir, { recursive: true });
await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import Home from './client/src/pages/home'; const client=new QueryClient({defaultOptions:{queries:{retry:false,queryFn:async()=>[]}}}); createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Home/></QueryClientProvider>);`, resolveDir: process.cwd(), loader: "tsx" }, outfile: path.join(dir, "app.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic", loader: { ".jpg": "dataurl", ".png": "dataurl" }, alias: { "@assets": path.resolve("attached_assets") }, define: { "process.env.NODE_ENV": '"test"' } });
await writeFile(path.join(dir, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"></head><body style="margin:0"><div id="root"></div><script src="app.js"></script></body></html>`);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.fixtureCalls = [];
    window.fetch = async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : {};
      window.fixtureCalls.push({ url, body });
      const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      if (url === "/api/instant-booking/status") return response({}, 404);
      if (url === "/api/instant-booking/availability") return response({ quote: { estimateLabel: "$555 synthetic estimate", crewSize: 2, requestedHours: 2, autoBookEligible: false, fingerprint: "a".repeat(64) }, slots: [] });
      throw Error("Unexpected request " + url);
    };
  });
  await page.goto(pathToFileURL(path.join(dir, "index.html")).href);
  const callback = page.getByRole("button", { name: /Request a callback/ });
  const book = page.getByRole("button", { name: /Pick an available date and time/ });
  await callback.waitFor();
  const a = await callback.boundingBox(), b = await book.boundingBox();
  assert.equal(Math.round(a.y), Math.round(b.y), "Choices are side by side on a phone");
  assert.equal(Math.round(a.width), Math.round(b.width), "Choices have equal visual width");
  assert.ok(a.height >= 44 && b.height >= 44);
  assert.ok(a.y + a.height < 844 && b.y + b.height < 844, "Both entry choices fit in the initial phone viewport");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No phone overflow");
  if (process.env.SCREENSHOT_DIR) { await mkdir(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, "homepage-390.png"), fullPage: false }); }
  await callback.focus(); await page.keyboard.press("Enter");
  assert.equal(await page.locator(":focus").textContent(), "Where do you need help?");
  await page.getByLabel("Service address, including ZIP").fill("123 Synthetic St, Ironwood MI 49938");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Truck size or approximate home size").selectOption("26_ft");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await book.click();
  assert.equal(await page.getByLabel("Service date").inputValue(), "");
  await page.getByLabel("Service date").fill("2099-07-10");
  await page.reload();
  assert.equal(await page.getByLabel("Service date").inputValue(), "2099-07-10");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  assert.equal(await page.getByLabel("Truck size or approximate home size").inputValue(), "26_ft");
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No 320px overflow");
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No desktop overflow");
  assert.deepEqual(errors, []);
  console.log("PASS: actual homepage in Chromium at 390/320/1280px; equal entry choices, keyboard focus, touch-sized navigation, path switching and refresh");
} finally { await browser.close(); }
