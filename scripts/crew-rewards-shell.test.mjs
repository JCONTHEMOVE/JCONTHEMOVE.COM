import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://fixture.test/crew", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "location", "history", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "MutationObserver", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "localStorage", "DocumentFragment"])
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"]) globalThis[key] = dom.window[key].bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = function () {};
if (!globalThis.PointerEvent) globalThis.PointerEvent = class PointerEvent extends MouseEvent {};
for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"]) {
  if (!Element.prototype[method]) Element.prototype[method] = function () {};
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
globalThis.fetch = async () => { throw new Error("No network is allowed in this fixture"); };

const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { screen, within, configure, fireEvent } = await import("@testing-library/dom");
const { Router, Switch, Route, Redirect } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
configure({ defaultHidden: true });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
const temporary = await mkdtemp(path.join(root, "node_modules", ".crew-rewards-shell-"));
after(async () => { dom.window.close(); await rm(temporary, { recursive: true, force: true }); });
const bundle = path.join(temporary, "components.mjs");
await build({
  stdin: {
    contents: [
      "export { ShopSwitcher } from './client/src/components/shop-switcher';",
      "export { default as CrewLayout } from './client/src/layouts/CrewLayout';",
      "export { RewardsLink } from './client/src/components/task-ui';",
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
  alias: {
    "@/components/ui/sheet": path.join(root, "scripts/fixtures/crew-rewards-shell-shims.tsx"),
    "@/components/tutorial-invite-dialog": path.join(root, "scripts/fixtures/crew-rewards-shell-shims.tsx"),
  },
});
const { ShopSwitcher, CrewLayout, RewardsLink } = await import(pathToFileURL(bundle).href);

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return source.slice(start, end);
}

function crewRoutes(source) {
  const crew = sliceBetween(source, 'if (location.startsWith("/crew"))', 'if (location === "/quick-book")');
  const body = sliceBetween(crew, "<Switch>", "</Switch>");
  const routes = [];
  for (const line of body.split("\n")) {
    const routed = line.match(/<Route path="([^"]+)">(?:<([A-Za-z0-9]+) \/>)?/);
    if (routed) routes.push({ path: routed[1], component: routed[2] || null });
    else if (line.includes('<Redirect to="/crew" />')) routes.push({ redirect: "/crew" });
  }
  return { crew, routes };
}

test("direct load of /crew/rewards is the marketplace page inside the crew shell", () => {
  const { crew, routes } = crewRoutes(appSource);
  assert.match(crew, /<CrewLayout>/);
  assert.equal(crew.includes('path="/marketplace"'), false);
  const rewards = routes.find((route) => route.path === "/crew/rewards");
  assert.equal(rewards?.component, "RewardsMarketplacePage");
  const rewardsAt = routes.findIndex((route) => route.path === "/crew/rewards");
  const homeAt = routes.findIndex((route) => route.path === "/crew");
  const redirectAt = routes.findIndex((route) => route.redirect === "/crew");
  assert.ok(rewardsAt >= 0 && homeAt > rewardsAt && redirectAt > homeAt);

  const customer = sliceBetween(appSource, "function CustomerApp", "function AuthenticatedApp");
  assert.match(customer, /<Route path="\/marketplace">\s*<PageWrapper component=\{RewardsMarketplacePage\} \/>/);
  assert.equal(customer.includes('path="/crew/rewards"'), false);
});

test("refreshing /crew/rewards still matches the crew page and an unknown crew path falls home", async () => {
  const { routes } = crewRoutes(appSource);
  async function renderAt(initial) {
    const memory = memoryLocation({ path: initial, record: true });
    const node = document.createElement("div");
    document.body.append(node);
    const reactRoot = createRoot(node);
    await act(async () => {
      reactRoot.render(h(Router, { hook: memory.hook }, h(Switch, null, ...routes.map((route) => (
        route.redirect
          ? h(Route, { key: "fallback" }, h(Redirect, { to: route.redirect }))
          : h(Route, { key: route.path, path: route.path }, h("div", null, route.component || route.path))
      )))));
    });
    const text = node.textContent;
    await act(async () => reactRoot.unmount());
    node.remove();
    return { text, history: memory.history };
  }

  const loaded = await renderAt("/crew/rewards");
  assert.equal(loaded.text, "RewardsMarketplacePage");
  assert.deepEqual(loaded.history, ["/crew/rewards"]);

  const refreshed = await renderAt("/crew/rewards?spin=1");
  assert.equal(refreshed.text, "RewardsMarketplacePage");
  assert.equal(refreshed.history.some((entry) => entry.startsWith("/marketplace")), false);

  const missing = await renderAt("/crew/not-a-page");
  assert.equal(missing.history.at(-1), "/crew");
});

function seedUser(client, role) {
  client.setQueryData(["/api/auth/user"], role ? { id: "fixture-user", role, status: "active" } : null);
}

