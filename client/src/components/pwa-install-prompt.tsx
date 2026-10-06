import { useState, useEffect, useRef } from "react";
import { X, Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useBottomOverlayInset } from "@/hooks/useBottomOverlayInset";
import { QUOTE_REVIEWED_EVENT, hasReviewedQuote, isQuoteCalculatorRoute } from "@/lib/installPromptGate";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();
  const [quoteReviewed, setQuoteReviewed] = useState(hasReviewedQuote);
  // On quote/calculator pages (e.g. /snow-removal) hold the prompt back until the
  // visitor clicks "Review quote" or submits, so it never covers the estimate.
  const heldForQuote = isQuoteCalculatorRoute(location) && !quoteReviewed;
  const visible = showBanner && !dismissed && !heldForQuote;
  // Reserve space for the prompt so it never covers page content (e.g. the snow estimate).
  useBottomOverlayInset(promptRef, "--jc-install-prompt-h", visible);

  useEffect(() => {
    const release = () => setQuoteReviewed(true);
    window.addEventListener(QUOTE_REVIEWED_EVENT, release);
    return () => window.removeEventListener(QUOTE_REVIEWED_EVENT, release);
  }, []);

  useEffect(() => {
    // Don't show if already installed (running in standalone mode)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Don't show if user dismissed recently (within 7 days)
    const lastDismissed = localStorage.getItem("pwa-prompt-dismissed");
    if (lastDismissed) {
      const daysSince = (Date.now() - parseInt(lastDismissed)) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) return;
    }

    // Detect iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIos(ios);

    if (ios) {
      // On iOS, show manual instructions after a short delay
      setTimeout(() => setShowBanner(true), 3000);
      return;
    }

    // On Android/Desktop, listen for the native prompt event
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setDismissed(true);
    localStorage.setItem("pwa-prompt-dismissed", Date.now().toString());
  };

  if (!visible) return null;

  return (
    // Stacks directly above the cookie notice (if shown) instead of overlapping it.
    <div
      ref={promptRef}
      className="fixed left-0 right-0 z-50 p-3 animate-in slide-in-from-bottom-4 duration-300"
      style={{ bottom: "var(--jc-cookie-bar-h, env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="max-w-md mx-auto bg-slate-900 border border-blue-500/30 rounded-2xl shadow-2xl shadow-blue-900/40 p-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 text-white font-black text-lg">
            JC
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">Install JC ON THE MOVE</p>
            {isIos ? (
              <p className="text-xs text-slate-400 mt-0.5">
                Tap <Share className="inline h-3 w-3 mx-0.5" /> then <strong className="text-slate-300">"Add to Home Screen"</strong> for the full app experience
              </p>
            ) : (
              <p className="text-xs text-slate-400 mt-0.5">
                Add to your home screen for faster access — works offline too
              </p>
            )}
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-500 hover:text-slate-300 flex-shrink-0 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {!isIos && deferredPrompt && (
          <div className="mt-3 flex gap-2">
            <Button
              onClick={handleInstall}
              size="sm"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs h-9"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Install App
            </Button>
            <Button
              onClick={handleDismiss}
              size="sm"
              variant="ghost"
              className="text-slate-400 hover:text-slate-200 text-xs h-9"
            >
              Not now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
