import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// A DOM for the real components and Radix focus behavior; never contacts a server.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://store.test/handmade-jewels-by-ashley", pretendToBeVisual: true,
});
for (const key of ["window", "document", "navigator", "location", "history", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "localStorage", "sessionStorage"])
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"])
  globalThis[key] = dom.window[key].bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
HTMLElement.prototype.scrollIntoView = function () {};
HTMLElement.prototype.scrollTo = function () {};
const requests = [];
let fixtureUser = null;
globalThis.fetch = async (...args) => {
  requests.push(args);
  // useAuth refreshes every minute; slow local runs must retain their fixture role.
  if (String(args[0]) === "/api/auth/user") return { ok: true, status: fixtureUser ? 200 : 401, json: async () => fixtureUser };
  if (String(args[0]).startsWith("/api/commerce/cart")) return { ok: true, json: async () => ({ items: [] }) };
  throw new Error("Unexpected network request in store interaction test");
};

const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Router, Route, Switch } = await import("wouter");
const { screen, within, waitFor, configure } = await import("@testing-library/dom");
// JSDOM has no stylesheet/layout; focus and DOM presence are checked explicitly.
configure({ defaultHidden: true });
const { default: userEvent } = await import("@testing-library/user-event");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(root, "node_modules", ".store-interaction-test-"));
after(async () => { dom.window.close(); await rm(temporary, { recursive: true, force: true }); });
const bundle = path.join(temporary, "components.mjs");
await build({
  stdin: {
    contents: [
      "export { default as AshleyShop } from './client/src/pages/nature-made-jewls';",
      "export { default as LoginPage } from './client/src/pages/login';",
      "export { default as JewelryDetailPage } from './client/src/pages/jewelry-detail';",
      "export { default as PaymentSuccessPage } from './client/src/pages/payment-success';",
      "export { CartProvider } from './client/src/hooks/useCart';",
    ].join("\n"), resolveDir: root, loader: "tsx",
  },
  outfile: bundle, absWorkingDir: root, bundle: true, packages: "external",
  platform: "node", format: "esm", jsx: "automatic",
  define: { "import.meta.env.VITE_API_BASE_URL": '""' },
});
const { AshleyShop, LoginPage, JewelryDetailPage, PaymentSuccessPage, CartProvider } = await import(pathToFileURL(bundle).href);
const catalogKey = ["/api/jewelry", { category: undefined, search: "" }];
const pieces = [
  { id: "fixture-bracelet", title: "Fixture Copper Bracelet", price: "42.50", category: "bracelets", inStock: true, status: "active", createdAt: "2026-09-01", photos: ["/fixture-front.jpg", "/fixture-back.jpg"] },
  { id: "fixture-ring", title: "Fixture Sold Ring", price: "30.00", category: "rings", inStock: false, status: "sold", createdAt: "2026-09-01" },
];

async function mount(t, role = "customer", width = 1200, initialPath = "/handmade-jewels-by-ashley") {
  requests.length = 0;
  localStorage.clear();
  window.innerWidth = width;
  window.history.replaceState(null, "", initialPath);
  const client = new QueryClient({ defaultOptions: { queries: {
    queryFn: async () => { throw new Error("Unseeded fixture query"); },
    retry: false, refetchOnMount: false, staleTime: Infinity, gcTime: Infinity,
  } } });
  fixtureUser = role ? { id: "fixture-user", role, status: "active" } : null;
  client.setQueryData(["/api/auth/user"], fixtureUser);
  client.setQueryData(catalogKey, structuredClone(pieces));
  client.setQueryData(["/api/jewelry"], structuredClone(pieces));
  client.setQueryData(["/api/jewelry", pieces[0].id], structuredClone(pieces[0]));
  client.setQueryData(["/api/ashley-shop/featured"], null);
  client.setQueryData(["/api/testimonials/stats"], null);
  client.setQueryData(["/api/wallet/balance"], { cashBalance: "0.00" });
  const container = document.createElement("div");
  document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(h(QueryClientProvider, { client },
    h(Router, null, h(CartProvider, null, h(Switch, null,
      h(Route, { path: "/login", component: LoginPage }),
      h(Route, { path: "/payment-success", component: PaymentSuccessPage }),
      h(Route, { path: "/handmade-jewels-by-ashley/:id" }, initialPath === "/handmade-jewels-by-ashley" ? h("p", null, "Mobile product destination") : h(JewelryDetailPage)),
      h(Route, { component: AshleyShop }),
    ))))));
  t.after(async () => {
    await act(async () => reactRoot.unmount());
    assert.deepEqual(client.getQueryData(catalogKey), pieces, "Browsing must not modify inventory");
    client.clear();
    container.remove();
    // CartProvider reads and syncs its empty fixture cart on mount; all fetches are stubbed.
    for (const [url, options = {}] of requests) {
      if (url === "/api/auth/user") {
        assert.equal(options.method || "GET", "GET");
        continue;
      }
      assert.match(url, /^\/api\/commerce\/cart(?:\?|$)/, "No account, inventory, booking, payment, or reward requests");
      if (options.method) {
        assert.equal(options.method, "PUT");
        assert.deepEqual(JSON.parse(options.body).items, [], "Browsing must leave the cart empty");
      }
    }
  });
  const user = userEvent.setup({ document, pointerEventsCheck: 0 });
  const interact = async (action) => act(action);
  return { client, user, interact };
}

