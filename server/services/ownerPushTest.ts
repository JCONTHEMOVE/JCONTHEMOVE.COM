import type { Request, Response } from 'express';
import type { NotificationDeliveryResult } from './notification';
import type { getPushReadiness } from './pushConfig';

export const OWNER_PUSH_TEST_ID = 'jc87-owner-push-v1';
type Owner = { id: string; role: string | null; email?: string | null; pushSubscription?: unknown };
export function createOwnerPushTestHandlers(deps: {
  getUser(id: string): Promise<Owner | undefined>;
  readiness: typeof getPushReadiness;
  claim(userId: string): Promise<boolean>;
  send(userId: string, payload: { title: string; body: string; tag: string; data: { url: string } }): Promise<NotificationDeliveryResult>;
  record(userId: string, result: NotificationDeliveryResult): Promise<void>;
}) {
  async function owner(req: Request, res: Response) {
    const request = req as any;
    const id = request.user?.id || request.currentUser?.id || request.session?.userId;
    const user = id ? await deps.getUser(id) : undefined;
    if (!user) { res.status(401).json({ error: 'Sign in as the owner.' }); return; }
    // Deliberately narrower than the shared admin/owner middleware.
    if (user.role !== 'business_owner' && user.email !== 'upmichiganstatemovers@gmail.com') {
      res.status(403).json({ error: 'This test is business-owner-only.' }); return;
    }
    return user;
  }
  return {
    readiness: async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const user = await owner(req, res);
        if (!user) return;
        const config = deps.readiness();
        res.json({ ...config, ownerSubscriptionPresent: !!user.pushSubscription,
          canAttemptOwnerTest: config.ready && !!user.pushSubscription,
          liveDeliveryVerified: false,
          nextStep: 'Enable notifications on the owner device, then run the single-use owner test and confirm receipt and click-through manually.',
          test: { id: OWNER_PUSH_TEST_ID, recipient: 'authenticated_owner_only', customerRecipients: 0,
            title: 'JC-87 crew push test', body: 'Owner-only delivery check. No job schedule or customer action is changed.' } });
      } catch { res.status(500).json({ error: 'Could not inspect push readiness.' }); }
    },
    send: async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const user = await owner(req, res);
        if (!user) return;
        if (req.body?.confirmation !== OWNER_PUSH_TEST_ID || Object.keys(req.body).some(key => key !== 'confirmation')) {
          return res.status(400).json({ error: `Send only {"confirmation":"${OWNER_PUSH_TEST_ID}"}. Recipients and message content cannot be overridden.` });
        }
        const config = deps.readiness();
        if (!config.ready) return res.status(503).json(config);
        if (!user.pushSubscription) return res.status(409).json({ error: 'Enable notifications on the owner device first.' });
        // Durable reservation precedes delivery. Never retry an uncertain send automatically.
        if (!await deps.claim(user.id)) return res.status(409).json({ error: 'This owner test was already attempted. Inspect the delivery audit and device before preparing another test.' });
        const result = await deps.send(user.id, {
          title: 'JC-87 crew push test',
          body: 'Owner-only delivery check. No job schedule or customer action is changed.',
          tag: OWNER_PUSH_TEST_ID, data: { url: '/admin/dispatch' },
        });
        await deps.record(user.id, result);
        res.status(result.status === 'sent' ? 200 : 502).json({ testId: OWNER_PUSH_TEST_ID, push: result,
          deliveryMeaning: 'sent means accepted by the push provider; confirm receipt and click-through on the owner device.', customerRecipients: 0 });
      } catch { res.status(500).json({ error: 'Owner test could not complete. Inspect the audit before retrying; a reserved test will not send again.' }); }
    },
  };
}