async function mountShell(t, { role, path: initialPath, crewPreview = false }) {
  localStorage.clear();
  localStorage.setItem("jc-tutorial-invite-dismissed-v1-crew", "true");
  localStorage.setItem("jcmoves_admin_view_mode", crewPreview ? "crew" : "admin");
  const memory = memoryLocation({ path: initialPath, record: true });
  const client = new QueryClient({
    defaultOptions: { queries: { queryFn: async () => { throw new Error("Unseeded query"); }, retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  seedUser(client, role);
  document.body.style.pointerEvents = "";
  const node = document.createElement("div");
  document.body.append(node);
  const reactRoot = createRoot(node);
  const view = h(QueryClientProvider, { client }, h(Router, { hook: memory.hook }, h(CrewLayout, null, h(ShopSwitcher), h(RewardsLink))));
  await act(async () => reactRoot.render(view));
  let mounted = true;
  async function unmount() {
    if (!mounted) return;
    mounted = false;
    await act(async () => reactRoot.unmount());
    client.clear();
    node.remove();
  }
  t.after(unmount);
  return { memory, unmount, interact: (fn) => act(fn) };
}

function assertInsideCrewRewards() {
  const shop = screen.getByRole("navigation", { name: "Shop and rewards" });
  const rewards = within(shop).getByRole("link", { name: "Rewards shop", exact: true });
  assert.equal(rewards.getAttribute("href"), "/crew/rewards");
  assert.equal(rewards.getAttribute("aria-current"), "page");
  assert.equal(within(shop).queryByRole("link", { name: "Rewards shop" }).getAttribute("href") === "/marketplace", false);
  assert.equal([...shop.querySelectorAll("a")].some((anchor) => anchor.getAttribute("href") === "/marketplace"), false);
  const workerNav = screen.getByRole("navigation", { name: "Worker navigation" });
  assert.equal(within(workerNav).getByRole("button", { name: "Rewards", exact: true }).getAttribute("aria-current"), "page");
  assert.equal(screen.getByRole("link", { name: "Rewards", exact: true }).getAttribute("href"), "/crew/rewards");
}

test("employee entry points and in-page Rewards shop stay on /crew/rewards", async (t) => {
  const { interact, memory } = await mountShell(t, { role: "employee", path: "/crew" });
  assert.equal(screen.queryByText("Previewing the worker app"), null);
  const workerNav = screen.getByRole("navigation", { name: "Worker navigation" });
  assert.equal(within(workerNav).getByRole("button", { name: "Rewards", exact: true }).getAttribute("aria-current"), null);
  await interact(() => fireEvent.click(within(workerNav).getByRole("button", { name: "Rewards", exact: true })));
  assert.deepEqual(memory.history, ["/crew", "/crew/rewards"]);
  assertInsideCrewRewards();
  await interact(() => fireEvent.click(screen.getByRole("link", { name: "Rewards shop", exact: true })));
  assert.equal(memory.history.every((entry) => entry === "/crew" || entry.startsWith("/crew/rewards")), true);
  assert.equal(memory.history.some((entry) => entry.startsWith("/marketplace")), false);

  await interact(() => fireEvent.click(screen.getByRole("button", { name: "More crew options" })));
  await interact(() => fireEvent.click(screen.getByRole("button", { name: /Rewards & redemptions/ })));
  assert.equal(memory.history.at(-1), "/crew/rewards");
  assert.equal(memory.history.some((entry) => entry.startsWith("/marketplace") || entry.startsWith("/admin")), false);
});

for (const role of ["admin", "business_owner"]) {
  test(role + " crew-preview navigation keeps Rewards in the crew shell", async (t) => {
    const { interact, memory } = await mountShell(t, { role, path: "/crew", crewPreview: true });
    assert.ok(screen.getByText("Previewing the worker app"));
    assert.equal(screen.getByRole("switch", { name: "Toggle crew view" }).getAttribute("data-state"), "checked");
    await interact(() => fireEvent.click(screen.getByRole("button", { name: "Rewards", exact: true })));
    assert.deepEqual(memory.history, ["/crew", "/crew/rewards"]);
    assertInsideCrewRewards();
    assert.equal(screen.queryByRole("link", { name: "Rewards shop" }).getAttribute("href") === "/admin/marketplace", false);
    await interact(() => fireEvent.click(screen.getByRole("button", { name: "More crew options" })));
    await interact(() => fireEvent.click(screen.getByRole("button", { name: /Rewards & redemptions/ })));
    assert.equal(memory.history.at(-1), "/crew/rewards");
    assert.equal(memory.history.some((entry) => entry.startsWith("/marketplace") || entry.startsWith("/admin")), false);
  });
}

test("administrator outside crew preview still opens Rewards at /crew/rewards", async (t) => {
  const { interact, memory } = await mountShell(t, { role: "admin", path: "/crew/earnings", crewPreview: false });
  assert.ok(screen.getByText("Admin account"));
  assert.equal(screen.getByRole("link", { name: "Rewards shop", exact: true }).getAttribute("href"), "/crew/rewards");
  assert.equal(screen.getByRole("link", { name: "Rewards shop", exact: true }).getAttribute("aria-current"), null);
  await interact(() => fireEvent.click(screen.getByRole("button", { name: "Rewards", exact: true })));
  assert.equal(memory.history.at(-1), "/crew/rewards");
  assertInsideCrewRewards();
});

test("direct load and refresh keep the employee rewards shell active", async (t) => {
  const loaded = await mountShell(t, { role: "employee", path: "/crew/rewards" });
  assertInsideCrewRewards();
  assert.deepEqual(loaded.memory.history, ["/crew/rewards"]);
  await loaded.unmount();
  const refreshed = await mountShell(t, { role: "employee", path: "/crew/rewards?spin=1" });
  assertInsideCrewRewards();
  assert.deepEqual(refreshed.memory.history, ["/crew/rewards?spin=1"]);
  await refreshed.interact(() => fireEvent.click(screen.getByRole("link", { name: "Rewards shop", exact: true })));
  assert.equal(refreshed.memory.history.at(-1), "/crew/rewards");
  assert.equal(refreshed.memory.history.some((entry) => entry.startsWith("/marketplace")), false);
});
