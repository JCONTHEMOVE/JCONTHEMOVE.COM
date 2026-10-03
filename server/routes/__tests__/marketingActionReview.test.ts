import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { PGlite } from '@electric-sql/pglite';
import { MarketingDailyReview } from '../../../client/src/components/MarketingDailyReview';
import { splitMarketingActions, marketingLaunchProgress, type MarketingReviewAction } from '../../../shared/marketingActionReview';
import { completeMarketingAction } from '../../services/marketingActionReview';

const action = (id: string, key: string, status: string, rep = 'matt'): MarketingReviewAction => ({
  id, rep_id: rep, action_key: key, status, title: id, description: 'Approved loading campaign context',
  proof_url: null, proof_notes: null,
});
const submitted = { ...action('Submitted outreach', 'crew-fall-2026:2026-09-15:reach', 'submitted'), proof_url: 'https://example.test/public-post', proof_notes: 'Permitted apartment group\nShared the loading post.', submitted_at: '2026-09-15T15:00:00Z', campaign_variant_id: 'variant-matt', campaign_revision: 2 };
const future = { ...action('Future follow-up', 'crew-fall-2026:2026-09-15:reach:followup', 'assigned'), due_on: '2026-09-17' };
const reviewed = action('Reviewed daily', 'crew-fall-2026:2026-09-14:reach', 'completed');
const launch = [action('launch1', 'launch-profile', 'completed'), action('launch2', 'launch-publish', 'assigned'), action('launch3', 'launch-campaign', 'completed', 'unlinked')];
const all = [...launch, submitted, future, reviewed];
assert.deepEqual(splitMarketingActions(all), { launch, daily: [submitted, future, reviewed] });
assert.deepEqual(marketingLaunchProgress(all, [{ id: 'matt', attributionLinked: true }]), { total: 3, completed: 1, pendingAttribution: 1 });
const html = renderToStaticMarkup(React.createElement(MarketingDailyReview, { actions: [submitted, future, reviewed], pending: false, onApprove: () => {} }));
const dom = new JSDOM(html);
const articles = dom.window.document.querySelectorAll('article');
assert.equal(articles[0].querySelector('a')?.href, submitted.proof_url);
assert.ok(articles[0].textContent?.includes(submitted.proof_notes));
assert.match(articles[0].textContent!, /Sep 15, 2026.*10:00 AM Central/);
assert.match(articles[0].textContent!, /Approved loading campaign context/);
assert.match(articles[0].textContent!, /variant-matt.*Revision 2/);
assert.ok(html.indexOf('Shared the loading post.') < html.indexOf('Approve proof'), 'Evidence precedes approval');
assert.equal(articles[0].querySelectorAll('button').length, 1);
assert.equal(articles[1].querySelectorAll('button').length, 0);
assert.match(articles[1].textContent!, /Awaiting crew submission.*Follow-up due: 2026-09-17/s);
assert.equal(articles[2].querySelectorAll('button').length, 0);
const unsafe = renderToStaticMarkup(React.createElement(MarketingDailyReview, { actions: [{ ...submitted, proof_url: 'javascript:alert(1)' }], pending: true, onApprove: () => {} }));
assert.equal(new JSDOM(unsafe).window.document.querySelector('a'), null);
assert.ok(new JSDOM(unsafe).window.document.querySelector('button')?.disabled);
dom.window.close();

const pg = new PGlite();
try {
  await pg.exec(`CREATE TABLE marketing_action_assignments(id text PRIMARY KEY,action_key text,status text,proof_url text,proof_notes text,completed_at timestamptz,updated_at timestamptz)`);
  for (const item of all) await pg.query('INSERT INTO marketing_action_assignments(id,action_key,status,proof_url,proof_notes) VALUES($1,$2,$3,$4,$5)', [item.id, item.action_key, item.status, item.proof_url, item.proof_notes]);
  const approved = await completeMarketingAction(pg.query.bind(pg), submitted.id);
  assert.equal(approved.rows[0].status, 'completed');
  assert.equal(approved.rows[0].proof_url, submitted.proof_url);
  assert.equal(approved.rows[0].proof_notes, submitted.proof_notes);
  assert.equal((await completeMarketingAction(pg.query.bind(pg), future.id)).rows.length, 0);
  assert.equal((await completeMarketingAction(pg.query.bind(pg), submitted.id)).rows.length, 0);
  assert.equal((await completeMarketingAction(pg.query.bind(pg), 'launch2')).rows[0].status, 'completed');
  console.log('Marketing review: evidence, safe links, launch isolation, submitted-only approval and proof preservation passed.');
} finally { await pg.close(); }
