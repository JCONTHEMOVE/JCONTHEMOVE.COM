import type { RequestHandler } from 'express';
import { FinancialNoticeReviewConflict, financialNoticeResolutionSchema } from './financialNoticeReviewPolicy';
import type { getFinancialNoticeReview, resolveFinancialNotice } from './jobFinancialNoticeReview';

export function createFinancialNoticeReviewHandler(dependencies: {
  read?: typeof getFinancialNoticeReview; resolve?: typeof resolveFinancialNotice;
} = {}): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control','private, no-store');
    const user = (req as typeof req & { currentUser?: { id?: string; role?: string } }).currentUser;
    if (!user?.id) { res.status(401).json({ error:'Authentication required' }); return; }
    if (!['admin','business_owner'].includes(user.role || '')) { res.status(403).json({ error:'Administrator access required' }); return; }
    const leadId = req.params.leadId;
    if (typeof leadId !== 'string' || !leadId.trim() || leadId.length>255) { res.status(400).json({ error:'Invalid job ID' }); return; }
    try {
      if (req.method === 'GET') {
        const read = dependencies.read || (await import('./jobFinancialNoticeReview')).getFinancialNoticeReview;
        res.json(await read(leadId)); return;
      }
      const parsed = financialNoticeResolutionSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error:'Provide a valid review action, evidence and receipt details' }); return; }
      const resolve = dependencies.resolve || (await import('./jobFinancialNoticeReview')).resolveFinancialNotice;
      res.json(await resolve(leadId,user.id,parsed.data));
    } catch (error) {
      if (error instanceof FinancialNoticeReviewConflict) { res.status(409).json({ error:error.message }); return; }
      res.status(500).json({ error:'Financial notice review is unavailable' });
    }
  };
}
