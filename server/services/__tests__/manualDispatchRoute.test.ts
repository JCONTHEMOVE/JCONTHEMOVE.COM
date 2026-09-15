import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { manualDispatchMissingSetup } from '../../../shared/manualDispatchReadiness';

// Execute the production route through its pre-write boundary. An incomplete
// dispatch must return before any payment, wallet or notification effect.
const source = readFileSync('server/routes.ts', 'utf8');
const start = source.indexOf('  app.post("/api/leads/:id/mark-paid"');
const end = source.indexOf("      // Record 'paid' transition first, then 'dispatched'", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(source.slice(start, end) + `
  return res.status(202).json({ ready: true });
  } catch (error) { return res.status(500).json({ error: String(error) }); }
});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const ready = { id: 'synthetic', status: 'quoted', totalPrice: '425', confirmedDate: '2030-09-15', crewSize: 2, crewMembers: ['one', 'two'] };
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
    manualDispatchMissingSetup, writeLeadHistory: rejectEffect,
    recordRevenueSplit: rejectEffect, creditJcMovesUsd: rejectEffect,
  };
  new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  await handler({ session: { userId: 'owner' }, params: { id: 'synthetic' } }, res);
  assert.equal(status, test.expected);
  assert.equal(effects, 0);
  if (status === 409) assert.ok(payload.missingSetup.length > 0);
}
console.log('Manual dispatch route rejects unauthorized and incomplete setup before payment effects.');
