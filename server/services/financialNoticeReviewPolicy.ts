import { z } from 'zod';

export class FinancialNoticeReviewConflict extends Error {}
const common = {
  requestId: z.string().uuid(), eventKey: z.string().trim().min(1).max(1024),
  evidence: z.string().trim().min(10).max(2000),
};
export const financialNoticeResolutionSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('confirm_sent'), channel: z.enum(['email','sms']),
    attemptToken: z.string().uuid(), providerReference: z.string().trim().min(3).max(255) }).strict(),
  z.object({ ...common, action: z.literal('suppress') }).strict(),
]);
