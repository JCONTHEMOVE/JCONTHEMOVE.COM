import assert from 'node:assert/strict';
import {currentQuickBookWindow, evaluateQuickBookReadiness, quickBookDraftSchema} from '../../../shared/quickBook';
import {mergeQuickBookDraft} from '../quickBookSessions';

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
const now = new Date('2026-10-13T14:19:08Z');
const current = currentQuickBookWindow(now)!;
assert.deepEqual(current, {confirmedDate:'2026-10-13',arrivalWindow:'9:00 AM – 10:00 AM'});
const currentDraft = quickBookDraftSchema.parse({...current,crewConfirmed:true});
const scheduleMissing = (draft: typeof currentDraft, time = now) => evaluateQuickBookReadiness(draft,{now:time}).missingFields.includes('one-hour arrival window');
assert.equal(scheduleMissing(currentDraft),true,'A current window requires an explicit Start now choice');
const started = mergeQuickBookDraft({current:currentDraft,patch:{startNow:true},source:'tap',now});
assert.equal(started.draft.startNow,true);
assert.equal(scheduleMissing(started.draft),false);
assert.equal(started.draft.crewConfirmed,true,'Keep confirmed crew when the same date/window is selected');
assert.equal(scheduleMissing(started.draft,new Date('2026-10-13T14:00:00Z')),false,'Window opens inclusively');
assert.equal(scheduleMissing(started.draft,new Date('2026-10-13T14:59:59Z')),false);
assert.equal(scheduleMissing(started.draft,new Date('2026-10-13T15:00:00Z')),true,'Do not silently roll a stale draft into the next hour');
assert.equal(scheduleMissing({...started.draft,confirmedDate:'2026-10-14'}),true,'Start now cannot authorize a future date');
assert.equal(scheduleMissing({...started.draft,arrivalWindow:'10:00 AM – 11:00 AM'}),true,'Start now cannot authorize a future window');
assert.equal(scheduleMissing({...started.draft,arrivalWindow:'8:00 AM – 9:00 AM'}),true,'Past windows remain blocked');
const retargeted = mergeQuickBookDraft({current:currentDraft,patch:{startNow:true,confirmedDate:'2040-01-01',arrivalWindow:'4:00 PM – 5:00 PM'},source:'tap',now});
assert.deepEqual([retargeted.draft.confirmedDate,retargeted.draft.arrivalWindow],[current.confirmedDate,current.arrivalWindow],'Server time wins over client-supplied dates');
const moved = mergeQuickBookDraft({current:quickBookDraftSchema.parse({...currentDraft,confirmedDate:'2026-10-14'}),patch:{startNow:true},source:'tap',now});
assert.equal(moved.draft.crewConfirmed,false,'Moving a different date into now requires crew reconfirmation');
const future = mergeQuickBookDraft({current:started.draft,patch:{arrivalWindow:'10:00 AM – 11:00 AM'},source:'tap',now});
assert.equal(future.draft.startNow,false,'A schedule change clears Start now');
assert.equal(future.draft.crewConfirmed,false);
for (const source of ['typed','voice'] as const) {
  assert.equal(mergeQuickBookDraft({current:currentDraft,patch:{startNow:true},source,now}).draft.startNow,false,'AI cannot select Start now');
  assert.equal(mergeQuickBookDraft({current:currentDraft,patch:{confirmedDate:'2026-10-14',crewConfirmed:true},source,now}).draft.crewConfirmed,false,'AI cannot preserve crew confirmation while changing the schedule');
}
assert.equal(currentQuickBookWindow(new Date('2026-10-13T11:59:59Z')),null);
assert.equal(currentQuickBookWindow(new Date('2026-10-13T12:00:00Z'))?.arrivalWindow,'7:00 AM – 8:00 AM');
assert.equal(currentQuickBookWindow(new Date('2026-10-13T21:59:59Z'))?.arrivalWindow,'4:00 PM – 5:00 PM');
assert.equal(currentQuickBookWindow(new Date('2026-10-13T22:00:00Z')),null);
assert.throws(()=>mergeQuickBookDraft({current:currentDraft,patch:{startNow:true},source:'tap',now:new Date('2026-10-13T22:00:00Z')}),/START_NOW_OUTSIDE_HOURS/);
assert.deepEqual(currentQuickBookWindow(new Date('2026-11-01T15:19:08Z')),{confirmedDate:'2026-11-01',arrivalWindow:'9:00 AM – 10:00 AM'},'Use Central standard time after DST changes');
console.log('Quick Book future scheduling and explicit current-window Start now checks passed');
