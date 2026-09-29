import assert from 'node:assert/strict';
import { after, test } from 'node:test';
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
const temporary = await mkdtemp(path.join(root, 'node_modules', '.quick-book-address-test-'));
after(async () => { dom.window.close(); await rm(temporary, { recursive: true, force: true }); });
const bundle = path.join(temporary, 'quick-book.mjs');
let fixtureAddress;
let detailsPromise;
window.google = { maps: { async importLibrary() {
  return {
    AutocompleteSessionToken: class {},
    AutocompleteSuggestion: { async fetchAutocompleteSuggestions() {
      const address = fixtureAddress;
      return { suggestions: [{ placePrediction: {
        placeId: address, text: { toString: () => address },
        toPlace() {
          const [number, ...street] = address.split(',')[0].split(' ');
          const part = (value, type) => ({ longText: value, shortText: value, types: [type] });
          return {
            formattedAddress: address,
            addressComponents: [part(number, 'street_number'), part(street.join(' '), 'route')],
            async fetchFields() { await detailsPromise; },
          };
        },
      } }] };
    } },
  };
} } };
await build({
  stdin: {
    contents: "export { default as QuickBookPage } from './client/src/pages/quick-book'; export { EMPTY_QUICK_BOOK_DRAFT } from './shared/quickBook';",
    resolveDir: root, loader: 'tsx',
  },
  outfile: bundle, absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{
    name: 'isolated-chat-presentation',
    setup(build) {
      // Keep chat presentation out of this address-save regression. The real
      // page, address component, blur events, and request lifecycle run below.
      build.onResolve({ filter: /^@\/components\/ai-elements\// }, args => ({ path: args.path, namespace: 'chat-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'chat-fixture' }, () => ({ resolveDir: root, loader: 'jsx', contents: `
        import React from 'react';
        const Shell = ({children}) => <div>{children}</div>;
        const Empty = () => null;
        export const Conversation = Shell, ConversationContent = Shell, ConversationScrollButton = Empty,
          Message = Shell, MessageContent = Shell, MessageResponse = Shell,
          PromptInput = Shell, PromptInputBody = Shell, PromptInputFooter = Shell, PromptInputTools = Shell,
          PromptInputSubmit = Empty, PromptInputTextarea = Empty, Suggestions = Shell, Suggestion = Empty, SpeechInput = Empty;
      ` }));
    },
  }],
});
const { QuickBookPage, EMPTY_QUICK_BOOK_DRAFT } = await import(pathToFileURL(bundle).href);

for (const [field, label, address] of [
  ['pickupAddress', 'Pickup or service address', '222 East Aurora Street, Ironwood, MI 49938, USA'],
  ['destinationAddress', 'Destination address', '111 Silver Street, Hurley, WI 54534, USA'],
]) {
  for (const detailsFirst of [true, false]) {
  test(`Quick Book preserves ${field} when place details finish ${detailsFirst ? 'before' : 'after'} its blur save`, async t => {
    fixtureAddress = address;
    let finishDetails;
    detailsPromise = new Promise(resolve => { finishDetails = resolve; });
    let session = {
      id: 'fixture-address-session', status: 'draft', revision: 1,
      draft: { ...structuredClone(EMPTY_QUICK_BOOK_DRAFT), pickupAddress: '100 Example St, Bessemer, MI 49911' },
      fieldMeta: {}, missingFields: [], reviewReasons: [],
      readiness: { ready: false, missingFields: [], reviewReasons: [] }, quote: null, crewSuggestions: [],
      assistantMessage: 'Fixture draft', nextQuestion: 'Add an address', suggestions: [],
      agent: { provider: 'deterministic', model: 'fixture', fallbackUsed: false },
      startedAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z', canComplete: false,
    };
    const initialDraft = structuredClone(session.draft);
    const requests = [];
    let finishFirstSave;
    let finishSecondSave;
    const reply = value => new Response(JSON.stringify(value), { status: 200 });
    globalThis.fetch = async (url, options = {}) => {
      if (url === '/api/quick-book/sessions/current') return reply(session);
      assert.equal(url, '/api/quick-book/sessions/fixture-address-session/message', 'Only fixture draft updates are allowed');
      assert.equal(options.method, 'POST');
      const payload = JSON.parse(options.body);
      requests.push(payload);
      assert.equal(payload.expectedRevision, session.revision);
      const save = () => {
        session = { ...session, revision: session.revision + 1, draft: { ...session.draft, ...payload.patch } };
        return reply(session);
      };
      if (requests.length === 1) return new Promise(resolve => { finishFirstSave = () => resolve(save()); });
      assert.equal(requests.length, 2, 'Only the partial and selected address should be saved');
      return new Promise(resolve => { finishSecondSave = () => resolve(save()); });
    };
    const container = document.createElement('div');
    document.body.append(container);
    const reactRoot = createRoot(container);
    t.after(async () => { await act(async () => reactRoot.unmount()); container.remove(); });
    await act(async () => reactRoot.render(h(QuickBookPage)));
    const input = screen.getByRole('combobox', { name: label });
    const user = userEvent.setup({ document });
    await act(async () => { await user.clear(input); await user.type(input, '222 East'); });
    await act(() => new Promise(resolve => setTimeout(resolve, 400)));
    await act(() => user.click(screen.getByRole('option', { name: address })));
    assert.equal(document.activeElement, input, 'Selecting a suggestion does not blur the input');
    await act(() => user.tab());
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].patch, { [field]: '222 East' });
    assert.equal(input.disabled, false, 'A save must not cancel the selected place details');
    if (detailsFirst) {
      await act(async () => { finishDetails(); });
      assert.equal(input.value, address);
      assert.equal(requests.length, 1, 'The selected address waits for the current save');
      await act(async () => { finishFirstSave(); });
    } else {
      await act(async () => { finishFirstSave(); });
      assert.equal(requests.length, 1);
      await act(async () => { finishDetails(); });
    }
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].patch, { [field]: address });
    assert.equal(requests[1].expectedRevision, 2);
    assert.equal(input.value, address, 'The server response must not replace the newer selected address');
    await act(async () => { finishSecondSave(); });
    assert.deepEqual(session.draft, { ...initialDraft, [field]: address }, 'Saving one address preserves all other draft fields');
  });
  }
}
