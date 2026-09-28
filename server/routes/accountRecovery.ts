import { Router } from "express";
import type { RecoveryDatabase } from "../services/accountRecovery";
import { createAccountRecovery, RecoveryError } from "../services/accountRecovery";

export function createAccountRecoveryRouter(db: RecoveryDatabase, options: Parameters<typeof createAccountRecovery>[1]) {
  const router = Router();
  const service = createAccountRecovery(db, options);
  for (const action of ["request", "verify", "reset"] as const) {
    router.post(`/${action}`, async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        const body = req.body || {};
        const result = action === "request" ? await service.request(body.contact, ip)
          : action === "verify" ? await service.verify(body.contact, body.token, ip)
          : await service.reset(body.newPassword, body.resetToken, ip);
        res.json(result);
      } catch (error) {
        if (error instanceof RecoveryError) {
          if (error.status === 429) res.setHeader("Retry-After", "900");
          res.status(error.status).json({ error: error.message });
        } else {
          // Do not log contacts, codes, passwords, reset tokens, or provider credentials.
          console.error(`[account-recovery] ${action} failed`);
          res.status(503).json({ error: "Account recovery is temporarily unavailable. Please try again later or call (906) 285-9312." });
        }
      }
    });
  }
  return router;
}
