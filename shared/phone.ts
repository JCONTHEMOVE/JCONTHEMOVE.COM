/** North American customer phone entry. Formatting is not ownership verification. */
export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("1") && digits.length > 10 ? digits.slice(1) : digits;
}

export function phoneError(value: string, required = true): string | null {
  const text = value.trim();
  if (!text) return required ? "Enter your 10-digit phone number, including the area code." : null;
  if (!/^\+?[\d\s().-]+$/.test(text)) return "Use numbers only, with no letters or extension.";
  if (text.startsWith("+") && !text.startsWith("+1")) return "Enter a North American number with country code +1.";
  const digits = phoneDigits(text);
  if (digits.length < 10) return `${10 - digits.length} ${digits.length === 9 ? "digit is" : "digits are"} missing—include your 3-digit area code.`;
  if (digits.length > 10) return "Too many digits—enter 10 digits, plus an optional country code 1.";
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return "Check the area code and phone number; neither three-digit group can start with 0 or 1.";
  return null;
}

export function formatPhoneEntry(value: string): string {
  // Preserve unsupported input so it can be corrected instead of silently changed.
  if (!/^\+?[\d\s().-]*$/.test(value) || (value.startsWith("+") && !value.startsWith("+1"))) return value;
  const raw = value.replace(/\D/g, "");
  if (raw.length > 11 || (raw.length === 11 && !raw.startsWith("1"))) return value;
  const digits = phoneDigits(value);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)].filter(Boolean).join("-");
}

export function normalizeCustomerPhone(value: unknown): string | null {
  if (typeof value !== "string" || phoneError(value)) return null;
  const digits = phoneDigits(value);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function unchangedLegacyPhone(value: string, original?: string | null): boolean {
  return original != null && value.trim() === formatPhoneEntry(original).trim() && !!phoneError(original);
}
