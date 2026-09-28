export type GmailApiOutcome = "sent" | "auth-rejected" | "failed";

// Only an explicit authentication rejection is safe to retry with SMTP.
// A timeout after submission might already have delivered the email.
export async function deliverWithGmailFallback(options: {
  hasOAuth: boolean;
  hasSmtp: boolean;
  api: () => Promise<GmailApiOutcome>;
  smtp: () => Promise<boolean>;
}): Promise<boolean> {
  if (!options.hasOAuth) return options.hasSmtp ? options.smtp() : false;
  const outcome = await options.api();
  if (outcome === "sent") return true;
  if (outcome === "auth-rejected" && options.hasSmtp) return options.smtp();
  return false;
}
