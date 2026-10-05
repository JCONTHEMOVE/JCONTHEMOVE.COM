import assert from 'node:assert/strict';
import { verifySquareReadiness, probeSquareReadiness } from '../squareReadiness';

let requests = 0;
const base = { environment: 'production', productionHost: true, tokenConfigured: true, locationId: 'configured',
  listLocations: async () => { requests++; return { locations: [{ id: 'configured', status: 'ACTIVE' }] }; } };
assert.equal((await verifySquareReadiness(base)).ok, true);
assert.equal((await verifySquareReadiness(base)).ok, true);
assert.equal(requests, 2, 'A configured location must never bypass fresh provider authentication');
for (const changed of [{ environment: undefined }, { environment: 'typo' }, { environment: 'sandbox' }, { tokenConfigured: false }]) {
  assert.equal((await verifySquareReadiness({ ...base, ...changed })).ok, false);
}
assert.equal(requests, 2, 'Invalid production configuration fails before contacting the provider');
assert.equal((await verifySquareReadiness({ ...base, environment: 'sandbox', productionHost: false })).ok, true);
for (const locations of [[], [{ id: 'other', status: 'ACTIVE' }], [{ id: 'configured', status: 'INACTIVE' }], [{ id: 'configured' }]]) {
  assert.equal((await verifySquareReadiness({ ...base, listLocations: async () => ({ locations }) })).ok, false);
}
assert.equal((await verifySquareReadiness({ ...base, locationId: null })).ok, true);
assert.equal((await verifySquareReadiness({ ...base, locationId: null, listLocations: async () => ({ locations: [
  { id: 'first', status: 'INACTIVE' }, { id: 'second', status: 'ACTIVE' },
] }) })).ok, false, 'Probe must match the invoice service first-location fallback');
const failure = await verifySquareReadiness({ ...base, listLocations: async () => {
  throw Object.assign(new Error('private-token-in-error'), { statusCode: 401, body: 'private-response-body' });
} });
assert.equal(failure.ok, false);
assert.match(failure.detail, /HTTP 401/);
assert.doesNotMatch(failure.detail, /private-/);

// Exercise the wrapper with the actual SDK serialization and an intercepted
// fetch. Only the expected locations GET is accepted; no network request leaves.
const keys = ['NODE_ENV', 'SQUARE_ENVIRONMENT', 'SQUARE_PRODUCTION_ACCESS_TOKEN', 'SQUARE_PRODUCTION_LOCATION_ID'];
const previous = keys.map(key => process.env[key]);
const originalFetch = globalThis.fetch;
try {
  process.env.NODE_ENV = 'production';
  process.env.SQUARE_ENVIRONMENT = 'production';
  process.env.SQUARE_PRODUCTION_ACCESS_TOKEN = 'synthetic-isolated-token';
  process.env.SQUARE_PRODUCTION_LOCATION_ID = 'configured';
  let called = false;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, 'https://connect.squareup.com/v2/locations');
    assert.equal(init?.method || (input instanceof Request ? input.method : 'GET'), 'GET');
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    assert.equal(headers.get('authorization'), 'Bearer synthetic-isolated-token');
    called = true;
    return new Response(JSON.stringify({ locations: [{ id: 'configured', status: 'ACTIVE' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  assert.equal((await probeSquareReadiness()).ok, true);
  assert.equal(called, true, 'Isolated production credentials reach the actual SDK locations request');
} finally {
  globalThis.fetch = originalFetch;
  keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
}
console.log('PASS: Square readiness verifies fresh provider auth, active selected location, environment policy, isolated credentials and sanitized failures');
