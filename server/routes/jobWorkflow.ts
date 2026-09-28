import { Router } from "express";
import { z } from "zod";
import { isAuthenticated } from "../auth";
import { pool } from "../db";
import { approveAndSend, confirmCustomer, executeCrewAction, getJobWorkflow, reviewJobQuote, workflowActor, WorkflowError } from "../services/jobWorkflow";

const router = Router();
const deliveryMethod = z.enum(["email", "sms", "both", "copy"]);
const approvalSchema = z.object({
  version: z.string().length(64), reviewHash: z.string().length(64), idempotencyKey: z.string().uuid(),
  deliveryMethod, message: z.string().trim().max(2000).optional(), recordSmsConsent: z.boolean().optional(), overrideReason: z.string().trim().max(2000).optional(),
});

router.use("/leads/:id", isAuthenticated, async (req: any, res, next) => {
  if (!/\/(workflow|quote-review|approve-and-send|customer-confirmation|crew-action)$/.test(req.path)) return next();
  try {
    const userId = req.currentUser?.id || req.user?.id || req.session?.userId;
    const actor = userId ? await workflowActor(userId) : null;
    if (!actor || !actor.canApproveStandard && !actor.manage && actor.tier !== "silver") return res.status(403).json({ error: "Quote or job management authority is required." });
    if (!actor.manage) {
      const { rows } = await pool.query("SELECT status,crew_members,accepted_by_employees,assigned_to_user_id FROM leads WHERE id=$1", [req.params.id]);
      const lead = rows[0];
      if (!lead) return res.status(404).json({ error: "Job not found" });
      const assigned = lead.assigned_to_user_id === userId || [...(lead.crew_members || []), ...(lead.accepted_by_employees || [])].includes(userId);
      const quoteTask = ["new", "contacted", "quote_requested", "chatbot_pending", "pending_quote_approval", "quoted"].includes(lead.status);
      if (!quoteTask && !(assigned && actor.canApproveStandard)) return res.status(403).json({ error: "This job is outside your assigned work." });
    }
    req.workflowActor = actor;
    next();
  } catch (error) { next(error); }
});

function failure(res: any, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0].message, blockers: [] });
  if (error instanceof WorkflowError) return res.status(error.status).json({ error: error.message, blockers: error.blockers });
  console.error("[job-workflow] operation failed:", error);
  return res.status(500).json({ error: "This action could not finish. Your entered details are preserved; refresh its status before retrying." });
}

router.get("/leads/:id/workflow", async (req: any, res) => {
  try {
    const workflow = await getJobWorkflow(req.params.id, req.workflowActor);
    if (!req.workflowActor.manage) {
      workflow.delivery = undefined;
      workflow.payment = { ready: false, label: "Managed by staff" };
    }
    res.json(workflow);
  } catch (error) { failure(res, error); }
});

router.post("/leads/:id/quote-review", async (req: any, res) => {
  try {
    const input = z.object({ deliveryMethod: deliveryMethod.default("email") }).parse(req.body || {});
    const review = await reviewJobQuote(req.params.id, req.workflowActor, input.deliveryMethod);
    res.json({ version: review.version, reviewHash: review.reviewHash, quote: review.quote, blockers: review.blockers,
      recipient: review.recipient, smsConsent: review.smsConsent, invoiceAvailable: review.invoiceAvailable,
      schedule: { date: review.lead.confirmedDate, window: review.lead.arrivalWindow },
      fromAddress: review.lead.confirmedFromAddress || review.lead.fromAddress,
      toAddress: review.lead.confirmedToAddress || review.lead.toAddress,
      service: review.lead.serviceType, ownerReasons: review.policy?.travelEligibility?.reasons || [] });
  } catch (error) { failure(res, error); }
});

router.post("/leads/:id/approve-and-send", async (req: any, res) => {
  try { res.json(await approveAndSend(req.params.id, req.workflowActor, approvalSchema.parse(req.body))); } catch (error) { failure(res, error); }
});

router.post("/leads/:id/customer-confirmation", async (req: any, res) => {
  try {
    const input = z.object({ version: z.string().length(64), method: z.enum(["phone", "text", "email"]), attested: z.literal(true), note: z.string().trim().max(2000).optional() }).parse(req.body);
    res.json(await confirmCustomer(req.params.id, req.workflowActor, input));
  } catch (error) { failure(res, error); }
});

router.post("/leads/:id/crew-action", async (req: any, res) => {
  try {
    const input = z.object({ version: z.string().length(64), action: z.enum(["notify", "dispatch"]), idempotencyKey: z.string().uuid() }).parse(req.body);
    res.json(await executeCrewAction(req.params.id, req.workflowActor, input));
  } catch (error) { failure(res, error); }
});

export default router;
