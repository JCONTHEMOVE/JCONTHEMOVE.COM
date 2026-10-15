import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

export async function runLeadBotDom({ origin, botId }) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: `${origin}/lead-bot/${botId}`, pretendToBeVisual: true });
  for (const key of ["window", "document", "navigator", "location", "history", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "sessionStorage"]) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { screen, fireEvent } = await import("@testing-library/dom");
  const { default: userEvent } = await import("@testing-library/user-event");
  const output = path.resolve("node_modules/.cache/lead-bot-dom/component.mjs");
  await mkdir(path.dirname(output), { recursive: true });
  await build({ stdin: { contents: 'export {LeadBotConversation} from "./client/src/pages/lead-bot";', resolveDir: process.cwd(), loader: "tsx" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const { LeadBotConversation } = await import(pathToFileURL(output).href);
  const nativeFetch = globalThis.fetch;
  const bot = await (await nativeFetch(`${origin}/api/lead-bots/${botId}`)).json();
  let posts = 0, lostResponse = false, identity, pendingRequest;
  const forward = async (url, init) => {
    if (url === "/api/leads/quick-request") {
      posts++;
      const payload = JSON.parse(init.body);
      if (identity) assert.equal(payload.submissionKey, identity); else identity = payload.submissionKey;
      const response = await nativeFetch(origin + url, init);
      if (lostResponse) { lostResponse = false; assert.equal(response.status, 201); return Response.json({ error: "Synthetic response lost; please retry." }, { status: 503 }); }
      return response;
    }
    return nativeFetch(origin + url, init);
  };
  globalThis.fetch = (url, init) => {
    const result = forward(url, init);
    if (url === "/api/leads/quick-request") pendingRequest = result;
    return result;
  };
  let root;
  const click = name => React.act(async () => { await userEvent.click(screen.getByRole("button", { name, exact: true })); if (name === "Send inquiry") await pendingRequest; });
  const fill = (label, value) => React.act(async () => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }));
  const mount = async preview => { root = createRoot(document.getElementById("root")); await React.act(async () => root.render(React.createElement(LeadBotConversation, { bot: { ...bot, preview } }))); };
  const unmount = async () => React.act(async () => root.unmount());
  async function complete() {
    await fill("Street address", "789 DOM Fixture Ave"); await fill("Town", "Ironwood|MI"); await fill("ZIP code", "49938"); await click("Continue");
    assert.equal(document.activeElement?.textContent, "What would you like done?", "Step heading receives focus");
    await fill("Describe the project", "Remove two synthetic cabinets from the garage"); await click("Back");
    assert.equal(screen.getByLabelText("Street address").value, "789 DOM Fixture Ave"); await click("Continue");
    assert.match(screen.getByLabelText("Describe the project").value, /synthetic cabinets/); await click("Continue");
    await fill("Preferred day, time or flexibility", "Next month, flexible"); await fill("Your time zone", "America/Detroit"); await click("Continue");
    await fill("Your answer", "No stairs"); await click("Continue");
    await fill("First name", "Synthetic"); await fill("Last name", "DOM"); await fill("Phone number", "202-555-0188"); await fill("Email", "dom@example.test"); await click("Continue");
    assert.match(document.querySelector(".lead-bot-review").textContent, /Eastern/);
    await React.act(async () => userEvent.click(screen.getByRole("checkbox")));
  }
  try {
    await mount(true); await complete(); await click("Finish preview");
    assert.ok(screen.getByRole("heading", { name: "Preview complete." })); assert.equal(posts, 0); await unmount();
    await mount(false); await fill("Street address", "789 DOM Fixture Ave"); await unmount(); await mount(false);
    assert.equal(screen.getByLabelText("Street address").value, "789 DOM Fixture Ave", "Remount retains the session draft");
    await complete(); lostResponse = true; await click("Send inquiry");
    assert.match((await screen.findByRole("alert")).textContent, /response lost/);
    await click("Send inquiry"); assert.ok(await screen.findByRole("heading", { name: "Thanks. Your inquiry is with our team." }));
    assert.equal(posts, 2); assert.equal(sessionStorage.getItem(`jc-lead-bot:${bot.id}:${bot.revision}:public`), null);
    console.log("PASS: real React DOM → canonical HTTP → SQL → receipt, preview isolation, focus, retained answers and lost-response recovery");
  } finally { await unmount(); globalThis.fetch = nativeFetch; dom.window.close(); }
}
