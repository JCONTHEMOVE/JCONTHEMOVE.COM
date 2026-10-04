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
const { screen, within, configure, fireEvent } = await import('@testing-library/dom');
const { default: userEvent } = await import('@testing-library/user-event');
configure({ defaultHidden: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(root, 'node_modules', '.insights-test-'));
after(async () => { dom.window.close(); await rm(temporary, { recursive: true, force: true }); });
const bundle = path.join(temporary, 'components.mjs');
await build({
  stdin: { contents: "export { WorkInsights } from './client/src/components/WorkInsights'; export { CrewDailyHome } from './client/src/components/CrewDailyHome'; export { default as JobPlanner } from './client/src/pages/job-planner'; export { summarizeWork } from './shared/workInsights'; export { default as CrewHome } from './client/src/pages/crew/home'; export { WorkerMonthlyProgress } from './client/src/components/worker-monthly-progress'; export * from './shared/workerHome';", resolveDir: root, loader: 'tsx' },
  outfile: bundle, absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
});
const { WorkInsights, CrewDailyHome, JobPlanner, summarizeWork, CrewHome, WorkerMonthlyProgress, currentWork, monthlyWork, chicagoMonth, workMonth } = await import(pathToFileURL(bundle).href);
const complete = { id: 'ready', orderNumber: 101, serviceType: 'moving', status: 'available', moveDate: '2026-09-21', arrivalWindow: '9–11 am', fromAddress: 'Fixture address', details: 'Pack kitchen', phone: 'fixture', crewSize: 2 };
const incomplete = { id: 'needs/details', orderNumber: 102, serviceType: 'flooring', status: 'quote_requested', moveDate: '2026-02-30', workerVisibility: { exactLocation: false, jobScope: false } };
const jobs = [complete, incomplete, { id: 'done', serviceType: 'junk', status: 'completed' }];

async function mount(t, component, data, options = {}) {
  requests.length = 0;
  globalThis.fetch = async (...args) => {
    requests.push(args);
    if (options.fetch) return options.fetch(...args);
    throw new Error('No network is allowed in this fixture');
  };
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: options.queryFn || (() => { throw new Error('Unseeded query'); }), retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { gcTime: 0, retry: false } } });
  if (data) client.setQueryData(['/api/crew/marketing/daily-home'], data);
  client.setQueryData(['/api/jobs/planner'], { items: jobs, viewer: { isAdmin: false, canAddJob: false } });
  client.setQueryData(['/api/admin/lead-safety/status'], { leads: [] });
  client.setQueryData(['/api/jobs/my-pending'], options.pending || [{ id: 'request', serviceType: 'delivery', status: 'assigned' }]);
  client.setQueryData(['/api/leads/my-jobs'], [{ id: 'done', serviceType: 'junk', status: 'completed', confirmedDate: '2026-09-02' }]);
  const node = document.createElement('div'); document.body.append(node);
  const reactRoot = createRoot(node);
  const render = async (child) => act(async () => reactRoot.render(h(QueryClientProvider, { client }, child)));
  await render(component);
  t.after(async () => { await act(async () => reactRoot.unmount()); client.clear(); node.remove(); if (!options.fetch) assert.equal(requests.length, 0, 'Charts and progress selection must never submit or send messages'); });
  const user = userEvent.setup({ document });
  return { client, user, render, interact: (fn) => act(fn) };
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

test('worker queue keeps old active leads and excludes completed, paid, archived, and duplicate jobs', () => {
  const input = [...jobs, complete, { id: 'old', status: 'new', createdAt: '2025-01-01' }, { id: 'paid', status: 'paid' }, { id: 'archived', status: 'new', archivedAt: '2026-09-01' }];
  const before = structuredClone(input);
  assert.deepEqual(new Set(currentWork(input).map(job => job.id)), new Set(['ready', 'needs/details', 'old']));
  assert.deepEqual(input, before);
});

test('monthly reporting uses service dates and Chicago receipt months, with history replacing duplicate active records', () => {
  assert.equal(chicagoMonth(new Date('2026-10-01T02:00:00Z')), '2026-09');
  assert.equal(workMonth({ id: 'boundary', createdAt: '2026-10-01T02:00:00Z' }), '2026-09');
  assert.equal(workMonth({ id: 'service', confirmedDate: '2026-10-01', createdAt: '2026-09-20' }), '2026-10');
  assert.equal(workMonth({ id: 'invalid', moveDate: '2026-02-30', createdAt: 'invalid' }), null);
  const summary = monthlyWork([
    complete, { ...complete, status: 'completed' }, { id: 'unknown', status: 'new' },
    { id: 'archived', archivedAt: true, moveDate: '2026-09-21' },
    { id: 'cancelled', status: 'cancelled', moveDate: '2026-09-21' },
  ], '2026-09');
  assert.equal(summary.jobs.length, 1);
  assert.equal(summary.jobs[0].status, 'completed');
  assert.equal(summary.undated, 1);
});

