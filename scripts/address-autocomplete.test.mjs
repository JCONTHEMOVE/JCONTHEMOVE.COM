import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fixture.test/crew/add-job', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'MutationObserver', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'localStorage'])
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[key] = dom.window[key].bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = function () {};
const { createElement: h, act, useState, createRef, forwardRef } = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { screen } = await import('@testing-library/dom');
const { default: userEvent } = await import('@testing-library/user-event');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(root, 'node_modules', '.address-test-'));
after(async () => { dom.window.close(); await rm(temporary, { recursive: true, force: true }); });
const bundle = path.join(temporary, 'autocomplete.mjs');
await build({
  stdin: { contents: "export { PlacesAutocomplete } from './client/src/components/places-autocomplete'; export { StaffJobForm } from './client/src/components/StaffJobForm'; export { default as AddressField } from './client/src/components/AddressField'; export { ProjectAddressField } from './client/src/components/project-address-field';", resolveDir: root, loader: 'tsx' },
  outfile: bundle, absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
});

const delay = (ms = 400) => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
const pickup = { streetAddress: '222 East Aurora Street', city: 'Ironwood', state: 'MI', zip: '49938', lat: 46.453, lng: -90.169 };
const dropoff = { streetAddress: '111 Silver Street', city: 'Hurley', state: 'WI', zip: '54534', lat: 46.450, lng: -90.188 };
const fullAddress = address => `${address.streetAddress}, ${address.city}, ${address.state} ${address.zip}, USA`;
let fixtureId = 0;

async function mount(t, options = {}) {
  const calls = { predictions: [], details: [], imports: [], network: [], selections: [], changes: [] };
  let predictionHandler = options.predictions || (() => ({ suggestions: [] }));
  let detailsHandler = options.details || (() => undefined);
  function prediction(address) {
    const text = fullAddress(address);
    return { placePrediction: {
      placeId: address.streetAddress,
      text: { toString: () => text }, mainText: { toString: () => address.streetAddress }, secondaryText: { toString: () => `${address.city}, ${address.state}` },
      toPlace() {
        const [number, ...road] = address.streetAddress.split(' ');
        const part = (longText, type, shortText = longText) => ({ longText, shortText, types: [type] });
        const place = {
          formattedAddress: text,
          addressComponents: [...(address.routeOnly ? [part(address.streetAddress, 'route')] : [part(number, 'street_number'), part(road.join(' '), 'route')]), part(address.city, 'locality'), part(address.state, 'administrative_area_level_1'), part(address.zip, 'postal_code'), part('United States', 'country', 'US')],
          location: { lat: () => address.lat, lng: () => address.lng },
          async fetchFields(request) { calls.details.push({ address, request }); await detailsHandler(address); return { place }; },
        };
        return place;
      },
    } };
  }
  const library = {
    AutocompleteSessionToken: class {},
    AutocompleteSuggestion: { async fetchAutocompleteSuggestions(request) { calls.predictions.push(request); return predictionHandler(request, prediction); } },
  };
  if (options.noSdk) delete window.google;
  else window.google = { maps: { async importLibrary(name) { calls.imports.push(name); return library; } } };
  globalThis.fetch = async (...args) => {
    calls.network.push(args);
    if (options.fetch) return options.fetch(...args);
    if (options.noSdk && args[0] === '/api/maps-config') return new Response(JSON.stringify({ key: '' }), { status: 200 });
    throw new Error(`Unexpected network access: ${args[0]}`);
  };
  const { PlacesAutocomplete, StaffJobForm, AddressField, ProjectAddressField } = await import(`${pathToFileURL(bundle).href}?fixture=${++fixtureId}`);
  const node = document.createElement('div'); document.body.append(node);
  const reactRoot = createRoot(node);
  const render = async child => act(async () => reactRoot.render(child));
  const user = userEvent.setup({ document });
  const interact = fn => act(fn);
  const settle = () => interact(() => delay());
  const Field = forwardRef(function Field({ initial = '', onChange, onPlaceSelect, ...props }, ref) {
    const [value, setValue] = useState(initial);
    return h(PlacesAutocomplete, {
      'aria-label': 'Service address', ...props, value, ref,
      onChange: next => { calls.changes.push(next); setValue(next); onChange?.(next); },
      onPlaceSelect: place => { calls.selections.push(place); onPlaceSelect?.(place); },
    });
  });
  await render(options.children ? options.children({ Field, PlacesAutocomplete, StaffJobForm, AddressField, ProjectAddressField, calls }) : h(Field, options.props));
  t.after(async () => {
    await act(async () => reactRoot.unmount()); node.remove();
    assert.equal(calls.network.filter(([url]) => url !== '/api/maps-config' && !(options.allowedNetwork || []).includes(url)).length, 0, 'Address fields must not call an unconfigured public fallback or submit a job');
  });
  return { calls, user, interact, settle, render, Field, PlacesAutocomplete, prediction, setPredictions(fn) { predictionHandler = fn; }, setDetails(fn) { detailsHandler = fn; } };
}

