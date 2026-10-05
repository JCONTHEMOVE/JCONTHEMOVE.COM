import { useLayoutEffect, type RefObject } from "react";

/**
 * Publishes the live height of a fixed bottom overlay (cookie notice, app
 * install prompt, ...) as a CSS custom property on <html>, so page content and
 * other bottom-anchored UI can reserve space instead of being covered.
 *
 * The combined value is exposed as `--jc-bottom-overlays` (see index.css).
 */
export function useBottomOverlayInset(
  ref: RefObject<HTMLElement>,
  cssVar: "--jc-cookie-bar-h" | "--jc-install-prompt-h",
  active: boolean,
) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!active || !el) {
      root.style.removeProperty(cssVar);
      return;
    }
    const publish = () => root.style.setProperty(cssVar, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty(cssVar);
    };
  }, [ref, cssVar, active]);
}
