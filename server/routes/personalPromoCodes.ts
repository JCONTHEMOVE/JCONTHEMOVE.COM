import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { personalPromoNameSchema, personalPromoReviewSchema } from "@shared/personalPromo";
import { PersonalPromoCodes, PersonalPromoError } from "../services/personalPromoCodes";

export function createPersonalPromoRouter(auth: RequestHandler, employee: RequestHandler, owner: RequestHandler, service: PersonalPromoCodes) {
  const router = Router();
  const noCache: RequestHandler = (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); };
  const actor = (req: any) => String((req.currentUser || req.user)?.id || "");
  const handle = (action: (req: any) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ error: error.issues[0]?.message || "Check the code request." });
      if (error instanceof PersonalPromoError) return void res.status(error.status).json({ error: error.message });
      console.error("[personal-promo] request failed", error);
      res.status(503).json({ error: "Promo codes could not be saved or loaded. Please retry." });
    }
  };
  router.get("/crew/marketing/promo-code", auth, employee, noCache, handle(req => service.state(actor(req))));
  router.post("/crew/marketing/promo-code/requests", auth, employee, noCache, handle(req => {
    const { code } = z.object({ code: personalPromoNameSchema }).strict().parse(req.body);
    return service.request(actor(req), code);
  }));
  router.get("/admin/promo-code-requests", auth, owner, noCache, handle(() => service.reviewQueue()));
  router.post("/admin/promo-code-requests/:id/review", auth, owner, noCache, handle(req => service.review(String(req.params.id), actor(req), personalPromoReviewSchema.parse(req.body))));
  return router;
}
