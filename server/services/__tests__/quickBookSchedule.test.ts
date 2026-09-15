import assert from 'node:assert/strict';
import {evaluateQuickBookReadiness, quickBookDraftSchema} from '../../../shared/quickBook';

const base = quickBookDraftSchema.parse({confirmedDate:'2026-09-14',arrivalWindow:'4:00 PM – 5:00 PM'});
const missing = (date: string, window: string, now: string) => evaluateQuickBookReadiness({...base, confirmedDate:date, arrivalWindow:window}, {now:new Date(now)}).missingFields;
assert.ok(missing('2026-09-13',base.arrivalWindow,'2026-09-14T15:00:00Z').includes('confirmed date'));
assert.ok(missing('2026-02-30',base.arrivalWindow,'2026-01-01T15:00:00Z').includes('confirmed date'));
assert.ok(missing('2026-09-15','Flexible / TBD','2026-09-14T15:00:00Z').includes('one-hour arrival window'));
assert.ok(missing('2026-09-14','10:00 AM – 11:00 AM','2026-09-14T15:00:00Z').includes('one-hour arrival window'));
assert.ok(!missing('2026-09-14',base.arrivalWindow,'2026-09-14T15:00:00Z').includes('one-hour arrival window'));
// UTC has rolled over, but the operation's date is still September 14 in Chicago.
assert.ok(!missing('2026-09-15','7:00 AM – 8:00 AM','2026-09-15T00:30:00Z').includes('confirmed date'));
assert.ok(!missing('2026-11-01','7:00 AM – 8:00 AM','2026-11-01T12:00:00Z').includes('one-hour arrival window'));
console.log('Quick Book future fixed Central-time schedule checks passed');
