import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Exercise the real report, dialogs, React Query and request client. All job
// records and HTTP responses are synthetic; no live actions or messages run.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fixture.test/leads/job', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[key] = dom.window[key].bind(dom.window);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
HTMLElement.prototype.scrollIntoView = function () {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClientProvider, notifyManager } = await import('@tanstack/react-query');
notifyManager.setScheduler(queueMicrotask);
const { screen, within } = await import('@testing-library/dom');
const { default: userEvent } = await import('@testing-library/user-event');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(root, 'node_modules', '.job-workflow-ui-test-'));
after(async () => { dom.window.close(); await rm(temporary, { recursive: true, force: true }); });
const bundle = path.join(temporary, 'report.mjs');
await build({
  stdin: { contents: "export { JobWorkflowReport } from './client/src/components/job-workflow-report'; export { JobSetupWorkspace } from './client/src/components/job-setup-workspace'; export { OwnerApprovalRequest } from './client/src/components/owner-approval-request'; export { NotificationList } from './client/src/components/notification-list'; export { queryClient } from './client/src/lib/queryClient'; export { projectJobWorkflow } from './shared/job-workflow';", resolveDir: root, loader: 'tsx' },
  outfile: bundle, absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'maps-fixture', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/places-autocomplete$/ }, args => ({ path: args.path, namespace: 'maps-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'maps-fixture' }, () => ({ resolveDir: root, loader: 'jsx', contents: "import React from 'react'; export function PlacesAutocomplete({onChange, ...props}) { return <input {...props} onChange={e => onChange(e.target.value)} />; }" }));
  } }],
  define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
});
const { JobWorkflowReport, JobSetupWorkspace, OwnerApprovalRequest, NotificationList, queryClient, projectJobWorkflow } = await import(pathToFileURL(bundle).href);
queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } });

const quoteApproval = { code: 'quote_approval', message: 'Review and approve the current quote.', target: 'quote' };
function fixture() {
  const lead = { id: 'job', orderNumber: 123, firstName: 'Test', lastName: 'Customer', phone: '2025550100', serviceType: 'labor', fromAddress: '100 Example Street', confirmedDate: '2099-10-16', arrivalWindow: '8:00 AM – 9:00 AM', crewSize: 4, confirmedHours: 3, crewMembers: ['a', 'b', 'c', 'd'], acceptedByEmployees: ['a', 'b'], totalPrice: '1050', status: 'quote_requested', paymentPlan: 'pay_on_completion', jobPlanDetails: { workScope: 'load_only' } };
  const quote = { id: 'quote', revision: 1, status: 'draft', total: 1050, subtotal: 1050, discount: 0, lines: [{ name: 'Labor', quantity: 1, unitPrice: 1050, total: 1050 }], requiresOwner: false, reasons: [], matches: true };
  const state = { lead, quote, version: 'draft-v1', confirmed: false, canApprove: true, canManage: true, reviewBlockers: [] };
  const flow = () => projectJobWorkflow({ lead: { ...lead, jobPlanDetails: { ...lead.jobPlanDetails, ...(state.confirmed ? { customerConfirmation: { snapshotHash: 'agreed', method: 'phone' } } : {}) } }, quote, version: state.version, confirmationHash: 'agreed', capabilities: { approve: state.canApprove, manage: state.canManage, requestApproval: !state.canManage, sms: false } });
  const review = () => ({ version: state.version, reviewHash: `review-${state.version}`, quote, blockers: state.reviewBlockers, recipient: { name: 'Test Customer', email: '', phone: lead.phone }, smsConsent: false, invoiceAvailable: false, schedule: { date: lead.confirmedDate, window: lead.arrivalWindow }, fromAddress: lead.fromAddress, service: lead.serviceType, ownerReasons: [] });
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) };
    requests.push(request);
    if (url === '/api/leads/job/setup') return state.failSetup ? Response.json({ error: 'Review the current job before saving.' }, { status: 409 }) : Response.json({ ...lead, ...request.body });
    if (url === '/api/leads/job/owner-approval-request') return Response.json({ version: state.version, canRequest: true, approved: false, current: Boolean(lead.jobPlanDetails.ownerApprovalRequest) });
    if (url === '/api/leads/job/workflow') return Response.json(flow());
    if (url === '/api/leads/job/quote-review') return Response.json(review());
    if (url === '/api/leads/job/approve-and-send') {
      assert.equal(request.body.version, state.version);
      assert.equal(request.body.reviewHash, `review-${state.version}`);
      assert.equal(request.body.deliveryMethod, 'none');
      quote.status = 'approved'; state.version = 'approved-v2';
      return Response.json({ delivery: { email: { status: 'not_requested' }, sms: { status: 'not_requested' }, invoice: { status: 'not_requested' } } });
    }
    if (url === '/api/leads/job/request-owner-approval') {
      assert.equal(request.body.version, state.version);
      lead.jobPlanDetails.ownerApprovalRequest = { id: 'request-1', version: state.version, requestedAt: '2026-10-15T13:00:00Z', pushStatus: 'skipped' };
      return Response.json({ requested: true, pushStatus: 'skipped' });
    }
    if (url === '/api/leads/job/customer-confirmation') {
      if (state.rejectConfirmation) {
        state.rejectConfirmation = false; quote.status = 'draft'; state.version = 'draft-v1';
        return Response.json({ error: 'Complete the job and schedule before confirming.', blockers: [quoteApproval] }, { status: 409 });
      }
      assert.equal(request.body.version, state.version);
      assert.equal(request.body.attested, true);
      assert.equal(quote.status, 'approved');
      state.confirmed = true; state.version = 'confirmed-v3';
      return Response.json({ saved: true });
    }
    throw new Error(`Unexpected HTTP request: ${request.method} ${url}`);
  };
  return { state, requests, flow };
}

