import type { PersonalPromoCodes } from "./personalPromoCodes";
import { marketingAdDraftSchema } from "./marketingAdGenerator";

type Approved = Awaited<ReturnType<PersonalPromoCodes["forAd"]>>;

export function personalPromoAdInput(body: Record<string, unknown>, workerName: string, approved: Approved, appUrl: string) {
  return marketingAdDraftSchema.parse({
    ...body, workerName, promoCode: approved.promo.code,
    referralLink: new URL(approved.bookingPath, appUrl).toString(),
  });
}

export function personalPromoSnapshotMatches(snapshot: any, approved: Approved) {
  return snapshot?.id === approved.promo.id && snapshot?.code === approved.promo.code
    && snapshot?.offer?.offerLine === approved.offer.offerLine
    && snapshot?.offer?.secondaryLine === approved.offer.secondaryLine
    && snapshot?.offer?.caption === approved.offer.caption;
}
