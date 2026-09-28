import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fixture.test/crew', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'MutationObserver', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'localStorage'])
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[key] = dom.window[key].bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = function () {};
const requests = [];
globalThis.fetch = async (...args) => { requests.push(args); throw new Error('No network is allowed in this fixture'); };
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { screen, within, configure } = await import('@testing-library/dom');
const { default: userEvent } = await import('@testing-library/user-event');
configure({ defaultHidden: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(root, 'node_modules', '.insights-test-'));
after(async () => { dom.window.close(); await rm(temporary, { recursive: true, force: true }); });
const bundle = path.join(temporary, 'components.mjs');
await build({
  stdin: { contents: "export { WorkInsights } from './client/src/components/WorkInsights'; export { CrewDailyHome } from './client/src/components/CrewDailyHome'; export { default as JobPlanner } from './client/src/pages/job-planner'; export { summarizeWork } from './shared/workInsights';", resolveDir: root, loader: 'tsx' },
  outfile: bundle, absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
});
const { WorkInsights, CrewDailyHome, JobPlanner, summarizeWork } = await import(pathToFileURL(bundle).href);
const complete = { id: 'ready', orderNumber: 101, serviceType: 'moving', status: 'available', moveDate: '2026-09-21', arrivalWindow: '9–11 am', fromAddress: 'Fixture address', details: 'Pack kitchen', phone: 'fixture', crewSize: 2 };
const incomplete = { id: 'needs/details', orderNumber: 102, serviceType: 'flooring', status: 'quote_requested', moveDate: '2026-02-30', workerVisibility: { exactLocation: false, jobScope: false } };
const jobs = [complete, incomplete, { id: 'done', serviceType: 'junk', status: 'completed' }];

async function mount(t, component, data) {
  requests.length = 0;
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: () => { throw new Error('Unseeded query'); }, retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (data) client.setQueryData(['/api/crew/marketing/daily-home'], data);
  client.setQueryData(['/api/jobs/planner'], { items: jobs, viewer: { isAdmin: false, canAddJob: false } });
  client.setQueryData(['/api/admin/lead-safety/status'], { leads: [] });
  const node = document.createElement('div'); document.body.append(node);
  const reactRoot = createRoot(node);
  const render = async (child) => act(async () => reactRoot.render(h(QueryClientProvider, { client }, child)));
  await render(component);
  t.after(async () => { await act(async () => reactRoot.unmount()); client.clear(); node.remove(); assert.equal(requests.length, 0, 'Charts and progress selection must never submit or send messages'); });
  const user = userEvent.setup({ document });
  return { user, render, interact: (fn) => act(fn) };
}

test('missing information excludes closed work, archived rows, duplicates, and hidden worker fields', () => {
  const input = [...jobs, incomplete, { ...complete, id: 'archived', archivedAt: '2026-09-20' }, { id: 'cancelled', status: 'cancelled' }];
  const before = structuredClone(input);
  const owner = summarizeWork(input, 'owner');
  assert.equal(owner.records.length, 4);
  assert.equal(owner.activeCount, 2);
  assert.equal(owner.needsInformation, 1);
  assert.deepEqual(owner.records.find(r => r.job.id === incomplete.id).missing, ['date', 'window', 'address', 'notes', 'contact', 'size']);
  assert.deepEqual(summarizeWork(input, 'crew').records.find(r => r.job.id === incomplete.id).missing, ['date', 'window']);
  assert.deepEqual(summarizeWork([{ ...incomplete, workerVisibility: undefined }], 'crew').records[0].missing, ['date', 'window']);
  assert.deepEqual(summarizeWork([{ ...incomplete, workerVisibility: { exactLocation: true, jobScope: true } }], 'crew').records[0].missing, ['date', 'window', 'address', 'notes']);
  assert.deepEqual(input, before);
});

test('server lifecycle wins over raw state and a pending payout is not unfinished job information', () => {
  const summary = summarizeWork([
    { ...incomplete, flow: { stage: 'payout_pending' } },
    { ...complete, flow: { stage: 'needs_schedule', schedule: { date: null, arrivalWindow: null } } },
    { id: 'new-state', status: 'unrecognized_future_status' },
  ], 'owner');
  assert.equal(summary.stages.find(s => s.key === 'finished').count, 1);
  assert.equal(summary.stages.find(s => s.key === 'schedule').count, 1);
  assert.equal(summary.stages.find(s => s.key === 'other').count, 1);
  assert.deepEqual(summary.records[0].missing, []);
});

test('keyboard activation filters jobs, exposes encoded job links, and preserves records', async t => {
  const before = structuredClone(jobs);
  const { user, interact } = await mount(t, h(WorkInsights, { jobs, audience: 'owner', onRefresh() {} }));
  const bar = screen.getByRole('button', { name: 'Work finished: 1 job' });
  await interact(async () => { bar.focus(); await user.keyboard('{Enter}'); });
  assert.equal(bar.getAttribute('aria-pressed'), 'true');
  assert.ok(screen.getByRole('heading', { name: 'Work finished · 1 job' }));
  assert.equal(screen.getByRole('link', { name: /junk/ }).getAttribute('href'), '/lead/done?returnTo=%2Fadmin%2Fschedule');
  assert.equal(screen.queryByRole('link', { name: /flooring/ }), null);
  const missingBar = screen.getByRole('button', { name: 'Service date: 1 job' });
  await interact(async () => { missingBar.focus(); await user.keyboard(' '); });
  assert.equal(screen.getByRole('link', { name: /flooring/ }).getAttribute('href'), '/lead/needs%2Fdetails?returnTo=%2Fadmin%2Fschedule');
  assert.equal(bar.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(jobs, before);
});

test('crew drill-through uses crew routes and zero-match selections stay clear', async t => {
  const { user, interact } = await mount(t, h(WorkInsights, { jobs, audience: 'crew', onRefresh() {} }));
  assert.equal(screen.getByRole('link', { name: /flooring/ }).getAttribute('href'), '/lead/needs%2Fdetails?returnTo=%2Fcrew');
  assert.equal(screen.queryByRole('button', { name: /Customer contact:/ }), null);
  await interact(() => user.click(screen.getByRole('button', { name: 'Service address: 0 jobs' })));
  assert.ok(screen.getByText('No jobs match this selection.'));
});

test('loading and errors never look like zero jobs; failed refresh preserves usable cached charts', async t => {
  let refreshed = 0;
  const props = { audience: 'owner', onRefresh() { refreshed++; } };
  const { render, user, interact } = await mount(t, h(WorkInsights, { ...props, isLoading: true }));
  assert.ok(screen.getByRole('status'));
  assert.equal(screen.queryByRole('button', { name: /All 0 jobs/ }), null);
  await render(h(WorkInsights, { ...props, isError: true }));
  assert.match(screen.getByRole('alert').textContent, /Could not load jobs/);
  assert.equal(screen.queryByRole('group', { name: 'Job stage chart' }), null);
  await render(h(WorkInsights, { ...props, jobs, isError: true }));
  assert.match(screen.getByRole('alert').textContent, /last saved view/);
  assert.ok(screen.getByRole('group', { name: 'Job stage chart' }));
  await interact(() => user.click(screen.getByRole('button', { name: 'Refresh' })));
  assert.equal(refreshed, 1);
  await render(h(WorkInsights, { ...props, jobs: [] }));
  assert.ok(screen.getByText('Job charts will appear when the first job is saved.'));
});

test('mission progress opens and focuses the corresponding collection task without submitting', async t => {
  const data = { day: '2026-09-20', active: true, rep: { displayName: 'Fixture worker', territory: 'Ironwood', promoCode: 'FIXTURE' }, scenario: { id: 'fixture', title: 'Fixture scenario', submitted: true }, outreach: null, followup: null, followupSubmitted: false };
  const { user, interact } = await mount(t, h(CrewDailyHome), data);
  const progress = within(screen.getByRole('group', { name: 'Mission progress' }));
  const learn = progress.getByRole('button', { name: /1. Learn Reviewed/ });
  await interact(() => user.click(learn));
  const details = document.getElementById(learn.getAttribute('aria-controls'));
  assert.equal(details.open, true);
  assert.equal(document.activeElement, details.querySelector('summary'));
  assert.ok(progress.getByRole('button', { name: /Awaiting copy/ }));
  assert.ok(progress.getByRole('button', { name: /None due/ }));
  assert.match(screen.getByRole('status').textContent, /1 submitted or reviewed/);
});

test('the active crew planner contains the insights and retains its calendar', async t => {
  const { user, interact } = await mount(t, h(JobPlanner, { audience: 'crew' }));
  const toggle = screen.getByText('Job insights · progress and missing details');
  await interact(() => user.click(toggle));
  assert.equal(toggle.parentElement.open, true);
  assert.ok(screen.getByRole('heading', { name: 'Work in focus' }));
  assert.ok(screen.getByRole('region', { name: 'Calendar view controls' }));
  assert.equal(screen.getByRole('link', { name: /flooring/ }).getAttribute('href'), '/lead/needs%2Fdetails?returnTo=%2Fcrew');
});
