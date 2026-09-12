import assert from "node:assert/strict";
import { MARKETING_WEEKLY_THEMES } from "@shared/marketingWeek";
import { generateMarketingAdDraft, marketingAdDraftSchema } from "../marketingAdGenerator";

const referralLink = "https://www.jconthemove.com/network/matt";
const savedApiKey = process.env.OPENAI_API_KEY;
const savedFetch = globalThis.fetch;

function assertQuoteRequest(draft: Awaited<ReturnType<typeof generateMarketingAdDraft>>) {
  const publicCopy = [draft.headline, draft.facebookPost, draft.shortText, draft.followUpText].join("\n");
  assert.doesNotMatch(publicCopy, /\$|5%|1\.25x|1\.5x|2 crews|6 movers|guaranteed|available in/i);
  assert.ok(draft.facebookPost.includes(referralLink), "retain Matt's attribution link");
  assert.ok(draft.shortText.includes(referralLink), "retain attribution in short copy");
  assert.match(draft.facebookPost, /referral code MATT/);
  assert.match(draft.facebookPost, /confirm scope, price, and crew availability/);
}

async function main() {
  try {
    delete process.env.OPENAI_API_KEY;
    for (const area of MARKETING_WEEKLY_THEMES) {
      const draft = await generateMarketingAdDraft(marketingAdDraftSchema.parse({
        area, focus: "Moving help", referralLink, promoCode: "MATT",
      }));
      assertQuoteRequest(draft);
      assert.ok(draft.facebookPost.includes(area));
      assert.equal(draft.fallbackUsed, true);
    }

    const appreciationInput = marketingAdDraftSchema.parse({
      area: "Ironwood / Hurley", focus: "Crew appreciation", referralLink, promoCode: "MATT",
      rawText: "A Labor Day thank-you to our team and community.",
    });
    const fallback = await generateMarketingAdDraft(appreciationInput);
    assertQuoteRequest(fallback);
    assert.match(fallback.facebookPost, /Labor Day thank-you/);

    process.env.OPENAI_API_KEY = "test-key-no-network";
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const guidance = body.input[0].content;
      assert.doesNotMatch(guidance, /Approved offer:|Approved travel package language:|Mention 2 crews/);
      return Response.json({ output_text: JSON.stringify({
        headline: "Guaranteed 2 crews today for $1",
        shortText: "Save 5% with 1.5x travel pricing",
        followUpText: "6 movers available for $1",
      }) });
    };
    const assisted = await generateMarketingAdDraft(appreciationInput);
    assertQuoteRequest(assisted);
    assert.equal(assisted.facebookPost, fallback.facebookPost);
    assert.equal(assisted.headline, fallback.headline);
    assert.equal(assisted.shortText, fallback.shortText);
    assert.equal(assisted.followUpText, fallback.followUpText);
    console.log("marketing quote-request tests passed");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedApiKey;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
