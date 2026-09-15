import assert from "node:assert/strict";
import { quickBookWorkOverlaps, quickBookHoursCoverWork } from "../quickBookAvailability";

const morning = { arrivalWindow: "10:00 AM – 11:00 AM", hours: 3 };
assert.equal(quickBookWorkOverlaps(morning, { arrivalWindow: "11:00 AM – 12:00 PM", hours: 2 }), true);
assert.equal(quickBookWorkOverlaps(morning, { arrivalWindow: "9:30 AM – 10:30 AM", hours: "2.00" }), true);
assert.equal(quickBookWorkOverlaps(morning, { arrivalWindow: "1:00 PM – 2:00 PM", hours: 2 }), true);
assert.equal(quickBookWorkOverlaps(morning, { arrivalWindow: "2:00 PM – 3:00 PM", hours: 2 }), false);
assert.equal(quickBookWorkOverlaps(morning, { arrivalWindow: "8:00 AM – 9:00 AM", hours: 2 }), true);
assert.equal(quickBookWorkOverlaps(morning, { arrivalWindow: "8:00 AM", hours: 2 }), false);
assert.equal(quickBookWorkOverlaps(morning, { arrivalWindow: "11:00 AM", hours: null }), true);
assert.equal(quickBookWorkOverlaps(morning, { arrivalWindow: "unknown", hours: 2 }), true);
assert.equal(quickBookWorkOverlaps({ arrivalWindow: "12:00 AM", hours: 1 }, { arrivalWindow: "12:00 PM", hours: 1 }), false);
console.log("Quick Book crew duration overlap checks passed");

const weekly = [{start_hour: 8, end_hour: 12, is_available: true}];
const job = {arrivalWindow: '9:00 AM – 10:00 AM', hours: 2};
assert.equal(quickBookHoursCoverWork(job, weekly, [], false), true);
assert.equal(quickBookHoursCoverWork({...job, hours: 3}, weekly, [], false), false);
assert.equal(quickBookHoursCoverWork({arrivalWindow: '4:00 PM – 5:00 PM', hours: 1}, weekly, [], false), false);
assert.equal(quickBookHoursCoverWork(job, weekly, [{start_hour: 8, end_hour: 9}], false), false);
assert.equal(quickBookHoursCoverWork(job, [{...weekly[0], is_available: false}], [{start_hour: 8, end_hour: 17}], false), true);
assert.equal(quickBookHoursCoverWork(job, weekly, [{start_hour: 8, end_hour: 17}], true), false);
assert.equal(quickBookHoursCoverWork(job, [], [], false), true);
assert.equal(quickBookHoursCoverWork({...job, arrivalWindow: 'Flexible / TBD'}, [], [], false), false);
assert.equal(quickBookHoursCoverWork(job, [{start_hour: 8, end_hour: 10}, {start_hour: 10, end_hour: 12}], [], false), true);
assert.equal(quickBookHoursCoverWork(job, [{start_hour: 8, end_hour: 10}, {start_hour: 11, end_hour: 12}], [], false), false);
console.log('Quick Book full-shift and date-override checks passed');
