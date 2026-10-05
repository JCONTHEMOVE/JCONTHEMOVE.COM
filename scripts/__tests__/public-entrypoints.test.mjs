import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPublicEntrypoints } from "../check-public-entrypoints.mjs";

const html = '<title>JC ON THE MOVE LLC</title><div id="root"></div><script src="/assets/app.js"></script>';
function response(url, { status = 200, body = html, type = "text/html" } = {}) {
  return { url, ok: status === 200, status, headers: new Headers({ "content-type": type }), text: async () => body };
}

test("healthy www does not hide apex timeouts; pages and attribution are probed", async () => {
  const calls = [];
  const results = await checkPublicEntrypoints({ fetchImpl: async (url, options) => {
    calls.push(url);
    assert.ok(options.signal instanceof AbortSignal);
    if (new URL(url).hostname === "jconthemove.com") throw new Error("timeout");
    return response(url);
  } });
  assert.equal(calls.length, 5);
  assert.equal(results.filter((result) => !result.ok).length, 3);
  assert.ok(results.filter((result) => result.ok).every((result) => result.url.includes("www.")));
});

test("apex redirect to www preserves the booking path", async () => {
  const results = await checkPublicEntrypoints({ fetchImpl: async (url) => response(url.replace("https://jconthemove", "https://www.jconthemove")) });
  assert.ok(results.every((result) => result.ok));
});

test("rejects error pages, wrong applications and bad redirects", async () => {
  const url = "https://jconthemove.com/book";
  for (const invalid of [
    response(url, { status: 503 }),
    response(url, { body: "<title>Service unavailable</title>" }),
    response(url, { type: "application/json" }),
    response("https://www.jconthemove.com/"),
    response("http://www.jconthemove.com/book"),
    response("https://example.com/book"),
  ]) {
    const [result] = await checkPublicEntrypoints({ urls: [url], fetchImpl: async () => invalid });
    assert.equal(result.ok, false);
  }
});

test("a response-body timeout fails the probe", async () => {
  const [result] = await checkPublicEntrypoints({ urls: ["https://www.jconthemove.com/"], fetchImpl: async (url) => ({
    ...response(url), text: async () => { throw new Error("body timeout"); },
  }) });
  assert.equal(result.ok, false);
});

test("redirects must retain booking campaign and referral parameters", async () => {
  const url = "https://jconthemove.com/book?utm_source=availability-check&rep=matt";
  for (const target of ["https://www.jconthemove.com/book", "https://www.jconthemove.com/book?rep=other"]) {
    const [result] = await checkPublicEntrypoints({ urls: [url], fetchImpl: async () => response(target) });
    assert.equal(result.ok, false);
    assert.match(result.error, /query/);
  }
});
