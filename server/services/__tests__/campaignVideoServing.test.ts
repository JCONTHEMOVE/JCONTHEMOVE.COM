import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";

// Exercise the actual legacy route registration without starting the application,
// its database, or notification services. Public files use Express static serving
// just as the built application does.
const source = await readFile("server/index.ts", "utf8");
const start = source.indexOf("    // Only legacy root-level videos");
const end = source.indexOf("    // Serve specific static HTML", start);
assert.ok(start >= 0 && end > start);
const app = express();
// Keep the route RegExp in Express's realm (its matcher uses instanceof RegExp).
new Function("app", "path", "process", source.slice(start, end))(app, path, process);
app.use(express.static(path.resolve("client/public")));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/campaigns/carpet-removal/slideshow.mp4`;
try {
  const bytes = await readFile("client/public/campaigns/carpet-removal/slideshow.mp4");
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200, "campaign video must not be intercepted by the workspace route");
  assert.equal(head.headers.get("content-type"), "video/mp4");
  assert.equal(Number(head.headers.get("content-length")), bytes.length);
  const range = await fetch(url, { headers: { Range: "bytes=0-31" } });
  assert.equal(range.status, 206, "browser media range requests must succeed");
  assert.equal(range.headers.get("content-range"), `bytes 0-31/${bytes.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 32));
  console.log("Campaign video serving: HEAD, MIME, length, partial content and file bytes passed.");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