test('worker homepage puts requests and current work before materials, monthly progress, and rewards', async t => {
  const { user, interact } = await mount(t, h(CrewHome));
  const headings = screen.getAllByRole('heading', { level: 2 }).map(node => node.textContent);
  assert.deepEqual(headings, ['1 Work', '2 Get work', '3 Monthly progress', '4 Rewards & redemptions']);
  const work = screen.getByRole('region', { name: '1 Work' });
  assert.ok(within(work).getByRole('link', { name: /delivery/ }));
  assert.equal(within(work).queryByRole('link', { name: /junk/ }), null);
  assert.equal(screen.getByRole('link', { name: /Rewards & redemptions/ }).getAttribute('href'), '/crew/rewards');
  assert.equal([...document.querySelectorAll('a')].some(anchor => anchor.getAttribute('href') === '/marketplace'), false);
  assert.equal(screen.getByRole('link', { name: /Pricing datasets/ }).getAttribute('href'), '/crew/pricing-training');
  assert.equal(screen.getByRole('link', { name: 'Calendar' }).getAttribute('href'), '/crew/calendar');
  assert.equal(screen.getByRole('link', { name: 'Job request' }).getAttribute('href'), '/book?worker=1');
  await interact(() => user.click(screen.getByRole('button', { name: 'leads', exact: true })));
  assert.equal(within(work).queryByRole('link', { name: /moving/ }), null);
  assert.equal(within(work).getByRole('link', { name: /flooring/ }).getAttribute('href'), '/lead/needs%2Fdetails?returnTo=%2Fcrew');
});

const assignedRequest = { id: 'request/fixture', orderNumber: 315, serviceType: 'delivery', status: 'assigned', confirmedDate: '2026-10-02', arrivalWindow: '9–11 am' };
const flushNotifications = () => new Promise(resolve => setTimeout(resolve, 0));