// Both responsive grids exist in the DOM; CSS shows one at a time in the app.
const productButton = () => screen.getAllByRole("button", { name: "View Fixture Copper Bracelet" })[0];
const productDialog = () => screen.getByRole("dialog", { name: "Fixture Copper Bracelet" });
async function closed() { await waitFor(() => assert.equal(screen.queryByRole("dialog"), null)); }

for (const key of ["{Enter}", " "]) {
  test(`product cards open with ${key}, contain Tab focus, and return focus after Escape`, async (t) => {
    const { user, interact } = await mount(t);
    const opener = productButton();
    assert.equal(opener.tagName, "BUTTON");
    await interact(async () => { opener.focus(); await user.keyboard(key); });
    const dialog = productDialog();
    assert.equal(document.activeElement, within(dialog).getByRole("button", { name: "Close product details" }));
    const last = within(dialog).getByRole("link", { name: /Crypto checkout/ });
    await interact(async () => { last.focus(); await user.tab(); });
    assert.equal(document.activeElement, within(dialog).getByRole("button", { name: "Close product details" }));
    await interact(() => user.tab({ shift: true }));
    assert.equal(document.activeElement, last);
    await interact(() => user.keyboard("{Escape}"));
    await closed();
    await waitFor(() => assert.equal(document.activeElement, opener));
  });
}

test("named photo controls change the selected photo; close restores the card", async (t) => {
  const { user, interact } = await mount(t);
  const opener = productButton();
  await interact(() => user.click(opener));
  const dialog = within(productDialog());
  assert.equal(dialog.getByRole("button", { name: "Show photo 1" }).getAttribute("aria-pressed"), "true");
  await interact(() => user.click(dialog.getByRole("button", { name: "Next photo" })));
  assert.equal(dialog.getByRole("img", { name: pieces[0].title }).getAttribute("src"), "/fixture-back.jpg");
  assert.equal(dialog.getByRole("button", { name: "Show photo 2" }).getAttribute("aria-pressed"), "true");
  await interact(() => user.click(dialog.getByRole("button", { name: "Previous photo" })));
  assert.equal(dialog.getByRole("img", { name: pieces[0].title }).getAttribute("src"), "/fixture-front.jpg");
  await interact(() => user.click(dialog.getByRole("button", { name: "Close product details" })));
  await closed();
  await waitFor(() => assert.equal(document.activeElement, opener));
});

test("wishlist and nested product dialogs trap and restore focus without opening a product from its heart", async (t) => {
  const { user, interact } = await mount(t);
  const heart = screen.getAllByRole("button", { name: "Save Fixture Copper Bracelet to wishlist" })[0];
  await interact(async () => { heart.focus(); await user.keyboard(" "); });
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(heart.getAttribute("aria-pressed"), "true");
  const opener = screen.getByRole("button", { name: "Wishlist", exact: true });
  await interact(() => user.click(opener));
  const wishlist = screen.getByRole("dialog", { name: "My Wishlist (1)" });
  const remove = within(wishlist).getByRole("button", { name: "Remove Fixture Copper Bracelet from wishlist" });
  await interact(async () => { remove.focus(); await user.tab(); });
  assert.equal(document.activeElement, within(wishlist).getByRole("button", { name: "Close wishlist" }));
  await interact(() => user.tab({ shift: true }));
  assert.equal(document.activeElement, remove);
  const view = within(wishlist).getByRole("button", { name: "View Fixture Copper Bracelet" });
  await interact(() => user.click(view));
  assert.ok(productDialog());
  await interact(() => user.keyboard("{Escape}"));
  await waitFor(() => assert.equal(document.activeElement, view));
  await interact(() => user.keyboard("{Escape}"));
  await closed();
  await waitFor(() => assert.equal(document.activeElement, opener));
});

test("mobile keyboard selection preserves the dedicated product route", async (t) => {
  const { user, interact } = await mount(t, "customer", 390);
  await interact(async () => { productButton().focus(); await user.keyboard("{Enter}"); });
  assert.equal(window.location.pathname, "/handmade-jewels-by-ashley/fixture-bracelet");
  assert.ok(screen.getByText("Mobile product destination"));
  assert.equal(screen.queryByRole("dialog"), null);
});