async function mount(t, f, dirty = false, extra = {}) {
  const container = document.createElement('div'); document.body.append(container);
  const reactRoot = createRoot(container);
  const edits = [];
  const props = { lead: f.state.lead, employees: [], dirty, onEdit: (...args) => edits.push(args), onPayment() {}, onCloseout() {}, onStart() {}, onComplete() {}, onVersion() {}, ...extra };
  const render = async next => {
    Object.assign(props, next);
    await act(async () => reactRoot.render(h(QueryClientProvider, { client: queryClient }, h(JobWorkflowReport, props))));
  };
  t.after(async () => { await act(async () => reactRoot.unmount()); queryClient.clear(); container.remove(); });
  await render();
  const user = userEvent.setup({ document });
  const click = async element => act(async () => { await user.click(element); });
  await act(async () => { await screen.findByTestId('workflow-primary-action'); });
  return { edits, render, click };
}

async function openBlockers(click) {
  await click(screen.getByText(/items? to finish before dispatch/));
  return within(screen.getByText(quoteApproval.message).closest('li')).getByRole('button', { name: 'Fix it' });
}

test('saved quote approval repair opens approval directly, without editing or approving automatically', async t => {
  const f = fixture();
  const { edits, click } = await mount(t, f);
  await click(await openBlockers(click));
  assert.ok(screen.getByRole('dialog', { name: 'Review and share quote' }));
  assert.equal(screen.getByRole('button', { name: 'Save and approve' }).disabled, false);
  assert.deepEqual(edits, []);
  assert.equal(f.requests.filter(r => r.url.endsWith('/quote-review')).length, 1);
  assert.equal(f.requests.filter(r => r.url.endsWith('/approve-and-send')).length, 0);
});

