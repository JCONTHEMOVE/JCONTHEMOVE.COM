import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, X } from "lucide-react";
import { Link } from "wouter";
import QuoteForm from "@/components/QuoteForm";
import { getService } from "@/lib/services";
import { markQuoteReviewed } from "@/lib/installPromptGate";
import { useAuth } from "@/hooks/useAuth";

function AccountCTABanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mt-6 relative rounded-2xl overflow-hidden border border-orange-500/40 bg-gradient-to-br from-orange-950/60 to-slate-900/80 p-5">
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-slate-400 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-5 w-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="text-white font-bold text-base mb-1">Track your jobs & earn rewards</h3>
          <p className="text-slate-400 text-sm mb-3">
            Create a free account to view your quote history and earn JCMOVES rewards on every service.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Link href="/login">
              <Button size="sm" className="bg-orange-500 hover:bg-orange-400 text-white font-bold rounded-xl h-9 px-4">
                Create Free Account
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm" variant="ghost" className="text-slate-400 hover:text-white rounded-xl h-9 px-4">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QuotePage() {
  const [location] = useLocation();
  const [prefilledService, setPrefilledService] = useState<string>("");
  const [prefilledDate, setPrefilledDate] = useState<string>("");
  const [prefilledPromoCode, setPrefilledPromoCode] = useState<string>("");
  const [showAccountCTA, setShowAccountCTA] = useState(false);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const service = params.get('service');
    const date = params.get('date');
    const promo = params.get('promo');
    if (service) {
      setPrefilledService(service);
    }
    if (date) {
      setPrefilledDate(date);
    }
    if (promo) {
      setPrefilledPromoCode(promo);
    }
  }, [location]);

  const getServiceTitle = () => {
    const svc = getService(prefilledService);
    return svc ? `${svc.label} Quote` : "Get Your Free Quote";
  };

  const handleSuccess = () => {
    markQuoteReviewed();
    setPrefilledService("");
    setPrefilledDate("");
    setPrefilledPromoCode("");
    if (!isAuthenticated) {
      setShowAccountCTA(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href="/">
          <Button variant="ghost" className="text-white hover:bg-white/10 mb-6" data-testid="button-back">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </Link>

        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2" data-testid="heading-quote">
            {getServiceTitle()}
          </h1>
          <p className="text-slate-300">
            Fill out the form below and we'll get back to you within 24 hours.
          </p>
        </div>
        
        <QuoteForm 
          variant="customer"
          prefilledDate={prefilledDate}
          prefilledService={prefilledService}
          prefilledPromoCode={prefilledPromoCode}
          onSuccess={handleSuccess}
        />

        {showAccountCTA && !isAuthenticated && (
          <AccountCTABanner onDismiss={() => setShowAccountCTA(false)} />
        )}

        <div className="mt-8 text-center text-slate-300">
          <p className="mb-2">Need immediate help?</p>
          <a href="tel:+19062859312" className="text-xl font-bold text-primary hover:text-primary/80 transition-colors">
            Call (906) 285-9312
          </a>
        </div>
      </div>
    </div>
  );
}
