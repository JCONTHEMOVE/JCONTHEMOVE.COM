import type { RequestHandler } from "express";
import { customerPhoneIssue } from "@shared/customerPhonePolicy";

/** Reject invalid contact details before a handler can create a job or payment. */
export const validateCustomerPhoneSubmission: RequestHandler = (req, res, next) => {
  const issue = customerPhoneIssue(req.method, req.path, req.body);
  if (issue) {
    res.status(400).json({ error: issue.message, fieldErrors: { [issue.field]: issue.message } });
    return;
  }
  next();
};