test('confirmation error repair reviews and approves the current quote before fresh agreement', async t => {
  const f = fixture(); f.state.quote.status = 'approved'; f.state.version = 'stale-v0'; f.state.rejectConfirmation = true;
  const { edits, click } = await mount(t, f);
  await click(screen.getByRole('button', { name: 'Record customer confirmation' }));
  await click(screen.getByRole('checkbox'));
  await click(screen.getByRole('button', { name: 'Record confirmation', exact: true }));
  const error = screen.getByRole('alert');
  assert.match(error.textContent, /Complete the job and schedule/);
  await click(within(error).getByRole('button', { name: 'Fix it' }));
  assert.ok(screen.getByRole('dialog', { name: 'Review and share quote' }));
  assert.deepEqual(edits, []);
  await click(screen.getByRole('button', { name: 'Save and approve' }));
  assert.ok(screen.getByText('Quote saved and approved'));
  await click(screen.getByRole('button', { name: 'Return to job' }));
  await click(screen.getByRole('button', { name: 'Record customer confirmation' }));
  assert.equal(screen.getByRole('checkbox').getAttribute('data-state'), 'unchecked', 'Agreement must be attested again against the approved quote');
  await click(screen.getByRole('checkbox'));
  await click(screen.getByRole('button', { name: 'Record confirmation', exact: true }));
  assert.equal(screen.getByTestId('workflow-primary-action').textContent, 'Dispatch crew');
  assert.equal(f.state.quote.total, 1050);
  assert.deepEqual(f.state.lead.crewMembers, ['a', 'b', 'c', 'd']);
  assert.equal(f.requests.filter(r => r.url.endsWith('/crew-action')).length, 0, 'Repair and agreement do not dispatch the crew');
});

test('unsaved quote repair saves first, then resumes quote approval', async t => {
  const f = fixture();
  const { edits, render, click } = await mount(t, f, true);
  await click(await openBlockers(click));
  assert.deepEqual(edits, [['quote']]);
  assert.equal(screen.queryByRole('dialog'), null);
  assert.equal(f.requests.filter(r => r.url.endsWith('/quote-review')).length, 0);
  await render({ dirty: false });
  await act(async () => { window.dispatchEvent(new Event('jc:job-setup-saved')); });
  assert.ok(screen.getByRole('dialog', { name: 'Review and share quote' }));
  assert.equal(f.requests.filter(r => r.url.endsWith('/quote-review')).length, 1);
});

test('pricing fields still route to setup, while approval permission remains enforced', async t => {
  const f = fixture(); f.state.canApprove = false;
  f.state.reviewBlockers = [{ code: 'quote_policy', message: 'Review the saved price.', target: 'quote', field: 'setup-quote-review' }];
  const { edits, click } = await mount(t, f);
  await click(screen.getByRole('button', { name: 'View quote' }));
  assert.equal(screen.queryByRole('button', { name: 'Save and approve' }), null);
  await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fix it' }));
  assert.deepEqual(edits, [['quote', 'setup-quote-review']]);
  assert.equal(screen.queryByRole('dialog'), null);
});


test('coworker explicitly requests owner approval and sees durable notification status', async t => {
  const f = fixture(); f.state.canApprove = false; f.state.canManage = false;
  const { click } = await mount(t, f);
  await click(screen.getByRole('button', { name: 'Request owner approval' }));
  assert.equal(screen.queryByRole('button', { name: 'Save and approve' }), null);
  assert.equal(f.requests.filter(r => r.url.endsWith('/request-owner-approval')).length, 0);
  await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Request owner approval' }));
  assert.ok(screen.getByText(/Owner approval requested and saved/));
  assert.equal(f.state.quote.status, 'draft');
  await click(screen.getByRole('button', { name: 'View approval request' }));
  assert.equal(screen.getByRole('button', { name: 'Awaiting owner approval' }).disabled, true);
  assert.equal(f.requests.filter(r => r.url.endsWith('/request-owner-approval')).length, 1);
});

test('owner notification opens a review without approving; stale requests are identified', async t => {
  const f = fixture();
  const { click } = await mount(t, f, false, { approvalRequestId: 'older-request' });
  await act(async () => { await screen.findByRole('button', { name: 'Save and approve' }); });
  assert.ok(screen.getByText(/This approval request changed or was already handled/));
  assert.equal(f.requests.filter(r => r.url.endsWith('/approve-and-send')).length, 0);
  await click(screen.getByRole('button', { name: 'Save and approve' }));
  assert.equal(f.requests.filter(r => r.url.endsWith('/approve-and-send')).length, 1);
});

test('review action from saved setup opens approval even when no fields changed', async t => {
  const f = fixture();
  await mount(t, f);
  await act(async () => { window.dispatchEvent(new CustomEvent('jc:job-setup-saved', { detail: { action: 'review' } })); });
  assert.ok(screen.getByRole('button', { name: 'Save and approve' }));
  assert.equal(f.requests.filter(r => r.url.endsWith('/approve-and-send')).length, 0);
});