test("header, search, filters, and custom-order form have accessible names and focus returns", async (t) => {
  const { client, user, interact } = await mount(t, null);
  assert.ok(screen.getByRole("link", { name: "Back to home" }));
  assert.ok(screen.getAllByRole("link", { name: "Email Ashley" }).length);
  assert.ok(screen.getByRole("link", { name: "Call Ashley" }));
  assert.equal(document.querySelector("a button, button a"), null);
  assert.ok(screen.getByRole("textbox", { name: "Search pieces" }));
  client.setQueryData(["/api/jewelry", { category: "rings", search: "" }], [pieces[1]]);
  const rings = screen.getByRole("button", { name: /Rings/ });
  await interact(() => user.click(rings));
  assert.equal(rings.getAttribute("aria-pressed"), "true");
  assert.equal(screen.getByRole("button", { name: /All Pieces/ }).getAttribute("aria-pressed"), "false");
  const opener = screen.getByRole("button", { name: "🎁 Request Custom Order" });
  await interact(() => user.click(opener));
  const dialog = within(screen.getByRole("dialog", { name: "Request a Custom Order" }));
  for (const name of ["Your Name *", "What would you like? *", "Preferred Materials", "Budget Range", "Contact (email or phone) *"])
    assert.ok(dialog.getByRole("textbox", { name }));
  await interact(() => user.keyboard("{Escape}"));
  await closed();
  await waitFor(() => assert.equal(document.activeElement, opener));
});

test("product-to-custom-order transition keeps focus in the form and returns to the product card", async (t) => {
  const { user, interact } = await mount(t);
  const opener = productButton();
  await interact(() => user.click(opener));
  await interact(() => user.click(within(productDialog()).getByRole("button", { name: /Request a Custom Order Like This/ })));
  const form = screen.getByRole("dialog", { name: "Request a Custom Order" });
  await waitFor(() => assert.ok(form.contains(document.activeElement)));
  await interact(() => user.keyboard("{Escape}"));
  await closed();
  await waitFor(() => assert.equal(document.activeElement, opener));
});

test("admin listing and edit controls are named and dismiss without modifying inventory", async (t) => {
  const { user, interact } = await mount(t, "admin");
  await interact(() => user.click(screen.getByRole("button", { name: "Add Piece" })));
  const add = within(screen.getByRole("dialog", { name: "Add New Piece" }));
  for (const name of ["Title *", "Price", "Materials", "Short Description", "Full Description", "Photo or video URL"])
    assert.ok(add.getByRole("textbox", { name }));
  assert.ok(add.getByRole("combobox", { name: "Category" }));
  assert.ok(add.getByLabelText("Upload photos or videos"));
  assert.ok(add.getByRole("button", { name: "Mark as featured" }));
  await interact(() => user.keyboard("{Escape}"));
  await closed();
  const ai = screen.getByRole("button", { name: "AI List" });
  await interact(() => user.click(ai));
  const chat = within(screen.getByRole("dialog", { name: "Ashley Shop Assistant" }));
  assert.ok(chat.getByLabelText("Upload listing photos or videos"));
  assert.ok(chat.getByRole("textbox", { name: "Reply to listing assistant" }));
  assert.ok(chat.getByRole("button", { name: "Send reply" }));
  await interact(() => user.keyboard("{Escape}"));
  await closed();
  await waitFor(() => assert.equal(document.activeElement, ai));
  const opener = productButton();
  await interact(() => user.click(opener));
  await interact(() => user.click(within(productDialog()).getByRole("button", { name: "Edit", exact: true })));
  assert.ok(within(screen.getByRole("dialog", { name: "Edit Piece" })).getByRole("textbox", { name: "Title", exact: true }));
  await interact(() => user.keyboard("{Escape}"));
  await closed();
  await waitFor(() => assert.equal(document.activeElement, opener));
});

test("signup opens the existing registration form with a return path to Ashley’s store", async (t) => {
  const { user, interact } = await mount(t, null);
  await interact(() => user.click(screen.getByRole("link", { name: /Sign up free/ })));
  assert.equal(window.location.pathname, "/login");
  const params = new URLSearchParams(window.location.search);
  assert.equal(params.get("mode"), "register");
  assert.equal(params.get("redirect"), "/handmade-jewels-by-ashley");
  assert.ok(screen.getByPlaceholderText("First name"));
  assert.ok(screen.getByRole("button", { name: /Create Account/i }));
});

for (const initialPath of [
  "/handmade-jewels-by-ashley/fixture-bracelet",
  "/payment-success?itemId=fixture-bracelet&orderId=fixture-order",
]) {
  test(`guest registration from ${initialPath} opens registration and preserves the product destination`, async (t) => {
    const { user, interact } = await mount(t, null, 390, initialPath);
    await interact(() => user.click(screen.getByRole("link", { name: /Create Account/ })));
    assert.equal(window.location.pathname, "/login");
    const params = new URLSearchParams(window.location.search);
    assert.equal(params.get("mode"), "register");
    assert.equal(params.get("redirect"), "/handmade-jewels-by-ashley/fixture-bracelet");
    assert.ok(screen.getByPlaceholderText("First name"));
    assert.ok(screen.getByRole("button", { name: /Create Account/i }));
    assert.ok(!window.location.search.includes("fixture-order"));
    assert.ok(!requests.some(([url]) => String(url).includes("payment-complete")));
  });
}