test('suggestions are debounced and only requested for the focused editable field', async t => {
  const fixture = await mount(t, { props: { initial: '222 East Aurora' }, predictions: (_request, prediction) => ({ suggestions: [prediction(pickup)] }) });
  const { calls, user, interact, settle } = fixture;
  await settle();
  assert.equal(calls.predictions.length, 0, 'An existing saved address must not be sent to Places before the user focuses it');
  const input = screen.getByRole('combobox', { name: 'Service address' });
  await interact(() => user.click(input));
  await interact(() => user.clear(input));
  await interact(() => user.type(input, '222 East'));
  assert.equal(calls.predictions.length, 0, 'Typing must not issue a request per keystroke');
  await settle();
  assert.equal(calls.predictions.length, 1);
  assert.equal(calls.predictions[0].input, '222 East');
  assert.ok(calls.predictions[0].sessionToken);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByRole('option', { name: /222 East Aurora Street/ }));
});

test('arrow keys and Enter select the address and metadata without submitting the surrounding form', async t => {
  let submitted = 0;
  const { calls, user, interact, settle } = await mount(t, {
    predictions: (_request, prediction) => ({ suggestions: [prediction(pickup)] }),
    children: ({ Field }) => h('form', { onSubmit: event => { event.preventDefault(); submitted++; } }, h(Field), h('button', { type: 'submit' }, 'Save job')),
  });
  const input = screen.getByRole('combobox');
  await interact(() => user.type(input, '222 East'));
  await settle();
  await interact(() => user.keyboard('{ArrowDown}'));
  await interact(() => user.keyboard('{Enter}'));
  assert.equal(submitted, 0);
  assert.equal(input.value, fullAddress(pickup));
  assert.equal(calls.selections.length, 1);
  assert.deepEqual(calls.selections[0], { ...pickup, fullAddress: fullAddress(pickup) });
  assert.equal(screen.queryByRole('listbox'), null);
});

test('clicking a suggestion fills only the matching pickup or drop-off field', async t => {
  function Addresses({ PlacesAutocomplete }) {
    const [from, setFrom] = useState(''); const [to, setTo] = useState('');
    const [zip, setZip] = useState(''); const [dropZip, setDropZip] = useState('');
    return h('div', {},
      h(PlacesAutocomplete, { 'aria-label': 'Pickup', value: from, onChange: setFrom, onPlaceSelect: place => setZip(place.zip) }),
      h(PlacesAutocomplete, { 'aria-label': 'Drop-off', value: to, onChange: setTo, onPlaceSelect: place => setDropZip(place.zip) }),
      h('output', { 'aria-label': 'Service ZIP' }, zip), h('output', { 'aria-label': 'Destination ZIP' }, dropZip));
  }
  const { calls, user, interact, settle } = await mount(t, {
    predictions: (request, prediction) => ({ suggestions: [prediction(request.input.startsWith('222') ? pickup : dropoff)] }),
    children: ({ PlacesAutocomplete }) => h(Addresses, { PlacesAutocomplete }),
  });
  const from = screen.getByRole('combobox', { name: 'Pickup' }); const to = screen.getByRole('combobox', { name: 'Drop-off' });
  await interact(() => user.type(from, '222 East')); await settle();
  await interact(() => user.click(screen.getByRole('option', { name: /222 East Aurora Street/ })));
  await interact(() => user.type(to, '111 Silver')); await settle();
  await interact(() => user.click(screen.getByRole('option', { name: /111 Silver Street/ })));
  assert.equal(from.value, fullAddress(pickup)); assert.equal(to.value, fullAddress(dropoff));
  assert.equal(screen.getByLabelText('Service ZIP').textContent, '49938');
  assert.equal(screen.getByLabelText('Destination ZIP').textContent, '54534');
  assert.deepEqual(calls.imports, ['places'], 'Multiple address fields must share one Places SDK initialization');
});

