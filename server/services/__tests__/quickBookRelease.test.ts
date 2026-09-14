import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';

// Execute the actual registered handlers with database/side-effect tripwires.
const source = readFileSync('server/routes.ts', 'utf8');
const start = source.indexOf('  async function quickBookActor');
const end = source.indexOf('  const jobPlanDetailsSchema', start);
assert.ok(start > 0 && end > start);
const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const routes = new Map<string, Function>();
const app = Object.fromEntries(['get', 'post'].map(method => [method, (path: string, ...handlers: Function[]) => routes.set(`${method} ${path}`, handlers.at(-1)!)]));
let reads = 0;
const env: Record<string, string> = {};
new Function('app', 'isAuthenticated', 'storage', 'process', 'z', 'getQuickBookSession', 'calculateQuickBookState', 'quickBookSessionResponse', 'isQuickBookAiConfigured', 'QUICK_BOOK_DEFAULT_MODEL', 'QUICK_BOOK_DEFAULT_TRANSCRIPTION_MODEL', js)(
  app, () => {}, { getUser: () => { throw Error('unexpected user lookup'); } }, { env }, z,
  async () => { reads++; return { id: 'fixture', createdByUserId: 'owner' }; },
  () => { throw Error('unexpected pricing/database access'); }, () => {}, () => false, 'test', 'test',
);
async function request(key: string, role: string, userId = 'owner') {
  let status = 200; let body: any;
  const res: any = { status: (value: number) => { status = value; return res; }, json: (value: any) => { body = value; return res; } };
  await routes.get(key)!({ currentUser: { id: userId, role, isApproved: true }, params: { id: 'fixture' }, body: {} }, res);
  return { status, body };
}
const dataRoutes = [...routes.keys()].filter(key => !key.endsWith('/health'));
assert.equal(dataRoutes.length, 5);
for (const enabled of [undefined, 'false', 'TRUE', 'true']) {
  if (enabled === undefined) delete env.QUICK_BOOK_ENABLED; else env.QUICK_BOOK_ENABLED = enabled;
  for (const role of ['admin', 'employee', 'customer']) {
    for (const route of routes.keys()) assert.equal((await request(route, role)).status, 403, `${role}: ${route}`);
  }
  assert.equal((await request('get /api/quick-book/health', 'business_owner')).body.canComplete, false);
  for (const route of dataRoutes) {
    if (enabled !== 'true') assert.equal((await request(route, 'business_owner')).status, 503);
  }
  assert.equal((await request('post /api/quick-book/sessions/:id/book', 'business_owner')).status, enabled === 'true' ? 403 : 503);
}
assert.equal(reads, 0, 'disabled/unauthorized requests must stop before database access');
env.QUICK_BOOK_ENABLED = 'true';
env.QUICK_BOOK_STAFF_DRAFT_ENABLED = 'true';
assert.equal((await request('get /api/quick-book/health', 'employee')).status, 403, 'owner-only overrides staff flag');
env.QUICK_BOOK_OWNER_ONLY = 'false';
assert.equal((await request('get /api/quick-book/health', 'employee')).status, 200);
assert.equal((await request('post /api/quick-book/sessions/:id/book', 'employee')).status, 403);
env.QUICK_BOOK_LIVE_BOOKING_ENABLED = 'true';
assert.equal((await request('get /api/quick-book/health', 'employee')).body.canComplete, false);
assert.equal((await request('get /api/quick-book/health', 'business_owner')).body.canComplete, true);
assert.equal((await request('get /api/quick-book/health', 'admin')).body.canComplete, true);
console.log('Quick Book actual-handler role/flag matrix passed; disabled booking made zero database calls.');
