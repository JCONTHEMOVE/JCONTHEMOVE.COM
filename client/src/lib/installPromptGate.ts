/**
 * Holds the PWA install prompt back on quote / calculator pages so it never
 * stacks over the estimate or the draft-estimate disclaimer.
 *
 * On these routes the prompt stays hidden until the visitor shows intent by
 * clicking "Review quote" or completing a quote submit. After that (for the
 * rest of the browser session) the prompt may appear as usual. All other
 * routes (home, marketplace, etc.) are unaffected.
 */

/** Exact paths treated as quote / calculator pages. */
export const QUOTE_CALCULATOR_ROUTES = ["/snow-removal", "/quote"] as const;

const STORAGE_KEY = "jc-quote-reviewed";
export const QUOTE_REVIEWED_EVENT = "jc:quote-reviewed";

export function isQuoteCalculatorRoute(pathname: string): boolean {
  const path = (pathname.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  return (QUOTE_CALCULATOR_ROUTES as readonly string[]).includes(path.toLowerCase());
}

export function hasReviewedQuote(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Call when the visitor clicks "Review quote" or a quote submit succeeds. */
export function markQuoteReviewed(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* Storage can be unavailable (private mode); the event still releases the prompt for this page view. */
  }
  window.dispatchEvent(new Event(QUOTE_REVIEWED_EVENT));
}