for (const decision of ['accept', 'decline']) {
  test(`worker request ${decision} saves once, shows its schedule, and refreshes affected work`, async t => {
    let finish;
    let pending = [assignedRequest];
    const refreshed = [];
    const { user, interact, client } = await mount(t, h(CrewHome), undefined, {
      pending,
      fetch: async () => new Promise(resolve => { finish = () => { pending = []; resolve(new Response(JSON.stringify({ success: true }), { status: 200 })); }; }),
      queryFn: async ({ queryKey }) => {
        refreshed.push(queryKey[0]);
        if (queryKey[0] === '/api/jobs/my-pending') return pending;
        if (queryKey[0] === '/api/jobs/planner') return { items: decision === 'accept' ? [assignedRequest] : [], viewer: { canAddJob: false } };
        if (queryKey[0] === '/api/leads/my-jobs') return [];
        throw new Error(`Unexpected query: ${queryKey}`);
      },
    });
    assert.match(screen.getByRole('link', { name: /delivery #315/ }).textContent, /Oct 2, 9–11 am/);
    const button = screen.getByRole('button', { name: `${decision === 'accept' ? 'Accept' : 'Decline'} job #315` });
    await interact(async () => { await user.click(button); await flushNotifications(); });
    assert.equal(button.disabled, true);
    assert.equal(screen.getByRole('button', { name: `${decision === 'accept' ? 'Decline' : 'Accept'} job #315` }).disabled, true);
    await interact(() => user.click(button));
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], `/api/jobs/request%2Ffixture/${decision}`);
    assert.equal(requests[0][1].method, 'POST');
    assert.equal(requests[0][1].credentials, 'include');
    assert.equal(requests[0][1].body, '{}');
    await interact(async () => { finish(); await flushNotifications(); await flushNotifications(); });
    assert.ok(screen.getByText(`Job #315 ${decision === 'accept' ? 'accepted' : 'declined'}.`));
    assert.ok(screen.getByText('No job requests awaiting your response.'));
    assert.deepEqual(client.getQueryData(['/api/jobs/my-pending']), []);
    assert.deepEqual(new Set(refreshed), new Set(['/api/jobs/my-pending', '/api/jobs/planner', '/api/leads/my-jobs']));
    assert.equal(screen.queryByRole('button', { name: 'Accept job #315' }), null);
    assert.equal(Boolean(screen.queryByRole('link', { name: /delivery #315/ })), decision === 'accept');
  });
}

test('failed request response stays visible, preserves the request, and never retries automatically', async t => {
  const { user, interact } = await mount(t, h(CrewHome), undefined, {
    pending: [assignedRequest],
    fetch: async () => new Response(JSON.stringify({ error: 'Could not save job response' }), { status: 500 }),
  });
  await interact(async () => { await user.click(screen.getByRole('button', { name: 'Accept job #315' })); await flushNotifications(); });
  assert.match(screen.getByRole('alert').textContent, /Could not save your response\. Could not save job response/);
  assert.ok(screen.getByRole('link', { name: /delivery #315/ }));
  assert.equal(screen.getByRole('button', { name: 'Accept job #315' }).disabled, false);
  assert.equal(requests.length, 1);
  assert.equal(screen.queryByText('Job #315 accepted.'), null);
});

test('a stale response refreshes the request list without claiming acceptance', async t => {
  const { user, interact } = await mount(t, h(CrewHome), undefined, {
    pending: [assignedRequest, { ...assignedRequest, id: 'archived', archivedAt: '2026-09-29' }],
    fetch: async () => new Response(JSON.stringify({ error: 'Job is no longer awaiting a response' }), { status: 409 }),
    queryFn: async ({ queryKey }) => { assert.equal(queryKey[0], '/api/jobs/my-pending'); return []; },
  });
  assert.equal(screen.getAllByRole('button', { name: 'Accept job #315' }).length, 1);
  await interact(async () => { await user.click(screen.getByRole('button', { name: 'Accept job #315' })); await flushNotifications(); await flushNotifications(); });
  assert.match(screen.getByRole('alert').textContent, /no longer awaiting a response/);
  assert.ok(screen.getByText('No job requests awaiting your response.'));
  assert.equal(requests.length, 1);
  assert.equal(screen.queryByText('Job #315 accepted.'), null);
});

test('monthly chart controls include completed work, change months, and expose safe drill-through links', async t => {
  const { user, interact } = await mount(t, h(WorkerMonthlyProgress));
  assert.equal(screen.getByLabelText('Progress month').value, chicagoMonth());
  await interact(() => fireEvent.change(screen.getByLabelText('Progress month'), { target: { value: '2026-09' } }));
  const finished = screen.getByRole('button', { name: 'Finished: 1 job' });
  await interact(async () => { finished.focus(); await user.keyboard('{Enter}'); });
  assert.equal(screen.getByRole('link', { name: /junk/ }).getAttribute('href'), '/lead/done?returnTo=%2Fcrew%2Fprogress%3Fmonth%3D2026-09');
  await interact(() => user.click(screen.getByRole('button', { name: 'Previous month' })));
  assert.equal(screen.getByLabelText('Progress month').value, '2026-08');
  assert.ok(screen.getByText('No jobs recorded for this month.'));
  assert.equal(screen.queryByRole('link', { name: /junk/ }), null);
  await interact(() => fireEvent.change(screen.getByLabelText('Progress month'), { target: { value: '2026-01' } }));
  await interact(() => user.click(screen.getByRole('button', { name: 'Previous month' })));
  assert.equal(screen.getByLabelText('Progress month').value, '2025-12');
});

test('missing history never produces a misleading completed count and a cached error stays visible', async t => {
  const { client, interact, render } = await mount(t, h(WorkerMonthlyProgress));
  await interact(async () => {
    await client.fetchQuery({ queryKey: ['/api/leads/my-jobs'], staleTime: 0, queryFn: async () => { throw new Error('history unavailable'); } }).catch(() => {});
    // Query observers notify on the next timer turn, after fetchQuery settles.
    // Flush that notification within act before inspecting the rendered alert.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.match(screen.getByRole('alert').textContent, /last loaded records/);
  assert.ok(screen.getByRole('group', { name: 'Monthly job stages' }));
  await render(null);
  client.removeQueries({ queryKey: ['/api/leads/my-jobs'] });
  await render(h(WorkerMonthlyProgress));
  assert.equal(screen.queryByRole('group', { name: 'Monthly job stages' }), null);
});
