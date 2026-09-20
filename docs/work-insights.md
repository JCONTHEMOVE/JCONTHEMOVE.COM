# Work in focus

Workers Central now connects job charts to the information people need to gather.

- Owner overview (`/admin/overview`): click a job-stage or missing-information bar to see the matching jobs, then open a job to use its existing management form.
- Active Job Planner (`/crew` and `/admin/schedule`): expand “Job insights” above the calendar. The charts reuse the planner's authorized records, including the visible job board. Hidden addresses and job notes are not treated as missing. Customer-contact and crew-size checks remain owner-only. The planner feed contains active records; the owner overview uses the broader job-flow feed.
- Crew marketing (`/crew/marketing`): the Learn, Reach, and Follow through controls show their saved state and open the corresponding task. Waiting for approved copy and having no follow-up due are distinct from submitted work.

The charts count current, unarchived records. Duplicate job IDs are counted once. The server's existing lifecycle determines stage grouping; finished work includes jobs whose payout is still pending, and does not imply payment or reward completion. Information checks cover saved service dates, arrival windows, addresses, notes, contact details, and crew sizes. These are field-completeness prompts, not a replacement for dispatch readiness or verification of the contents.

All chart controls are keyboard-accessible buttons with labeled counts and selected states. Colors also have text labels. Changes honor reduced-motion preferences. Refresh errors retain cached data with an explicit warning; unavailable data never appears as zero jobs. Results link directly to the active `/lead/:id` workspace; it reads its `returnTo` parameter through Wouter's search hook, preserving the route back to the crew or owner planner.

## Data and effects

Uses the existing authenticated `/api/jobs/flow?scope=admin`, `/api/jobs/planner`, and daily-home queries. No database migration, new authorization grant, new customer-data endpoint, messaging, pricing, payment, or reward mutation is introduced. Chart selection is local UI state. Daily mission submissions still use their existing explicit forms and server checks.

## Validation

Use Node 20, the repository's configured runtime:

```sh
npm ci
npm run check
node --test scripts/work-insights.test.mjs
npm run build
```

The focused tests cover permission redaction, archived and duplicate records, invalid dates, server lifecycle grouping, keyboard filtering, encoded owner/crew job links, empty/loading/error states, retained cached charts, and mission focus without any network requests. The existing pull-request validation workflow also runs them.

Local results on September 20, 2026: focused tests, TypeScript, production client/server build, and all 25 existing store tests passed. The full server-test command could not run in the execution environment: its existing `tsx` runner was blocked from creating IPC sockets (`listen EPERM`) before test code executed. Hosted CI remains the authoritative result for that suite. Browser visual acceptance is pending: the cloud browser's security policy blocked local-file previews. No production job, mission, payment, reward, or notification was submitted during this work.

Before release, inspect the authenticated hosted preview at desktop and phone widths; tap each chart, open and close a matching job, and check mission progress focus. Test a refresh failure with cached data. Then review one owner account and one ordinary crew account using existing records. No new live submissions are necessary to validate the charts.