async function mountComponent(t, component, props) {
  const container = document.createElement('div'); document.body.append(container);
  const reactRoot = createRoot(container);
  const render = async next => {
    Object.assign(props, next);
    await act(async () => reactRoot.render(h(QueryClientProvider, { client: queryClient }, h(component, props))));
  };
  t.after(async () => { await act(async () => reactRoot.unmount()); queryClient.clear(); container.remove(); });
  await render();
  const user = userEvent.setup({ document });
  return { render, user, click: async element => act(async () => { await user.click(element); }) };
}

test('saved setup has an enabled review and approval action without a forced edit', async t => {
  const f = fixture(); const actions = [];
  const { click } = await mountComponent(t, JobSetupWorkspace, { lead: f.state.lead, employees: [], canManageSetup: true, expectedVersion: f.state.version, activeSection: 'quote', onSectionChange() {}, onSaved: action => actions.push(action) });
  assert.equal(screen.getByRole('button', { name: 'Save and return' }).disabled, true);
  await click(screen.getByRole('button', { name: 'Review and approve quote' }));
  assert.deepEqual(actions, ['review']);
  assert.equal(f.requests.filter(r => r.url.endsWith('/setup')).length, 0);
});

test('edited setup must save successfully before opening approval', async t => {
  const f = fixture(); f.state.failSetup = true; const actions = [];
  const { render, user, click } = await mountComponent(t, JobSetupWorkspace, { lead: f.state.lead, employees: [], canManageSetup: true, expectedVersion: f.state.version, activeSection: 'customer', onSectionChange() {}, onSaved: action => actions.push(action) });
  await act(async () => { await user.clear(screen.getByLabelText('First Name')); await user.type(screen.getByLabelText('First Name'), 'Updated'); });
  await render({ activeSection: 'quote' });
  await click(screen.getByRole('button', { name: 'Save and review quote' }));
  assert.deepEqual(actions, []);
  assert.ok(screen.getByText('Review the current job before saving.'));
  f.state.failSetup = false;
  await click(screen.getByRole('button', { name: 'Save and review quote' }));
  assert.deepEqual(actions, ['review']);
  assert.equal(f.requests.filter(r => r.url.endsWith('/setup')).at(-1).body.firstName, 'Updated');
});

test('assigned coworker can request approval without a price or customer-data view', async t => {
  const f = fixture();
  const { click } = await mountComponent(t, OwnerApprovalRequest, { leadId: 'job' });
  await click(screen.getByRole('button', { name: 'Request owner approval' }));
  assert.ok(screen.getByText("Approval request saved in the owner's notifications."));
  assert.equal(screen.getByRole('button', { name: 'Approval requested' }).disabled, true);
  assert.equal(document.body.textContent.includes('1050'), false);
  assert.equal(document.body.textContent.includes('Test Customer'), false);
});

test('owner notification is keyboard accessible and opens the quote review link', async t => {
  const requests = []; let closed = false;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    if (url === '/api/notifications') return Response.json({ notifications: [{ id: 'notice-1', type: 'quote_approval_request', title: 'Quote needs your approval', message: 'JC-123: $1050.00 · 4 movers · 3 hours · 2099-10-16 · 8:00 AM – 9:00 AM Central.', createdAt: '2026-10-15T13:00:00Z', read: false, data: { leadId: 'job', requestId: 'request-1' } }] });
    assert.equal(url, '/api/notifications/notice-1/read'); return Response.json({ saved: true });
  };
  const { user } = await mountComponent(t, NotificationList, { open: true, onOpenChange: open => { closed = !open; } });
  const notification = await screen.findByRole('button', { name: /Quote needs your approval/ });
  await act(async () => { notification.focus(); await user.keyboard('{Enter}'); });
  assert.equal(closed, true);
  assert.equal(window.location.pathname + window.location.search, '/lead/job?approvalRequest=request-1');
  assert.ok(requests.every(r => r.method === 'GET' || r.url.endsWith('/read')));
});
