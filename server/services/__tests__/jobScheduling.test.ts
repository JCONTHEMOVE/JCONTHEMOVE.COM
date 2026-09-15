import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  confirmedJobDate,
  exactHourlyStarts,
  isHourlyJobArrivalWindow,
  isLegacyJobArrivalWindow,
  JOB_SCHEDULE_OPTIONS,
} from "../../../shared/jcOperations";

assert.equal(confirmedJobDate({ confirmedDate: "2026-09-04", moveDate: "2026-09-03" }), "2026-09-04");
assert.equal(confirmedJobDate({ confirmedDate: null, moveDate: "2026-09-04" }), "2026-09-04");
assert.equal(confirmedJobDate({ confirmedDate: null, moveDate: null }), "");

assert.deepEqual(exactHourlyStarts(), ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
assert.equal(JOB_SCHEDULE_OPTIONS[0].label, "7:00 AM – 8:00 AM");
assert.equal(JOB_SCHEDULE_OPTIONS.at(-2)?.label, "4:00 PM – 5:00 PM");
assert.equal(JOB_SCHEDULE_OPTIONS.at(-1)?.value, "Flexible / TBD");
assert.equal(isHourlyJobArrivalWindow("10:00 AM – 11:00 AM"), true);
assert.equal(isHourlyJobArrivalWindow("10:00 AM – 12:00 PM"), false);
assert.equal(isLegacyJobArrivalWindow("11:00 AM – 1:00 PM"), true);

const setupSource = readFileSync(resolve(process.cwd(), "client/src/components/job-setup-workspace.tsx"), "utf8");
assert.match(setupSource, /Confirmed Job Date/);
assert.doesNotMatch(setupSource, />Requested Date</);
assert.doesNotMatch(setupSource, />Driver bonus</i);
assert.doesNotMatch(setupSource, /driverUserId:/);

const leadDetailSource = readFileSync(resolve(process.cwd(), "client/src/pages/lead-detail.tsx"), "utf8");
assert.doesNotMatch(leadDetailSource, /showInlineScheduler|Crew & Service Plan/);
assert.match(leadDetailSource, /openJobSetup\("schedule"\)/);

const routesSource = readFileSync(resolve(process.cwd(), "server/routes.ts"), "utf8");
assert.doesNotMatch(routesSource, /app\.patch\("\/api\/leads\/:id\/schedule"/);
assert.doesNotMatch(routesSource.slice(routesSource.indexOf("const jobSetupSchema"), routesSource.indexOf("app.patch(\"/api/leads/:id/setup\"")), /driverUserId/);
assert.match(routesSource, /currentLead\.driverUserId && !effectiveDriver\) patch\.driverUserId = null/);
assert.match(routesSource, /const shouldNotifyCrew = hasCompleteTentativePlan && operationalPlanChanged/);

const eventBusSource = readFileSync(resolve(process.cwd(), "server/services/jobEventBus.ts"), "utf8");
assert.match(eventBusSource, /const arrival = lead\.arrivalWindow \? `, \$\{lead\.arrivalWindow\} Central`/);
assert.match(eventBusSource, /tentatively planned[\s\S]*\$\{date\}\$\{arrival\}/);

console.log("job scheduling alignment tests passed");
