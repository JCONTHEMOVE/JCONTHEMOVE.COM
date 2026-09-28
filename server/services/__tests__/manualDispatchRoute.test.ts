import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { dispatchBlockers } from '../../../shared/job-workflow';

// Execute the production route through its pre-write boundary. An incomplete
// dispatch must return before any payment, wallet or notification effect.
const source = readFileSync('server/routes.ts', 'utf8');
const start = source.indexOf('  app.post("/api/leads/:id/mark-paid"');
const end = source.indexOf("      const current = await getJobWorkflow", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(source.slice(start, end) + `
  return res.status(202).json({ ready: true });
  } catch (error) { return res.status(500).json({ error: String(error) }); }
});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const ready = { id: 'synthetic', status: 'quoted', firstName: 'Test', lastName: 'Customer', phone: '2025550135', fromAddress: 'Test street', serviceType: 'labor', totalPrice: '425', confirmedDate: '2099-09-15', arrivalWindow: '9:00 AM – 10:00 AM', crewSize: 2, crewMembers: ['one', 'two'] };
for (const test of [
  { role: 'customer', lead: ready, expected: 403 },
  { role: 'employee', lead: ready, expected: 403 },
  { role: 'business_owner', lead: null, expected: 404 },
  { role: 'business_owner', lead: { ...ready, totalPrice: '0' }, expected: 409 },
  { role: 'admin', lead: { ...ready, confirmedDate: '2030-02-30' }, expected: 409 },
  { role: 'admin', lead: { ...ready, crewMembers: ['one', 'one'] }, expected: 409 },
  { role: 'business_owner', lead: ready, expected: 202 },
]) {
  let handler: any, status = 200, payload: any, effects = 0;
  const rejectEffect = () => { effects++; throw new Error('Unexpected payment or notification effect'); };
  const res: any = { status(value: number) { status = value; return res; }, json(value: unknown) { payload = value; return res; } };
  const deps = {
    app: { post(_path: string, _auth: unknown, callback: unknown) { handler = callback; } },
    isAuthenticated: () => {},
    storage: { getUser: async () => ({ id: 'owner', role: test.role }) },
    db: { select: () => ({ from: () => ({ where: async () => test.lead ? [test.lead] : [] }) }), update: rejectEffect },
    pool: { query: rejectEffect }, leads: { id: 'id' }, eq: () => true,
    writeLeadHistory: rejectEffect,
    workflowActor: async () => ({ userId: 'owner', manage: true }),
    checkWorkflowDispatch: async () => dispatchBlockers(test.lead, { matches: Number(test.lead?.totalPrice) > 0, status: 'approved' } as any, true),
    recordRevenueSplit: rejectEffect, creditJcMovesUsd: rejectEffect,
  };
  new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  await handler({ session: { userId: 'owner' }, params: { id: 'synthetic' } }, res);
  assert.equal(status, test.expected);
  assert.equal(effects, 0);
  if (status === 409) assert.ok(payload.blockers.length > 0);
}
console.log('Manual dispatch route rejects unauthorized and incomplete setup before payment effects.');

// The legacy administrator status override cannot bypass shared readiness.
const forceStart = source.indexOf('  app.patch("/api/leads/:id/status/force"');
const forceEnd = source.indexOf('  // Protected routes - Update lead status', forceStart);
assert.ok(forceStart >= 0 && forceEnd > forceStart);
const forceCompiled = ts.transpileModule(source.slice(forceStart, forceEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
class WorkflowError extends Error {
  constructor(public status: number, message: string, public blockers: unknown[] = []) { super(message); }
}
for (const blocked of [true, false]) {
  let handler: any, status = 200, payload: any, sharedCalls = 0;
  const res: any = { status(value: number) { status = value; return res; }, json(value: unknown) { payload = value; return res; } };
  const deps = {
    app: { patch(_path: string, _auth: unknown, _role: unknown, callback: unknown) { handler = callback; } },
    isAuthenticated: () => {}, requireAdmin: () => {}, WorkflowError,
    storage: { getLead: async () => ready, updateLeadStatus: () => { throw new Error('Dispatch bypassed the shared service'); } },
    workflowActor: async () => ({ userId: 'owner', manage: true }),
    getJobWorkflow: async () => ({ version: 'current-version' }),
    executeCrewAction: async (id: string, _actor: unknown, input: any) => {
      sharedCalls++;
      assert.equal(id, ready.id);
      assert.deepEqual(input, { version: 'reviewed-version', action: 'dispatch', idempotencyKey: 'retry-key' });
      if (blocked) throw new WorkflowError(409, 'Complete dispatch setup first.', [{ code: 'customer_confirmation', target: 'confirmation' }]);
      return { saved: true, notifications: [] };
    },
  };
  new Function(...Object.keys(deps), forceCompiled)(...Object.values(deps));
  await handler({ session: { userId: 'owner' }, params: { id: ready.id }, body: { status: 'dispatched', version: 'reviewed-version', idempotencyKey: 'retry-key' } }, res);
  assert.equal(sharedCalls, 1);
  assert.equal(status, blocked ? 409 : 200);
  if (blocked) assert.equal(payload.blockers[0].code, 'customer_confirmation');
  else assert.equal(payload.dispatchResult.saved, true);
}
console.log('Legacy forced dispatch delegates to shared readiness and preserves actionable errors.');
