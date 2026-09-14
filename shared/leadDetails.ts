/** Historical intake stored package metadata and customer notes in one column. */
function structuredDetails(value?: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export function customerNotesFromDetails(value?: string | null): string {
  const details = structuredDetails(value);
  if (!details) return value?.trim() || "";
  for (const key of ["customerNotes", "notes", "additionalDetails", "details"]) {
    // An explicitly cleared customerNotes must not resurrect older notes.
    if (typeof details[key] === "string") return details[key].trim();
  }
  return "";
}

export function updateCustomerNotes(value: string | null | undefined, notes: string): string {
  const details = structuredDetails(value);
  if (!details) return notes.trim();
  // Preserve the exact historical value when only unrelated setup fields change.
  if (customerNotesFromDetails(value) === notes.trim()) return value!;
  return JSON.stringify({ ...details, customerNotes: notes.trim() });
}
