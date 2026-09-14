import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';

// Execute the actual commit/follow-up/catch section, with failures injected at
// the commit boundary, event emitter and delivery-audit read.
const source = readFileSync('server/routes.ts','utf8');
const routeStart = source.indexOf('  app.post("/api/quick-book/sessions/:id/book"');
const route = source.slice(routeStart, source.indexOf('  const jobPlanDetailsSchema', routeStart));
const tail = route.slice(route.indexOf('      await client.query("COMMIT");'), route.lastIndexOf('  });'));
assert.ok(tail.includes('if (savedBooking)'));
const compiled = ts.transpileModule(`async function run() {
  let savedBooking: Record<string, unknown> | null = null;
  let savedStatus = 201;
  try { ${tail}
}`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

for (const failure of ['none','commit','event','audit']) {
  const queries: string[] = [];
  let status = 200;
  let payload: any;
  let alerts = 0;
  const res: any = {status: (value: number) => {status=value;return res;}, json:(value: unknown)=>{payload=value;return res;}};
  const client = {query: async (sql: string) => {queries.push(sql);if (sql==='COMMIT' && failure==='commit') throw Error('commit failed');},release:()=>{}};
  const pool = {query: async (sql: string) => {queries.push(sql);if(failure==='audit' && sql.includes('job_alert_deliveries')) throw Error('audit unavailable');return {rows:[{status:'sent'}]};}};
  const deps = {client,res,pool,z,console:{error:()=>{}},
    leadId:'saved-lead',bookingId:'saved-booking',lead:{order_number:42},quote:{total:450,rewardEligibleTotal:525},
    row:{id:'session'},actor:{id:'owner'},draft:{confirmedDate:'2030-01-01',arrivalWindow:'10:00 AM – 11:00 AM',crewMemberIds:['crew'],estimatedHours:2},eventId:'event',
    writeLeadHistory:async()=>{}, emitJobEvent:async()=>{alerts++;if(failure==='event') throw Error('alert unavailable');}};
  await new Function(...Object.keys(deps),compiled+'; return run();')(...Object.values(deps));
  if(failure==='commit') {
    assert.equal(status,500);assert.equal(alerts,0);assert.ok(queries.includes('ROLLBACK'));
  } else {
    assert.equal(status,201);assert.equal(payload.success,true);assert.equal(payload.bookingId,'saved-booking');
    assert.equal(payload.leadId,'saved-lead');assert.equal(payload.total,450);assert.equal(payload.error,undefined);
    assert.ok(!queries.includes('ROLLBACK'));
    if(failure!=='none') {assert.equal(payload.deliveryAuditUnavailable,true);assert.match(payload.warning,/Job saved/);}
  }
}
console.log('Quick Book committed success survives notification and audit failures');
