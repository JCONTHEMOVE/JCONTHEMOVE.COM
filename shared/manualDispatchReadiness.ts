/** Saved setup required before the owner records payment and dispatches crew.
 * This is not evidence that payment was received or a provider verification. */
export function manualDispatchMissingSetup(lead: {
  totalPrice?: string | number | null;
  basePrice?: string | number | null;
  confirmedDate?: string | null;
  moveDate?: string | null;
  crewSize?: number | null;
  crewMembers?: string[] | null;
}): string[] {
  const missing: string[] = [];
  const price = Number(lead.totalPrice ?? lead.basePrice);
  if (!Number.isFinite(price) || price <= 0) missing.push("a positive saved quote");
  const date = String(lead.confirmedDate || lead.moveDate || "").trim().slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    missing.push("a valid service date");
  }
  const size = Number(lead.crewSize);
  const members = new Set((lead.crewMembers || []).map(id => id.trim()).filter(Boolean));
  if (!Number.isInteger(size) || size < 1) missing.push("a crew size");
  if (members.size < (Number.isInteger(size) && size > 0 ? size : 1)) {
    missing.push("the full named crew roster");
  }
  return missing;
}
