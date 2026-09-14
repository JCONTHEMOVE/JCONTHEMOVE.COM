import assert from "node:assert/strict";
import { quickBookWorkOverlaps } from "../quickBookAvailability";

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
