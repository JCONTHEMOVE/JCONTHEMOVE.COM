# JC ON THE MOVE completion register

Updated September 8, 2026. This register distinguishes checked code from live service completion. No item is closed merely because its prior Codex turn ended.

## Current release and service

- Public readiness on `www.jconthemove.com` reports Railway, a connected database, and commit `25b985e4`.
- The bare-domain homepage and `/book` still time out. Cloudflare sign-in is required to inspect the origin/redirect configuration. The working customer entry is `https://www.jconthemove.com/book`.
- The worktree has substantial pre-existing changes for Quick Book, phone entry, and push readiness. None of this completion pass has been deployed.
- The current 90-file candidate is staged on `agent/open-task-completion-20260908`. Automatic approval review rejected the combined commit/push action because publication of this exact broad candidate was not explicitly approved. A specific draft-branch/PR approval request is pending; no commit or push was made by that rejected command.

## Delivery queue

| Work | Evidence and remaining completion condition |
| --- | --- |
| Domain restoration | Failure reproduced; `www` booking UI renders without captured errors. Repair Cloudflare configuration after sign-in, then verify both hosts, HTTPS, paths and referral queries. |
| Phone entry | Shared formatting, digit count and server validation are implemented. This pass fixed uppercase/trailing-slash guard bypasses and accessible labels. Browser checks passed for missing/extra digits, formatted paste, controlled save, form reset, legacy edits and 390px layout. Release still required. |
| Mobile lead details / GitHub #4 | This pass separates customer notes from package JSON, preserves package metadata on edits/clearing, and enlarges secondary tabs. Focused preservation test passes. Remaining full owner-page workflow acceptance must be verified before closing #4. |
| Quick Book | Existing local code uses disabled-by-default owner flags. 49-file server validation includes quote/permission checks; disposable migration SQL passed repeated execution and retention checks. Clean install and production build passed; final type checking, owner fixtures and exact live release remain required. See `QUICK_BOOK_RELEASE.md`. |
| Web push | Existing readiness and single-use owner test code is present and included in passing server suite. Workspace has no VAPID pair. Configure the intended production pair and verify one authorized owner-device receipt before relying on crew push. |
| PWA installation assets | Live `/manifest.json`, `/icons/icon-192x192.png` and `/offline.html` incorrectly return the 12,195-byte HTML app shell. Copied the 21 existing manifest/offline/favicon/icon assets into `client/public`, Vite's configured default public directory. Fresh Node 20 build passed; the new build verifier confirms the manifest, all 16 declared PNG dimensions, favicon, offline page and push service worker. The verifier rejects the old build's missing manifest and is included in release CI. Deployment and live HTTP acceptance remain open. The assets and build verifier are included in the current 90-file candidate. The copied favicon was SVG mislabeled as ICO; it is now a valid ICO containing the existing 72px PNG. |
| Availability alerts / PR #8 | Local Discord reporter and entrypoint monitor pass 19 tests; this pass adds referral-query preservation. PR #8 separately proposes independent Better Stack monitoring, email-first response and 15/30/60-minute escalation. Reconcile the two workflows before release; do not enable duplicate incident delivery. Exact private destinations and real delivery proof remain open. |
| Database recovery / PR #8 | Accessible Neon projects `gentle-mouse-56921333` and `broad-lake-53082373` are in us-east-1 and their listed branches are archived. Both report 21,600-second history, but the workspace database host is in us-west-2. This is NOT live production backup proof. Map Railway's actual database to its provider account before any isolated historical restore. |
| Canonical payment/reward pipeline / GitHub #7 | Open: inspect and consolidate current Square/manual/Bitcoin payment paths, preserve gift-funded exclusions, add durable provider-event reconciliation and disabled-by-default automatic triggering. Requires controlled payment/duplicate/refund/reward evidence. |
| Square gift-card pilot | Earlier work remains dependent on intended Square environment and a private purchase/reward reconciliation test. No purchase or reward issuance was performed here. |
| Northwoods imports | Existing code/tests are present; intended mailbox OAuth and controlled import-through-review remain open. |
| Ashley photo/email | Existing code/tests are present; separate intended Gmail connection and multi-image draft acceptance remain open. Ashley retains final approval. |
| Facebook marketing pilot | Page-locked pilot has prior implementation; current Meta role/OAuth acceptance and an explicitly scoped live campaign test remain open. |
| Legacy deployment PR #1 | Reviewed: GitHub reports merge conflicts; its Render blueprint differs from current Railway production. Current source already ignores `.env` and does not track it. Do not merge the old hosting configuration wholesale. The historical diff exposes a treasury private key: confirm that wallet was retired/replaced and no active service relies on that key. Deleting `.env` from a later commit does not erase history. No wallet operation was performed here. |
| Pi Jackpot GitHub #3/#6 | Separate product work is tracked by `JC's Pi Jackpot — Master Completion Task`. Do not mix its payment credentials, simulator or database into the moving-service release. These issues remain open pending that product's evidence. |

## Verification recorded in this pass

- Existing Node 20 worktree: all 48 server test files passed before the notes change; the added notes test passed separately.
- Phone route-alias regression and all 19 monitoring tests passed after their fixes.
- Disposable Quick Book/regional SQL applied three times; status/FK constraints, indexes, agreement columns and transcript retention passed. This does not test production schema drift.
- Type check passed on the installed Node 24 runtime. Local Node 20 checks were stopped under severe memory pressure (about 70 MB free on an 8 GB host); final candidate validation is delegated to repository CI, not counted as passed locally.
- Fresh clean-install Node 20 client/server production build passed after the notes/accessibility, synthetic fixture and PWA changes. All 688 tracked application source files matched the validation copy by hash. Vite reported large chunks and outdated browser metadata warnings. The isolated validation directory has no Git identity, so its build marker is intentionally missing and is not deployment evidence.
- New `Release Candidate Validation` workflow runs Node 20 clean install, types, server tests, monitoring tests and build on pull requests without production secrets or deployment. Its addition is not evidence that remote CI has run.
- A new clean Node 20 `npm ci` succeeded under sibling `.verify`: 1,509 packages installed in 17 minutes. The old `.quick-book-validation` clean install had failed and is not accepted as proof.
- Clean-install server validation now covers all 49 test files: 34 passed in the original run, the stalled pricing file passed on retry, and the remaining 14 passed with individual 60-second limits. This was a resumed run, not a single uninterrupted suite.
- Local Express serving of the fresh build returned the real manifest (200 application/json, 3,027 bytes), 192px icon (200 image/png, 3,978 bytes), and offline page (200 text/html, 4,114 bytes). JSON identity, PNG dimensions and offline title were asserted. This exercised static serving only, without starting the database-backed app.
- A final clean-install TypeScript retry also stalled with roughly 300 MB free. Only its verified compiler process was stopped; it did not pass. Live deployment/acceptance remains unverified despite the passing build.

## Sources and access limits

Sources: current worktree, production HTTP/browser checks, recent Codex tasks, GitHub open issues #3/#4/#6/#7 and PRs #1/#8, and read-only Neon organization/project/branch listings. The task list exposes 50 recent unpinned tasks, so older historical requests may still need retrieval.

GitHub CLI is signed out, but Git transport works outside the Windows sandbox and the GitHub connector can manage pull requests. Cloudflare and Railway are signed out in the app browser; Chrome control timed out. No production database mutation, payment, broadcast or production deployment was performed. Account access and controlled live acceptance are explicit outstanding work, not completion claims.
