import assert from 'node:assert/strict';
import { manualDispatchMissingSetup } from '../../../shared/manualDispatchReadiness';

const ready = { totalPrice: '425.00', confirmedDate: '2026-09-15', crewSize: 2, crewMembers: ['one', 'two'] };
assert.deepEqual(manualDispatchMissingSetup(ready), []);
assert.equal(manualDispatchMissingSetup({}).length, 4);
for (const totalPrice of ['0', '-1', 'NaN', 'Infinity']) {
  assert.ok(manualDispatchMissingSetup({ ...ready, totalPrice, basePrice: '425' }).includes('a positive saved quote'));
}
assert.deepEqual(manualDispatchMissingSetup({ ...ready, totalPrice: undefined, basePrice: '425', confirmedDate: null, moveDate: '2026-09-15' }), []);
for (const confirmedDate of ['2026-02-30', 'not a date', '2026-13-01']) {
  assert.ok(manualDispatchMissingSetup({ ...ready, confirmedDate }).includes('a valid service date'));
}
for (const crewMembers of [[], ['one'], ['one', 'one'], ['one', '  ']]) {
  assert.ok(manualDispatchMissingSetup({ ...ready, crewMembers }).includes('the full named crew roster'));
}
assert.ok(manualDispatchMissingSetup({ ...ready, crewSize: 1.5 }).includes('a crew size'));
console.log('PASS: manual dispatch requires saved price, real calendar date and distinct named crew');