test('out-of-order suggestions cannot replace results for the current query', async t => {
  const oldSearch = deferred(); const newSearch = deferred();
  const { user, interact, settle, prediction } = await mount(t, { predictions: request => request.input.startsWith('222') ? oldSearch.promise : newSearch.promise });
  const input = screen.getByRole('combobox');
  await interact(() => user.type(input, '222 East')); await settle();
  await interact(async () => { await user.clear(input); await user.type(input, '111 Silver'); }); await settle();
  await interact(async () => newSearch.resolve({ suggestions: [prediction(dropoff)] }));
  assert.ok(screen.getByRole('option', { name: /111 Silver Street/ }));
  await interact(async () => oldSearch.resolve({ suggestions: [prediction(pickup)] }));
  assert.equal(screen.queryByRole('option', { name: /222 East Aurora Street/ }), null);
  assert.ok(screen.getByRole('option', { name: /111 Silver Street/ }));
});

for (const nextValue of ['changed manually', '']) {
  test(`pending place details cannot overwrite ${nextValue ? 'a new edit' : 'a parent reset'}`, async t => {
    const details = deferred();
    const { calls, user, interact, settle } = await mount(t, {
      predictions: (_request, prediction) => ({ suggestions: [prediction(pickup)] }), details: () => details.promise,
      children: ({ PlacesAutocomplete, calls }) => {
        function Resettable() {
          const [value, setValue] = useState('');
          return h('div', {}, h(PlacesAutocomplete, { 'aria-label': 'Service address', value, onChange: setValue, onPlaceSelect: place => calls.selections.push(place) }), h('button', { onClick: () => setValue(nextValue) }, 'Change address'));
        }
        return h(Resettable);
      },
    });
    const input = screen.getByRole('combobox');
    await interact(() => user.type(input, '222 East')); await settle();
    await interact(() => user.click(screen.getByRole('option', { name: /222 East Aurora Street/ })));
    assert.equal(calls.details.length, 1);
    if (nextValue) await interact(async () => { await user.clear(input); await user.type(input, nextValue); });
    else await interact(() => user.click(screen.getByRole('button', { name: 'Change address' })));
    await interact(async () => details.resolve());
    assert.equal(input.value, nextValue); assert.equal(calls.selections.length, 0);
    assert.equal(screen.queryByText('Filling address…'), null, 'A cancelled selection must not leave the field busy');
  });
}

test('typing and leaving an address never silently selects or rewrites it', async t => {
  const { calls, user, interact, settle } = await mount(t, {
    predictions: (_request, prediction) => ({ suggestions: [prediction(pickup)] }),
    children: ({ Field }) => h('div', {}, h(Field), h('button', {}, 'Next field')),
  });
  const input = screen.getByRole('combobox');
  await interact(() => user.type(input, '222 E Aurora apt 2')); await settle();
  await interact(() => user.click(screen.getByRole('button', { name: 'Next field' }))); await settle();
  assert.equal(input.value, '222 E Aurora apt 2');
  assert.equal(calls.details.length, 0); assert.equal(calls.selections.length, 0);
  assert.equal(screen.queryByRole('listbox'), null);
});

test('disabled and read-only address fields preserve native form behavior without requesting predictions', async t => {
  const { calls, user, interact, settle } = await mount(t, {
    children: ({ Field }) => h('div', {}, h(Field, { 'aria-label': 'Disabled address', initial: '222 East', disabled: true }), h(Field, { 'aria-label': 'Read-only address', initial: '111 Silver', readOnly: true })),
  });
  const disabled = screen.getByRole('combobox', { name: 'Disabled address' });
  const readonly = screen.getByRole('combobox', { name: 'Read-only address' });
  assert.equal(disabled.disabled, true); assert.equal(readonly.readOnly, true);
  await interact(() => user.click(readonly)); await settle();
  assert.equal(calls.predictions.length, 0);
});

