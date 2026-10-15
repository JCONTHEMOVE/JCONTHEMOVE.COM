// Invoked by the SQL/HTTP fixture with --browser; never connects to a live site.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function runLeadBotBrowser({ app, origin, botId }) {
  const { chromium } = await import("playwright").catch(() => import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href));
  const output = path.resolve("node_modules/.cache/lead-bot-browser/app.js");
  await mkdir(path.dirname(output), { recursive: true });
  await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import LeadBotPage from './client/src/pages/lead-bot';
    import LeadBotBuilder from './client/src/pages/admin/lead-bot-builder';
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>
      {location.pathname === '/synthetic-owner-builder' ? <LeadBotBuilder/> : <LeadBotPage/>}
    </QueryClientProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, outfile: output, platform: "browser", format: "esm", jsx: "automatic", define: { "import.meta.env": "{}" } });
  app.get("/synthetic-app.js", async (_req, res) => res.type("js").send(await readFile(output, "utf8")));
  app.get("/synthetic-app.css", async (_req, res) => res.type("css").send(await readFile(output.replace(/\.js$/, ".css"), "utf8")));
  app.get(["/lead-bot/:id", "/synthetic-owner-builder"], (_req, res) => res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/synthetic-app.css"><title>Synthetic JC lead-bot test</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/synthetic-app.js"></script></body></html>`));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ extraHTTPHeaders: { "x-test-user": "owner" } });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    const fill = (label, value) => page.getByLabel(label, { exact: true }).fill(value);
    const next = () => page.getByRole("button", { name: "Continue", exact: true }).click();
    async function conversation() {
      await fill("Street address", "456 Browser Fixture Ave");
      await page.getByLabel("Town", { exact: true }).selectOption("Ironwood|MI");
      await fill("ZIP code", "49938"); await next();
      await fill("Describe the project", "Remove a synthetic sofa for the browser acceptance test");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      assert.equal(await page.getByLabel("Street address").inputValue(), "456 Browser Fixture Ave"); await next();
      assert.match(await page.getByLabel("Describe the project").inputValue(), /synthetic sofa/); await next();
      await fill("Preferred day, time or flexibility", "Next Friday afternoon, flexible");
      await page.getByLabel("Your time zone").selectOption("America/Detroit"); await next();
      await fill("Your answer", "No stairs; parking near the door"); await next();
      await fill("First name", "Synthetic"); await fill("Last name", "Browser");
      await fill("Phone number", "202-555-0198"); await fill("Email", "browser@example.test"); await next();
      assert.match(await page.locator(".lead-bot-review").innerText(), /Eastern/);
      await page.getByRole("checkbox").check();
    }
    let previewPosts = 0;
    page.on("request", req => { if (req.url().endsWith("/api/leads/quick-request")) previewPosts++; });
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(`${origin}/lead-bot/${botId}?preview=1`);
      await page.getByRole("heading", { name: "Where can we help?" }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${width}px`);
      if (width === 390) {
        await mkdir("/tmp/jc-lead-bot-browser", { recursive: true });
        await page.screenshot({ path: "/tmp/jc-lead-bot-browser/preview-390.png", fullPage: true });
      }
    }
    await conversation();
    await page.getByRole("button", { name: "Finish preview" }).click();
    await page.getByRole("heading", { name: "Preview complete." }).waitFor();
    assert.equal(previewPosts, 0, "Owner preview never submits");

    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto(`${origin}/lead-bot/${botId}`);
    await fill("Street address", "456 Browser Fixture Ave");
    await page.reload();
    assert.equal(await page.getByLabel("Street address").inputValue(), "456 Browser Fixture Ave", "Reload retains answers");
    await conversation();
    let posts = 0, identity;
    await page.route("**/api/leads/quick-request", async route => {
      const payload = route.request().postDataJSON();
      if (posts++ === 0) {
        identity = payload.submissionKey;
        const committed = await route.fetch(); assert.equal(committed.status(), 201);
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic lost response. Please retry." }) });
      } else {
        assert.equal(payload.submissionKey, identity, "Lost-response retry preserves identity");
        await route.continue();
      }
    });
    await page.getByRole("button", { name: "Send inquiry" }).click();
    await page.getByRole("alert").filter({ hasText: "Synthetic lost response" }).waitFor();
    await page.getByRole("button", { name: "Send inquiry" }).click();
    await page.getByRole("heading", { name: "Thanks. Your inquiry is with our team." }).waitFor();
    assert.equal(posts, 2);
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(k => k.endsWith(":public"))), false, "Contact draft clears after success");

    await page.goto(`${origin}/synthetic-owner-builder`);
    await page.getByRole("heading", { name: "Representative lead-bot builder" }).waitFor();
    await page.getByLabel("Bot name", { exact: true }).fill("Edited synthetic pilot");
    assert.equal(await page.getByRole("button", { name: "Approve saved configuration" }).isDisabled(), true, "Unsaved edits cannot be approved");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
    await page.getByRole("button", { name: "Approve saved configuration" }).click();
    await page.getByText("approved", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByText("paused", { exact: true }).waitFor();
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log("PASS: actual Chromium at 320/390/1280px, owner preview, builder edit/approval/pause, canonical HTTP conversion and lost-response retry");
  } finally { await browser.close(); }
}
