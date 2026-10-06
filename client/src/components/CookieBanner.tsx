import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useBottomOverlayInset } from "@/hooks/useBottomOverlayInset";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  // Reserve space for the notice so it never covers page content (e.g. the snow estimate).
  useBottomOverlayInset(barRef, "--jc-cookie-bar-h", visible);

  useEffect(() => {
    const dismissed = localStorage.getItem("jc_cookie_notice_dismissed");
    if (!dismissed) setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem("jc_cookie_notice_dismissed", "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="Cookie notice"
      className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-700 px-4 pt-3 flex items-center justify-between gap-4 shadow-xl"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      <p className="text-xs text-zinc-400 flex-1">
        <span className="text-white font-semibold">🍪 Cookie notice: </span>
        This site uses a single session cookie (for login only) and a local visitor ID to count
        page traffic. We do not use advertising or third-party tracking cookies.
      </p>
      <button
        onClick={dismiss}
        className="shrink-0 text-zinc-500 hover:text-white transition-colors"
        aria-label="Dismiss cookie notice"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