test('empty results and unavailable Maps leave manual address entry usable', async t => {
  const { calls, user, interact, settle } = await mount(t, { noSdk: true });
  const input = screen.getByRole('combobox');
  await interact(() => user.type(input, '456 Custom Road, Ironwood, MI 49938')); await settle();
  await interact(() => user.tab());
  assert.equal(input.value, '456 Custom Road, Ironwood, MI 49938');
  assert.equal(calls.selections.length, 0); assert.equal(calls.predictions.length, 0);
  assert.equal(screen.queryByRole('listbox'), null);
});

test('no prediction matches does not erase the manually entered address', async t => {
  const { calls, user, interact, settle } = await mount(t);
  const input = screen.getByRole('combobox');
  await interact(() => user.type(input, '456 Custom Road')); await settle();
  assert.equal(calls.predictions.length, 1);
  assert.equal(input.value, '456 Custom Road'); assert.equal(calls.selections.length, 0);
  assert.equal(screen.queryByRole('listbox'), null);
});

test('selection uses current callbacks after rerender and preserves native input attributes and ref', async t => {
  let oldSelections = 0; let newSelections = 0; let blurred = 0;
  const ref = createRef();
  const { user, interact, settle, render, Field } = await mount(t, {
    props: { id: 'service-address', name: 'pickupAddress', required: true, ref, onBlur: () => blurred++, 'aria-describedby': 'address-hint', onPlaceSelect: () => oldSelections++ },
    predictions: (_request, prediction) => ({ suggestions: [prediction(pickup)] }),
  });
  const input = screen.getByRole('combobox');
  assert.equal(ref.current, input); assert.equal(input.id, 'service-address'); assert.equal(input.name, 'pickupAddress');
  assert.equal(input.required, true); assert.equal(input.getAttribute('aria-describedby'), 'address-hint');
  await interact(() => user.type(input, '222 East')); await settle();
  await render(h(Field, { onPlaceSelect: () => newSelections++, onBlur: () => blurred++ }));
  await interact(() => user.click(screen.getByRole('option', { name: /222 East Aurora Street/ })));
  await interact(() => user.tab());
  assert.equal(oldSelections, 0); assert.equal(newSelections, 1); assert.ok(blurred > 0);
});

test('street-only structured forms receive street text plus full city, state and postal metadata', async t => {
  const { calls, user, interact, settle } = await mount(t, {
    props: { addressValue: 'street' }, predictions: (_request, prediction) => ({ suggestions: [prediction(pickup)] }),
  });
  const input = screen.getByRole('combobox');
  await interact(() => user.type(input, '222 East')); await settle();
  await interact(() => user.click(screen.getByRole('option', { name: /222 East Aurora Street/ })));
  assert.equal(input.value, pickup.streetAddress);
  assert.equal(calls.selections[0].fullAddress, fullAddress(pickup));
  assert.equal(calls.selections[0].zip, pickup.zip);
});

test('staff job pickup fills the service ZIP while drop-off suggestions cannot change pricing location or submit a job', async t => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } } });
  t.after(() => client.clear());
  const { calls, user, interact, settle } = await mount(t, {
    predictions: (request, prediction) => ({ suggestions: [prediction(request.input.startsWith('222') ? pickup : dropoff)] }),
    allowedNetwork: ['/api/marketplace/quote-preview'],
    fetch: async (url, options) => {
      assert.equal(url, '/api/marketplace/quote-preview'); assert.equal(options.method, 'POST');
      return new Response(JSON.stringify({ matched: false, quote: { zone: null, rate: null, labor: 300, travel: 0, subtotal: 300, minEstimate: 300, maxEstimate: 500 } }), { status: 200 });
    },
    children: ({ StaffJobForm }) => h(QueryClientProvider, { client }, h(StaffJobForm, { prefilledDate: '2026-10-01' })),
  });
  const from = screen.getByRole('combobox', { name: /Pickup \/ service address/ });
  const to = screen.getByRole('combobox', { name: /Drop-off address/ });
  const zip = screen.getByRole('textbox', { name: /Service ZIP/ });
  await interact(() => user.type(from, '222 East')); await settle();
  await interact(() => user.keyboard('{ArrowDown}'));
  await interact(() => user.keyboard('{Enter}')); await settle();
  assert.equal(zip.value, '49938'); assert.equal(from.value, fullAddress(pickup));
  await interact(() => user.type(to, '111 Silver')); await settle();
  await interact(() => user.click(screen.getByRole('option', { name: /111 Silver Street/ }))); await settle();
  assert.equal(zip.value, '49938'); assert.equal(to.value, fullAddress(dropoff));
  assert.ok(calls.network.length > 0);
  assert.ok(calls.network.every(([url, options]) => url === '/api/marketplace/quote-preview' && JSON.parse(options.body).zip === '49938'));
});

