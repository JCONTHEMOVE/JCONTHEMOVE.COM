import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

// Render the real components against real TanStack Query cache transitions.
// No browser, production API, database, or extra test dependency is required.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(root, "node_modules", ".store-ui-test-"));
after(() => rm(temporary, { recursive: true, force: true }));
const bundle = path.join(temporary, "components.mjs");
await build({
  stdin: {
    contents: [
      "export { ShopSwitcher } from './client/src/components/shop-switcher';",
      "export { default as AshleyShop } from './client/src/pages/nature-made-jewls';",
      "export { CartProvider } from './client/src/hooks/useCart';",
    ].join("\n"),
    resolveDir: root,
    loader: "tsx",
  },
  outfile: bundle,
  absWorkingDir: root,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  jsx: "automatic",
  define: { "import.meta.env.VITE_API_BASE_URL": '""' },
});
const { ShopSwitcher, AshleyShop, CartProvider } = await import(pathToFileURL(bundle).href);

const catalogKey = ["/api/jewelry", { category: undefined, search: "" }];
const sampleItems = [
  { id: "fixture-bracelet", title: "Fixture Copper Bracelet", price: "42.50", category: "bracelets", inStock: true, status: "active", createdAt: "2026-09-01" },
  { id: "fixture-ring", title: "Fixture Sold Ring", price: "30.00", category: "rings", inStock: false, status: "sold", createdAt: "2026-09-01" },
];

function clientFor(t, role = "customer") {
  const client = new QueryClient({
    defaultOptions: { queries: {
      queryFn: async () => { throw new Error("Unexpected fixture query"); },
      retry: false,
      retryOnMount: false,
      refetchOnMount: false,
      staleTime: Infinity,
      gcTime: Infinity,
    } },
  });
  t.after(() => client.clear());
  client.setQueryData(["/api/auth/user"], role ? { id: "fixture-user", role, status: "active" } : null);
  return client;
}

function render(client, component, location = "/handmade-jewels-by-ashley") {
  return renderToStaticMarkup(
    h(QueryClientProvider, { client },
      h(Router, { ssrPath: location }, h(CartProvider, null, h(component)))),
  );
}

async function failFetch(client, queryKey = catalogKey) {
  await assert.rejects(client.fetchQuery({
    queryKey,
    staleTime: 0,
    queryFn: async () => { throw new Error("Fixture transient outage"); },
  }), /Fixture transient outage/);
  assert.equal(client.getQueryState(queryKey).status, "error");
}

for (const role of ["employee", "admin", "business_owner"]) {
  test(role + ": switcher uses the existing crew earnings destination", (t) => {
    const html = render(clientFor(t, role), ShopSwitcher, "/crew/earnings");
    assert.match(html, /<a(?=[^>]*href="\/crew\/earnings")(?=[^>]*aria-current="page")/);
    assert.match(html, />Earnings<\/a>/);
    assert.doesNotMatch(html, /href="\/wallet"/);
  });
}

test("customer: switcher retains the wallet destination", (t) => {
  const html = render(clientFor(t), ShopSwitcher, "/wallet");
  assert.match(html, /<a(?=[^>]*href="\/wallet")(?=[^>]*aria-current="page")/);
  assert.match(html, />Wallet<\/a>/);
  assert.doesNotMatch(html, /href="\/crew\/earnings"/);
});

for (const role of [null, "unknown_role"]) {
  test((role ?? "guest") + ": switcher omits inaccessible wallet links", (t) => {
    const html = render(clientFor(t, role), ShopSwitcher);
    assert.doesNotMatch(html, /href="\/(?:wallet|crew\/earnings)"/);
    assert.match(html, /href="\/services"/);
    assert.match(html, /<a(?=[^>]*href="\/handmade-jewels-by-ashley")(?=[^>]*aria-current="page")/);
    assert.match(html, /href="\/marketplace"/);
  });
}

test("loading auth does not expose a wallet destination", (t) => {
  const client = clientFor(t);
  client.removeQueries({ queryKey: ["/api/auth/user"] });
  assert.doesNotMatch(render(client, ShopSwitcher), /href="\/(?:wallet|crew\/earnings)"/);
});

test("catalog first load shows loading, not an error or empty inventory", (t) => {
  const html = render(clientFor(t), AshleyShop);
  assert.match(html, /Loading beautiful pieces/);
  assert.doesNotMatch(html, /Could not load|No pieces found/);
});

test("catalog initial failure offers Retry without claiming there are no pieces", async (t) => {
  const client = clientFor(t);
  await failFetch(client);
  const html = render(client, AshleyShop);
  assert.match(html, /role="alert"/);
  assert.match(html, /Could not load Ashley/);
  assert.match(html, /Retry shop/);
  assert.doesNotMatch(html, /No pieces found/);
});

test("successful empty catalog keeps the empty state", (t) => {
  const client = clientFor(t);
  client.setQueryData(catalogKey, []);
  const html = render(client, AshleyShop);
  assert.match(html, /No pieces found/);
  assert.doesNotMatch(html, /Could not load|Could not refresh/);
});

test("background failure preserves cached pieces, prices, and sold state", async (t) => {
  const client = clientFor(t);
  client.setQueryData(catalogKey, sampleItems);
  await failFetch(client);
  const html = render(client, AshleyShop);
  for (const item of sampleItems) {
    assert.ok(html.includes(item.title));
  }
  assert.ok(html.includes(sampleItems[0].price));
  assert.match(html, /Sold/);
  assert.match(html, /role="status"/);
  assert.match(html, /Could not refresh/);
  assert.match(html, /Retry shop/);
  assert.doesNotMatch(html, /Could not load Ashley/);
  assert.deepEqual(client.getQueryData(catalogKey), sampleItems);
});

test("refetch failure after an empty success keeps the known empty result", async (t) => {
  const client = clientFor(t);
  client.setQueryData(catalogKey, []);
  await failFetch(client);
  const html = render(client, AshleyShop);
  assert.match(html, /No pieces found/);
  assert.match(html, /Could not refresh/);
  assert.doesNotMatch(html, /Could not load Ashley/);
});

test("successful retry replaces cached results and clears the refresh notice", async (t) => {
  const client = clientFor(t);
  client.setQueryData(catalogKey, sampleItems);
  await failFetch(client);
  const updated = [{ ...sampleItems[0], title: "Fixture Refreshed Bracelet" }];
  await client.fetchQuery({ queryKey: catalogKey, staleTime: 0, queryFn: async () => updated });
  const html = render(client, AshleyShop);
  assert.match(html, /Fixture Refreshed Bracelet/);
  assert.doesNotMatch(html, /Fixture Sold Ring|Could not load|Could not refresh|Retry shop/);
});

test("inventory cached for another query does not mask an initial load failure", async (t) => {
  const client = clientFor(t);
  client.setQueryData(["/api/jewelry"], sampleItems);
  client.setQueryData(["/api/jewelry", { category: "rings", search: "" }], sampleItems);
  await failFetch(client);
  const html = render(client, AshleyShop);
  assert.match(html, /Could not load Ashley/);
  assert.doesNotMatch(html, /Fixture Copper Bracelet|Fixture Sold Ring/);
});
