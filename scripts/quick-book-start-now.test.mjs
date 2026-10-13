import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fixture.test/quick-book', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[key] = dom.window[key].bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
HTMLElement.prototype.scrollIntoView = function () {};
window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { screen } = await import('@testing-library/dom');
const { default: userEvent } = await import('@testing-library/user-event');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(root, 'node_modules', '.quick-book-start-now-test-'));
after(async () => { dom.window.close(); await rm(temporary, { recursive: true, force: true }); });
const bundle = path.join(temporary, 'quick-book.mjs');
await build({
  stdin: { contents: "export { default as QuickBookPage } from './client/src/pages/quick-book'; export { quickBookDraftSchema, evaluateQuickBookReadiness } from './shared/quickBook';", resolveDir: root, loader: 'tsx' },
  outfile: bundle, absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'isolated-chat-presentation', setup(build) {
    build.onResolve({ filter: /^@\/components\/ai-elements\// }, args => ({ path: args.path, namespace: 'chat-fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'chat-fixture' }, () => ({ resolveDir: root, loader: 'jsx', contents: `
      import React from 'react'; const Shell = ({children}) => <div>{children}</div>; const Empty = () => null;
      export const Conversation = Shell, ConversationContent = Shell, ConversationScrollButton = Empty,
        Message = Shell, MessageContent = Shell, MessageResponse = Shell, PromptInput = Shell, PromptInputBody = Shell,
        PromptInputFooter = Shell, PromptInputTools = Shell, PromptInputSubmit = Empty, PromptInputTextarea = Empty,
        Suggestions = Shell, Suggestion = Empty, SpeechInput = Empty;
    ` }));
  } }],
});
const { QuickBookPage, quickBookDraftSchema, evaluateQuickBookReadiness } = await import(pathToFileURL(bundle).href);
const serverNow = '2026-10-13T14:19:08Z';
function makeSession(canComplete = true) {
  const draft = quickBookDraftSchema.parse({
    customerName: 'Fixture Customer', customerPhone: '9065550100', smsConsent: true,
    pickupAddress: '100 Example Street, Ironwood, MI 49938', confirmedDate: '2026-10-13',
    arrivalWindow: '9:00 AM – 10:00 AM', workScope: 'load_only', truckConfig: 'customer_truck',
    crewSize: 2, estimatedHours: 2, crewMemberIds: ['owner', 'worker'], crewLeadUserId: 'worker',
    crewConfirmed: true, stairsFlights: 0, hasElevator: false, specialItemsConfirmed: true,
  });
  const readiness = evaluateQuickBookReadiness(draft, { now: new Date(serverNow), quoteReady: true });
  return { id: 'ui-fixture', status: 'draft', revision: 20, draft, fieldMeta: {}, ...readiness, readiness,
    quote: { total: 275, rewardEligibleTotal: 275 }, crewSuggestions: [], suggestions: [], assistantMessage: 'Fixture draft',
    nextQuestion: 'Choose Start now', agent: { provider: 'deterministic', model: 'fixture', fallbackUsed: false },
    startedAt: serverNow, updatedAt: serverNow, serverNow, canComplete, bookingBlocker: canComplete ? null : 'live_booking_disabled' };
}
async function mount(t) {
  const container = document.createElement('div'); document.body.append(container);
  const reactRoot = createRoot(container);
  t.after(async () => { await act(async () => reactRoot.unmount()); container.remove(); });
  await act(async () => reactRoot.render(h(QuickBookPage)));
  return userEvent.setup({ document });
}

test('Start now saves the existing draft, then posts once with its new revision', async t => {
  let session = makeSession(); const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
    if (url === '/api/quick-book/sessions/current') return Response.json(session);
    if (url === '/api/quick-book/sessions/ui-fixture/message') {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.patch, { startNow: true }, 'The browser sends intent without inventing a time');
      assert.equal(body.expectedRevision, 20);
      session = { ...session, revision: 21, draft: { ...session.draft, startNow: true } };
      const readiness = evaluateQuickBookReadiness(session.draft, { now: new Date(serverNow), quoteReady: true });
      session = { ...session, ...readiness, readiness };
      return Response.json(session);
    }
    assert.equal(url, '/api/quick-book/sessions/ui-fixture/book');
    assert.equal(JSON.parse(options.body).expectedRevision, 21);
    return Response.json({ leadId: 'fixture-lead', bookingId: 'fixture-booking', total: 275,
      startNowBookedAt: serverNow, deliveries: [], customerMessageSent: false, squareInvoiceCreated: false });
  };
  const user = await mount(t);
  assert.equal(screen.getByRole('button', { name: 'Book & Alert Crew', exact: true }).disabled, true);
  await act(() => user.click(screen.getByRole('button', { name: 'Start now', exact: true })));
  assert.equal(requests.filter(r => r.url.endsWith('/book')).length, 0);
  assert.match(screen.getByText(/Start now selected/).textContent, /Pickup, dispatch and on-site work are tracked separately/);
  await act(() => user.click(screen.getByRole('button', { name: 'Start now & Alert Crew', exact: true })));
  assert.equal(requests.filter(r => r.url.endsWith('/book')).length, 1);
  assert.ok(screen.getByText(/on-site work has not been marked started/));
});

test('Disabled live booking is explained accurately, and refresh never abandons the draft', async t => {
  const session = makeSession(false); const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    assert.ok(['/api/quick-book/sessions/current', '/api/quick-book/sessions/ui-fixture'].includes(url));
    assert.equal(options.method, undefined);
    return Response.json(session);
  };
  const user = await mount(t);
  assert.ok(screen.getByText(/Live Quick Book is turned off/));
  assert.equal(screen.queryByText(/Your staff account/), null);
  await act(() => user.click(screen.getByRole('button', { name: 'Refresh saved draft' })));
  assert.equal(requests.at(-1).url, '/api/quick-book/sessions/ui-fixture');
  assert.ok(requests.every(r => r.method === 'GET'));
});