test('booking address adapter fills metadata, clears it after street edits, and permits manual completion', async t => {
  let saved;
  function BookingAddress({ AddressField }) {
    const [street, setStreet] = useState(''); const [city, setCity] = useState('');
    const [state, setState] = useState(''); const [zip, setZip] = useState('');
    saved = { street, city, state, zip };
    return h(AddressField, { value: street, onChange: setStreet, city, state, zip, onCityChange: setCity, onStateChange: setState, onZipChange: setZip });
  }
  const { user, interact, settle } = await mount(t, {
    predictions: (_request, prediction) => ({ suggestions: [prediction(pickup)] }),
    children: ({ AddressField }) => h(BookingAddress, { AddressField }),
  });
  const input = screen.getByRole('combobox', { name: 'Street address' });
  await interact(() => user.type(input, '222 East')); await settle();
  await interact(() => user.click(screen.getByRole('option', { name: /222 East Aurora Street/ })));
  assert.deepEqual(saved, { street: fullAddress(pickup), city: 'Ironwood', state: 'MI', zip: '49938' });
  assert.match(screen.getByTestId('address-summary-pill').textContent, /Ironwood, MI 49938/);
  await interact(() => user.clear(input));
  await interact(() => user.type(input, '456 New Road'));
  await interact(() => user.tab());
  assert.deepEqual(saved, { street: '456 New Road', city: '', state: '', zip: '' });
  assert.equal(screen.queryByTestId('address-summary-pill'), null);
  await interact(() => user.type(screen.getByRole('textbox', { name: 'City', exact: true }), 'Hurley'));
  await interact(() => user.type(screen.getByRole('textbox', { name: 'State', exact: true }), 'WI'));
  await interact(() => user.type(screen.getByRole('textbox', { name: 'ZIP code' }), '54534'));
  assert.deepEqual(saved, { street: '456 New Road', city: 'Hurley', state: 'WI', zip: '54534' });
});

test('project address selection fills split fields and preserves a manually added apartment number', async t => {
  let saved;
  function ProjectAddress({ ProjectAddressField }) {
    const [value, setValue] = useState({ street: '', city: '', state: '', zip: '' });
    saved = value;
    return h(ProjectAddressField, { value, onChange: setValue });
  }
  const { user, interact, settle } = await mount(t, {
    predictions: (_request, prediction) => ({ suggestions: [prediction(pickup)] }),
    children: ({ ProjectAddressField }) => h(ProjectAddress, { ProjectAddressField }),
  });
  const street = screen.getByRole('combobox', { name: 'Street address' });
  await interact(() => user.type(street, '222 East')); await settle();
  await interact(() => user.click(screen.getByRole('option', { name: /222 East Aurora Street/ })));
  assert.deepEqual(saved, { street: pickup.streetAddress, city: 'Ironwood', state: 'MI', zip: '49938' });
  assert.equal(screen.getByRole('textbox', { name: 'City', exact: true }).value, 'Ironwood');
  assert.equal(screen.getByRole('textbox', { name: 'State', exact: true }).value, 'MI');
  assert.equal(screen.getByRole('textbox', { name: 'ZIP code' }).value, '49938');
  await interact(() => user.type(street, ' Apt 2')); await settle();
  await interact(() => user.tab());
  assert.deepEqual(saved, { street: `${pickup.streetAddress} Apt 2`, city: 'Ironwood', state: 'MI', zip: '49938' });
});

test('a route-only suggestion cannot replace a complete address or mark it resolved', async t => {
  const routeOnly = { ...pickup, streetAddress: 'East Aurora Street', routeOnly: true };
  const { calls, user, interact, settle } = await mount(t, {
    predictions: (_request, prediction) => ({ suggestions: [prediction(routeOnly)] }),
  });
  const input = screen.getByRole('combobox');
  await interact(() => user.type(input, '222 East Aurora')); await settle();
  await interact(() => user.click(screen.getByRole('option', { name: /East Aurora Street/ })));
  assert.equal(input.value, '222 East Aurora');
  assert.equal(calls.selections.length, 0);
  assert.match(screen.getByRole('status').textContent, /street number.*manually/);
});
