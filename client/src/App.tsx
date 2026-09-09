import { Component as ReactComponent, ReactNode, lazy, Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { WalletProviderWrapper } from "@/components/WalletProviderWrapper";
import { RouteGuard } from "@/components/RouteGuard";
import { ComplianceCheck } from "@/components/compliance-check";
import Header from "@/components/header";
import BottomTabBar from "@/components/bottom-tab-bar";
import PwaInstallPrompt from "@/components/pwa-install-prompt";
import { CartProvider } from "@/hooks/useCart";
import { NotificationPrompt } from "@/components/notification-prompt";
import { useMiningNotifications } from "@/hooks/useMiningNotifications";
import { getVisitorId, usePageView } from "@/hooks/usePageView";
import CookieBanner from "@/components/CookieBanner";
import { FloatingCartButton } from "@/components/cart-button";

// Layouts (kept eager — they render the shell before page content)
import CrewLayout from "@/layouts/CrewLayout";
import AdminLayout from "@/layouts/AdminLayout";

// All pages are lazy-loaded — each page's JS only downloads when first visited
const HomePage = lazy(() => import("@/pages/home"));
const LegacyHomePage = lazy(() => import("@/pages/_archive/home"));
const SplashPage = lazy(() => import("@/pages/splash"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const CustomerHomePage = lazy(() => import("@/pages/customer-home"));
const MyJobsPage = lazy(() => import("@/pages/my-jobs"));
// Canonical customer + worker booking engine. The same mobile wizard owns
// address resolution, scheduling, quote review, and submission on /book.
const MultiServiceBookPage = lazy(() => import("@/pages/book"));
const JobCloseoutPage = lazy(() => import("@/pages/job-closeout"));
const ScheduleRequestPage = lazy(() => import("@/pages/schedule-request"));
const CustomerWalletPage = lazy(() => import("@/pages/customer/wallet"));
const WalletAddCreditPage = lazy(() => import("@/pages/wallet-add-credit"));
const CustomerEarnPage = lazy(() => import("@/pages/customer/earn"));
// Task #169 — ServicePackagesPage retired (route redirects to /book)
const CrewJobsPage = lazy(() => import("@/pages/crew-jobs"));
const CustomerRewardsPage = lazy(() => import("@/pages/customer-rewards"));
const CustomerProfilePage = lazy(() => import("@/pages/customer-profile"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const RewardsPage = lazy(() => import("@/pages/rewards"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const EmployeeHomePage = lazy(() => import("@/pages/employee-home"));
const AdminControlPage = lazy(() => import("@/pages/control"));
const EmployeeDashboard = lazy(() => import("@/pages/employee-dashboard"));
// Task #169 — EmployeeAddJob retired (route redirects to /book?worker=1)
const LeadsPage = lazy(() => import("@/pages/leads"));
const CustomerPortal = lazy(() => import("@/pages/customer-portal"));
const PendingApprovalPage = lazy(() => import("@/pages/pending-approval"));
const InGodWeTrustPage = lazy(() => import("@/pages/in-god-we-trust"));
const AdminTreasuryPage = lazy(() => import("@/pages/admin-treasury"));
const AdminUsersPage = lazy(() => import("@/pages/admin-users"));
const AdminLotteryPage = lazy(() => import("@/pages/admin-lottery"));
const AdminTestimonialsPage = lazy(() => import("@/pages/admin-testimonials"));
const AdminPromoCodesPage = lazy(() => import("@/pages/admin-promo-codes"));
const AdminPipelinePage = lazy(() => import("@/pages/admin-pipeline"));
const RewardsMarketplacePage = lazy(() => import("@/pages/rewards-marketplace"));
const AdminRewardShopPage = lazy(() => import("@/pages/admin-reward-shop"));
const AdminSystemCheckPage = lazy(() => import("@/pages/admin-system-check"));
const AdminSquareCatalogPage = lazy(() => import("@/pages/admin-square-catalog"));
const NotFound = lazy(() => import("@/pages/not-found"));
const MobileLeadManager = lazy(() => import("@/components/mobile-lead-manager"));
const CustomerMobileInterface = lazy(() => import("@/components/customer-mobile-interface"));
const JobDetailPage = lazy(() => import("@/pages/job-detail"));
const TermsOfService = lazy(() => import("@/pages/terms"));
const PendingQuotesPage = lazy(() => import("@/pages/pending-quotes"));
const EmployeesPage = lazy(() => import("@/pages/employees"));
const LeadDetailPage = lazy(() => import("@/pages/lead-detail"));
const EmployeeRegister = lazy(() => import("@/pages/employee-register"));
const EmployeeLogin = lazy(() => import("@/pages/employee-login"));
const CustomerLogin = lazy(() => import("@/pages/customer-login"));
const LoginPage = lazy(() => import("@/pages/login"));
const ForgotAccessPage = lazy(() => import("@/pages/forgot-access"));
const LeaveReviewPage = lazy(() => import("@/pages/leave-review"));
const QuotePage = lazy(() => import("@/pages/quote"));
const PublicQuoteOrderPage = lazy(() => import("@/pages/public-quote-order"));
const SponsorsPage = lazy(() => import("@/pages/sponsors"));
const ServicesPage = lazy(() => import("@/pages/services"));
const OffersPage = lazy(() => import("@/pages/offers"));
const GiftCardsPage = lazy(() => import("@/pages/gift-cards"));
const GiftCardBonusPage = lazy(() => import("@/pages/gift-card-bonus"));
const RouteDaysPage = lazy(() => import("@/pages/route-days"));
const GalleryPage = lazy(() => import("@/pages/gallery"));
const ReviewsPage = lazy(() => import("@/pages/reviews"));
const SwapPage = lazy(() => import("@/pages/swap"));
const RequestSwapPage = lazy(() => import("@/pages/request-swap"));
const MiningPage = lazy(() => import("@/pages/mining"));
const SnowRemovalOpsPage = lazy(() => import("@/pages/snow-removal"));
const SnowRemovalPublicPage = lazy(() => import("@/pages/snow-removal-public"));
const WindowCleaningPage = lazy(() => import("@/pages/window-cleaning"));
const TrashValetPage = lazy(() => import("@/pages/trash-valet"));
const TrashValetBookPage = lazy(() => import("@/pages/trash-valet/book"));
const TrashValetGiftPage = lazy(() => import("@/pages/trash-valet/gift"));
const AdminTrashValetPage = lazy(() => import("@/pages/admin-trash-valet"));
const MobilePreviewPage = lazy(() => import("@/pages/mobile-preview"));
const PiJackpotPage = lazy(() => import("@/pages/pi-jackpot"));
const PrivacyPolicy = lazy(() => import("@/pages/privacy"));
const NatureMadeJewls = lazy(() => import("@/pages/nature-made-jewls"));
const JewelryDetailPage = lazy(() => import("@/pages/jewelry-detail"));
const MovingEstimator = lazy(() => import("@/pages/moving-estimator"));
const PaymentSuccessPage = lazy(() => import("@/pages/payment-success"));
const PromoHalfDayPage = lazy(() => import("@/pages/promo-half-day"));
const CartPage = lazy(() => import("@/pages/cart"));
const AshleyShopAdminPage = lazy(() => import("@/pages/ashley-shop-admin"));
const BitcoinPaymentPage = lazy(() => import("@/pages/bitcoin-payment"));
const AdminBtcPaymentsPage = lazy(() => import("@/pages/admin-btc-payments"));
const StakingPage = lazy(() => import("@/pages/staking"));
const AdminQuoteReviewPage = lazy(() => import("@/pages/admin-quote-review"));
const CrewAddJobPage = lazy(() => import("@/pages/crew/add-job"));
const CrewSchedulePage = lazy(() => import("@/pages/crew/schedule"));
const CrewEarningsPage = lazy(() => import("@/pages/crew/earnings"));
const CrewReviewsPage = lazy(() => import("@/pages/crew/reviews"));
const AdminOverviewPage = lazy(() => import("@/pages/admin/overview"));
const AdminOpsBoardPage = lazy(() => import("@/pages/admin/ops-board"));
const AdminPeoplePage = lazy(() => import("@/pages/admin/people"));
const AdminFinancePage = lazy(() => import("@/pages/admin/finance"));
const AdminMarketplacePage = lazy(() => import("@/pages/admin/marketplace"));
const AdminMarketplacePlaybookPage = lazy(() => import("@/pages/admin/marketplace-playbook"));
const AdminSystemPage = lazy(() => import("@/pages/admin/system"));
const AdminPricingPage = lazy(() => import("@/pages/admin/pricing"));
const AdminDispatchPage = lazy(() => import("@/pages/admin/dispatch"));
const AdminRegionalAutomationPage = lazy(() => import("@/pages/admin/regional-automation"));
const AdminSponsorsPage = lazy(() => import("@/pages/admin/sponsors"));
const AdminAnalyticsPage = lazy(() => import("@/pages/admin/analytics"));
const AdminBookingAnalyticsPage = lazy(() => import("@/pages/admin/booking-analytics"));
const AdminMarketingNetworkPage = lazy(() => import("@/pages/admin/marketing-network"));
const AdminMarketingWebhooksPage = lazy(() => import("@/pages/admin/marketing-webhooks"));
const AdminNorthwoodsMarketingPage = lazy(() => import("@/pages/admin/northwoods-marketing"));
const ChiefOfStaffPage = lazy(() => import("@/pages/admin/chief-of-staff"));
const UhaulMarketPage = lazy(() => import("@/pages/uhaul-market"));
const AdminPaymentsPage = lazy(() => import("@/pages/admin/AdminPaymentsPage"));
const AdminWalletLedgerPage = lazy(() => import("@/pages/admin/AdminWalletLedgerPage"));
const AdminCashoutsPage = lazy(() => import("@/pages/admin/AdminCashoutsPage"));
const AdminLaunchChecklistPage = lazy(() => import("@/pages/admin/AdminLaunchChecklistPage"));
const AdminGiftCardBonusesPage = lazy(() => import("@/pages/admin/gift-card-bonuses"));
const JobPlannerPage = lazy(() => import("@/pages/job-planner"));
const QuickBookPage = lazy(() => import("@/pages/quick-book"));
const BookLawnCarePage = lazy(() => import("@/pages/book-lawn-care"));
const AdminLawnCarePage = lazy(() => import("@/pages/admin-lawn-care"));
const LawnCarePage = lazy(() => import("@/pages/lawn-care"));
const MoveOutCleaningPage = lazy(() => import("@/pages/move-out-cleaning"));
const RoofingPage = lazy(() => import("@/pages/roofing"));
const DemolitionPage = lazy(() => import("@/pages/demolition"));
const PricingPage = lazy(() => import("@/pages/pricing"));
const HubPage = lazy(() => import("@/pages/hub"));
const MarketingRepPage = lazy(() => import("@/pages/marketing-rep"));
const MarketingOnboardingPage = lazy(() => import("@/pages/marketing-onboarding"));
const TutorialsPage = lazy(() => import("@/pages/tutorials"));

// Thin fallback shown while a lazy page chunk is downloading
function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
    </div>
  );
}

// Landing page for unauthenticated users — uses the new homepage
function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <HomePage />
    </div>
  );
}

// Original home page (public-facing marketing page)
function PublicHomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <HomePage />
    </div>
  );
}

// Detect stale deployment chunk errors — browser has old bundle, auto-reload fixes it
function isChunkLoadError(error: any): boolean {
  const msg = error?.message || String(error) || "";
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Loading chunk") ||
    msg.includes("Loading CSS chunk") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("error loading dynamically imported module")
  );
}

// Root error boundary — catches ANY crash in the entire app tree
class RootErrorBoundary extends ReactComponent<
  { children: ReactNode },
  { hasError: boolean; error: string; stack: string; componentStack: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: "", stack: "", componentStack: "" };
  }
  static getDerivedStateFromError(error: any) {
    // Auto-reload on stale deployment chunk errors
    if (isChunkLoadError(error)) {
      window.location.reload();
      return { hasError: false, error: "", stack: "", componentStack: "" };
    }
    return {
      hasError: true,
      error: error?.message || String(error) || "Unknown error",
      stack: error?.stack || "",
      componentStack: "",
    };
  }
  componentDidCatch(error: any, info: any) {
    if (isChunkLoadError(error)) return; // already reloading
    console.error("[RootErrorBoundary] Caught crash:", error, info);
    this.setState({ componentStack: info?.componentStack || "" });
    fetch("/api/client-error", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        boundary: "RootErrorBoundary",
        error: error?.message,
        stack: error?.stack,
        componentStack: info?.componentStack,
        visitorId: getVisitorId(),
        page: window.location.pathname + window.location.search,
      }),
    }).catch(() => {});
  }
  render() {
    if (this.state.hasError) {
      const showDiagnostics = import.meta.env.DEV;
      return (
        <div style={{ minHeight: "100vh", background: "#111", color: "#eee", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "sans-serif" }}>
          <div style={{ maxWidth: 600, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "0.5rem" }}>Something went wrong</h2>
            <p style={{ color: "#aaa", fontSize: "0.875rem", marginBottom: "1rem", wordBreak: "break-word" }}>
              {showDiagnostics ? this.state.error : "The page could not be opened. Please try again."}
            </p>
            {showDiagnostics && this.state.componentStack && (
              <pre style={{ background: "#1e1e1e", color: "#8f8", fontSize: "0.65rem", padding: "0.75rem", borderRadius: "0.5rem", textAlign: "left", overflowX: "auto", maxHeight: 220, marginBottom: "0.5rem" }}>
                {this.state.componentStack.slice(0, 1200)}
              </pre>
            )}
            {showDiagnostics && this.state.stack && (
              <pre style={{ background: "#1e1e1e", color: "#f88", fontSize: "0.65rem", padding: "0.75rem", borderRadius: "0.5rem", textAlign: "left", overflowX: "auto", maxHeight: 160, marginBottom: "1rem" }}>
                {this.state.stack.slice(0, 600)}
              </pre>
            )}
            <button
              style={{ padding: "0.5rem 1.5rem", background: "#f97316", color: "#fff", border: "none", borderRadius: "0.5rem", cursor: "pointer", fontWeight: "bold" }}
              onClick={() => { this.setState({ hasError: false, error: "", stack: "", componentStack: "" }); window.location.href = "/"; }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Page-level error boundary — shows friendly message and recovers per-page
class PageErrorBoundary extends ReactComponent<
  { children: ReactNode },
  { hasError: boolean; error: string; componentStack: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: "", componentStack: "" };
  }
  static getDerivedStateFromError(error: any) {
    // Ignore React's synchronous suspension warning — Suspense handles this
    if (error?.message?.includes("suspended while responding to synchronous input")) {
      return { hasError: false, error: "", componentStack: "" };
    }
    // Auto-reload on stale deployment chunk errors
    if (isChunkLoadError(error)) {
      window.location.reload();
      return { hasError: false, error: "", componentStack: "" };
    }
    return { hasError: true, error: error?.message || "Something went wrong", componentStack: "" };
  }
  componentDidCatch(error: any, info: any) {
    // Ignore React's synchronous suspension warning
    if (error?.message?.includes("suspended while responding to synchronous input")) return;
    if (isChunkLoadError(error)) return; // already reloading
    console.error("[PageErrorBoundary] Caught crash:", error, info);
    this.setState({ componentStack: info?.componentStack || "" });
    fetch("/api/client-error", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        boundary: "PageErrorBoundary",
        error: error?.message,
        stack: error?.stack,
        componentStack: info?.componentStack,
        visitorId: getVisitorId(),
        page: window.location.pathname + window.location.search,
      }),
    }).catch(() => {});
  }
  render() {
    if (this.state.hasError) {
      const showDiagnostics = import.meta.env.DEV;
      return (
        <div style={{ minHeight: "100vh", background: "#111", color: "#eee", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "sans-serif" }}>
          <div style={{ maxWidth: 600, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "0.5rem" }}>Something went wrong</h2>
            <p style={{ color: "#aaa", fontSize: "0.875rem", marginBottom: "1rem", wordBreak: "break-word" }}>
              {showDiagnostics ? this.state.error : "The page could not be opened. Please try again."}
            </p>
            {showDiagnostics && this.state.componentStack && (
              <pre style={{ background: "#1e1e1e", color: "#8f8", fontSize: "0.65rem", padding: "0.75rem", borderRadius: "0.5rem", textAlign: "left", overflowX: "auto", maxHeight: 220, marginBottom: "1rem" }}>
                {this.state.componentStack.slice(0, 1200)}
              </pre>
            )}
            <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem" }}>
              <button
                style={{ padding: "0.5rem 1.5rem", background: "#334155", color: "#fff", border: "none", borderRadius: "0.5rem", cursor: "pointer", fontWeight: "bold" }}
                onClick={() => window.location.reload()}
              >
                Try Again
              </button>
              <button
                style={{ padding: "0.5rem 1.5rem", background: "#f97316", color: "#fff", border: "none", borderRadius: "0.5rem", cursor: "pointer", fontWeight: "bold" }}
                onClick={() => { this.setState({ hasError: false, error: "", componentStack: "" }); window.location.href = "/"; }}
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Silent error boundary — wraps floating/overlay components so they fail invisibly
class SilentErrorBoundary extends ReactComponent<
  { children: ReactNode; label?: string },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any, info: any) {
    console.error(`[SilentErrorBoundary:${(this as any).props.label ?? "?"}] Suppressed crash:`, error, info);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// Unified page wrapper with responsive header
function PageWrapper({ component: Component }: { component: any }) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Header />
      <main>
        <PageErrorBoundary>
          <Component />
        </PageErrorBoundary>
      </main>
    </div>
  );
}

function PlannerLegacyRedirect({ plannerPath }: { plannerPath: string }) {
  const [location] = useLocation();
  const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
  const leadId = new URLSearchParams(query).get("lead");
  if (leadId) {
    return <Redirect to={`/lead/${encodeURIComponent(leadId)}?returnTo=${encodeURIComponent(plannerPath)}`} />;
  }
  return <Redirect to={plannerPath} />;
}

// Customer app with bottom tab navigation
function CustomerApp() {
  return (
    <ComplianceCheck>
      <div className="min-h-screen bg-background text-foreground font-sans">
        <NotificationPrompt />
        <Switch>
          <Route path="/">
            <CustomerHomePage />
          </Route>
          <Route path="/my-jobs">
            <MyJobsPage />
          </Route>
          <Route path="/jobs">
            <MyJobsPage />
          </Route>
          <Route path="/book">
            <MultiServiceBookPage />
          </Route>
          <Route path="/book/chat">
            <MultiServiceBookPage />
          </Route>
          <Route path="/schedule-request/:token">
            <ScheduleRequestPage />
          </Route>
          <Route path="/wallet">
            <CustomerWalletPage />
          </Route>
          <Route path="/wallet/add-credit">
            <WalletAddCreditPage />
          </Route>
          <Route path="/earn">
            <CustomerEarnPage />
          </Route>
          {/* Task #169 — /post-job consolidated into /book (worker mode is
              opt-in via explicit ?worker=1 from worker UI buttons) */}
          <Route path="/post-job">
            <Redirect to="/book" />
          </Route>
          <Route path="/window-cleaning">
            <WindowCleaningPage />
          </Route>
          <Route path="/lawn-care">
            <LawnCarePage />
          </Route>
          <Route path="/cleaning">
            <MoveOutCleaningPage />
          </Route>
          <Route path="/roofing">
            <RoofingPage />
          </Route>
          <Route path="/demolition">
            <DemolitionPage />
          </Route>
          {/* Task #169 — /packages consolidated into /book */}
          <Route path="/packages">
            <Redirect to="/book" />
          </Route>
          <Route path="/crew-jobs">
            <CrewJobsPage />
          </Route>
          <Route path="/rewards">
            <CustomerRewardsPage />
          </Route>
          <Route path="/profile">
            <CustomerProfilePage />
          </Route>
          <Route path="/customer-portal">
            <CustomerPortal />
          </Route>
          <Route path="/staking">
            <PageWrapper component={StakingPage} />
          </Route>
          <Route path="/marketplace">
            <PageWrapper component={RewardsMarketplacePage} />
          </Route>
          <Route path="/mining">
            <PageWrapper component={MiningPage} />
          </Route>
          <Route path="/pending-approval">
            <PendingApprovalPage />
          </Route>
          <Route component={NotFound} />
        </Switch>
        <BottomTabBar />
      </div>
    </ComplianceCheck>
  );
}

// Main app for authenticated users - Unified routing for all devices
function AuthenticatedApp() {
  const { user, isPending } = useAuth();
  const [location] = useLocation();
  useMiningNotifications();
  
  // Redirect pending users to pending-approval page
  if (isPending) {
    return (
      <ComplianceCheck>
        <div className="min-h-screen bg-background text-foreground font-sans">
          <Switch>
            <Route path="/pending-approval">
              <PendingApprovalPage />
            </Route>
            <Route path="/customer-portal">
              <RouteGuard allowedRoles={['customer', 'admin']} allowPending={true}>
                <PageWrapper component={CustomerPortal} />
              </RouteGuard>
            </Route>
            <Route>
              <Redirect to="/pending-approval" />
            </Route>
          </Switch>
        </div>
      </ComplianceCheck>
    );
  }
  
  // Customers get the new mobile-first experience with bottom tabs
  if (user?.role === 'customer') {
    return <CustomerApp />;
  }

  // Non-customer roles get role-appropriate default pages at root
  if (user?.role === 'admin' && location === "/") {
    return <Redirect to="/admin" />;
  }
  const isCrewRole = user?.role === 'employee' || user?.role === 'business_owner';
  if (isCrewRole && location === "/") {
    return <Redirect to="/crew" />;
  }
  
  // === CREW APP (employees, admin, business_owner) ===
  // Task #169 — /post-job no longer routes inside CrewLayout. Workers land
  // on /book?worker=1 (the unified front door), redirected via the route
  // below for in-app navigations and via server-side 301 for cold hits.
  if (location.startsWith("/crew")) {
    return (
      <ComplianceCheck>
        <RouteGuard allowedRoles={['admin', 'employee', 'business_owner']}>
          <NotificationPrompt />
          <CrewLayout>
            <Switch>
              <Route path="/crew/add-job"><CrewAddJobPage /></Route>
              <Route path="/crew/jobs"><PlannerLegacyRedirect plannerPath="/crew" /></Route>
              <Route path="/crew/schedule"><CrewSchedulePage /></Route>
              <Route path="/crew/reviews"><CrewReviewsPage /></Route>
              <Route path="/crew/marketing"><CrewEarningsPage marketingOnly /></Route>
              <Route path="/crew/earnings"><CrewEarningsPage /></Route>
              <Route path="/crew/tutorials"><TutorialsPage /></Route>
              <Route path="/crew"><JobPlannerPage audience="crew" /></Route>
              <Route><Redirect to="/crew" /></Route>
            </Switch>
          </CrewLayout>
        </RouteGuard>
      </ComplianceCheck>
    );
  }
  if (location === "/quick-book") {
    return (
      <ComplianceCheck>
        <RouteGuard allowedRoles={['admin', 'employee', 'business_owner']}>
          <NotificationPrompt />
          <QuickBookPage />
        </RouteGuard>
      </ComplianceCheck>
    );
  }
  if (location === "/post-job") {
    return <Redirect to="/book" />;
  }

  // === ADMIN PANEL (admin, business_owner) ===
  if (location.startsWith("/admin") && !location.startsWith("/admin/btc-payments") && !location.startsWith("/admin/quote-review")) {
    return (
      <ComplianceCheck>
        <RouteGuard allowedRoles={['admin', 'business_owner']}>
          <NotificationPrompt />
          <AdminLayout>
            <Switch>
              <Route path="/admin"><Redirect to="/admin/schedule" /></Route>
              <Route path="/admin/overview"><AdminOverviewPage /></Route>
              <Route path="/admin/ops-board"><AdminOpsBoardPage /></Route>
              <Route path="/admin/dispatch"><AdminDispatchPage /></Route>
              <Route path="/admin/regional-automation"><AdminRegionalAutomationPage /></Route>
              <Route path="/admin/jobs"><PlannerLegacyRedirect plannerPath="/admin/schedule" /></Route>
              <Route path="/admin/people"><AdminPeoplePage /></Route>
              <Route path="/admin/finance"><AdminFinancePage /></Route>
              <Route path="/admin/gift-card-bonuses"><AdminGiftCardBonusesPage /></Route>
              <Route path="/admin/pricing"><AdminPricingPage /></Route>
              <Route path="/admin/marketplace"><AdminMarketplacePage /></Route>
              <Route path="/admin/marketplace-playbook"><AdminMarketplacePlaybookPage /></Route>
              <Route path="/admin/system"><AdminSystemPage /></Route>
              <Route path="/admin/sponsors"><AdminSponsorsPage /></Route>
              <Route path="/admin/analytics"><AdminAnalyticsPage /></Route>
              <Route path="/admin/booking-analytics"><AdminBookingAnalyticsPage /></Route>
              <Route path="/admin/marketing-network"><AdminMarketingNetworkPage /></Route>
              <Route path="/admin/marketing"><AdminNorthwoodsMarketingPage /></Route>
              <Route path="/admin/chief-of-staff"><ChiefOfStaffPage /></Route>
              <Route path="/admin/marketing-webhooks"><AdminMarketingWebhooksPage /></Route>
              <Route path="/admin/payments"><AdminPaymentsPage /></Route>
              <Route path="/admin/wallet-ledger"><AdminWalletLedgerPage /></Route>
              <Route path="/admin/cashouts"><AdminCashoutsPage /></Route>
              <Route path="/admin/launch-checklist"><AdminLaunchChecklistPage /></Route>
              <Route path="/admin/schedule"><JobPlannerPage audience="admin" /></Route>
              <Route path="/admin/tutorials"><TutorialsPage /></Route>
              {/* Legacy admin URL redirects */}
              <Route path="/admin/calibrate"><Redirect to="/admin/pricing" /></Route>
              <Route path="/admin/pricing-calibration"><Redirect to="/admin/pricing" /></Route>
              <Route path="/admin/treasury"><Redirect to="/admin/finance" /></Route>
              <Route path="/admin/users"><Redirect to="/admin/people" /></Route>
              <Route path="/admin/employees"><Redirect to="/admin/people" /></Route>
              <Route path="/admin/rewards"><Redirect to="/admin/marketplace" /></Route>
              <Route><Redirect to="/admin/schedule" /></Route>
            </Switch>
          </AdminLayout>
        </RouteGuard>
      </ComplianceCheck>
    );
  }

  return (
    <ComplianceCheck>
      <div className="min-h-screen bg-background text-foreground font-sans">
        <NotificationPrompt />
        <Switch>
          {/* Primary routes - accessible on all devices */}
          <Route path="/">
            <PageWrapper component={HubPage} />
          </Route>
          <Route path="/dashboard">
            <Redirect to="/admin" />
          </Route>
          {/* Legacy staff URL now opens the shared crew calendar intake. */}
          <Route path="/employee/add-job">
            <Redirect to="/crew/add-job" />
          </Route>
          <Route path="/employee/dashboard">
            <RouteGuard allowedRoles={['admin', 'employee', 'business_owner']}>
              <PageWrapper component={EmployeeDashboard} />
            </RouteGuard>
          </Route>
          <Route path="/leads">
            <Redirect to={user?.role === "admin" ? "/admin/schedule?add=1" : "/crew/add-job"} />
          </Route>
          <Route path="/lead/:id">
            <PageWrapper component={LeadDetailPage} />
          </Route>
          <Route path="/pending-quotes">
            <RouteGuard allowedRoles={['admin', 'employee']}>
              <PageWrapper component={PendingQuotesPage} />
            </RouteGuard>
          </Route>
          <Route path="/employees">
            <RouteGuard allowedRoles={['admin']}>
              <PageWrapper component={EmployeesPage} />
            </RouteGuard>
          </Route>
          <Route path="/rewards">
            <PageWrapper component={RewardsPage} />
          </Route>
          <Route path="/mining">
            <PageWrapper component={MiningPage} />
          </Route>
          <Route path="/swap">
            <PageWrapper component={SwapPage} />
          </Route>
          <Route path="/request-swap">
            <RouteGuard allowedRoles={['admin', 'employee']}>
              <PageWrapper component={RequestSwapPage} />
            </RouteGuard>
          </Route>
          <Route path="/reviews">
            <PageWrapper component={ReviewsPage} />
          </Route>
          <Route path="/profile">
            <PageWrapper component={ProfilePage} />
          </Route>
          <Route path="/tutorials">
            <RouteGuard allowedRoles={['admin', 'employee', 'business_owner']}>
              <PageWrapper component={TutorialsPage} />
            </RouteGuard>
          </Route>
          <Route path="/customer-portal">
            <RouteGuard allowedRoles={['customer', 'admin']} allowPending={true}>
              <PageWrapper component={CustomerPortal} />
            </RouteGuard>
          </Route>
          <Route path="/pending-approval">
            <PendingApprovalPage />
          </Route>
          <Route path="/hub">
            <Redirect to="/crew" />
          </Route>
          <Route path="/control">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminControlPage} />
            </RouteGuard>
          </Route>
          <Route path="/in-god-we-trust">
            <Redirect to="/admin/finance" />
          </Route>
          <Route path="/admin/treasury">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminTreasuryPage} />
            </RouteGuard>
          </Route>
          <Route path="/admin/lottery">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminLotteryPage} />
            </RouteGuard>
          </Route>
          <Route path="/admin/users">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminUsersPage} />
            </RouteGuard>
          </Route>
          <Route path="/admin/testimonials">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminTestimonialsPage} />
            </RouteGuard>
          </Route>
          <Route path="/admin/pipeline">
            <Redirect to="/admin/jobs" />
          </Route>
          <Route path="/admin/promo-codes">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminPromoCodesPage} />
            </RouteGuard>
          </Route>
          <Route path="/admin/system-check">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminSystemCheckPage} />
            </RouteGuard>
          </Route>
          <Route path="/admin/square-catalog">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminSquareCatalogPage} />
            </RouteGuard>
          </Route>
          <Route path="/admin/marketplace">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminRewardShopPage} />
            </RouteGuard>
          </Route>
          <Route path="/marketplace">
            <PageWrapper component={RewardsMarketplacePage} />
          </Route>
          <Route path="/ops/snow-removal">
            <RouteGuard allowedRoles={['admin', 'employee', 'business_owner']}>
              <PageWrapper component={SnowRemovalOpsPage} />
            </RouteGuard>
          </Route>
          <Route path="/admin/snow-removal">
            <Redirect to="/ops/snow-removal" />
          </Route>
          <Route path="/admin-trash-valet">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminTrashValetPage} />
            </RouteGuard>
          </Route>
          <Route path="/trash-valet/book">
            <PageWrapper component={TrashValetBookPage} />
          </Route>
          <Route path="/trash-valet/gift">
            <PageWrapper component={TrashValetGiftPage} />
          </Route>
          <Route path="/trash-valet">
            <PageWrapper component={TrashValetPage} />
          </Route>
          <Route path="/book/lawn-care">
            <PageWrapper component={BookLawnCarePage} />
          </Route>
          <Route path="/admin/lawn-care">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <PageWrapper component={AdminLawnCarePage} />
            </RouteGuard>
          </Route>
          <Route path="/window-cleaning">
            <PageWrapper component={WindowCleaningPage} />
          </Route>
          <Route path="/snow-removal">
            <PageWrapper component={SnowRemovalPublicPage} />
          </Route>
          <Route path="/mobile-preview">
            <RouteGuard allowedRoles={['admin', 'business_owner']}>
              <MobilePreviewPage />
            </RouteGuard>
          </Route>
          
          {/* Job management interface */}
          <Route path="/jobs">
            <RouteGuard allowedRoles={['admin', 'employee']}>
              <MobileLeadManager />
            </RouteGuard>
          </Route>

          {/* Crew job board for employees */}
          <Route path="/crew-jobs">
            <RouteGuard allowedRoles={['admin', 'employee', 'business_owner']}>
              <PageWrapper component={CrewJobsPage} />
            </RouteGuard>
          </Route>
          
          {/* Legacy admin routes - redirect to unified dashboard */}
          <Route path="/treasury">
            <Redirect to="/in-god-we-trust" />
          </Route>
          <Route path="/admin-moonshot">
            <Redirect to="/in-god-we-trust" />
          </Route>
          
          {/* Job detail route */}
          <Route path="/job/:id">
            <RouteGuard allowedRoles={['admin']}>
              <JobDetailPage />
            </RouteGuard>
          </Route>
          
          <Route component={NotFound} />
        </Switch>
      </div>
    </ComplianceCheck>
  );
}

function PageViewTracker() {
  usePageView();
  return null;
}

const PUBLIC_PATH_PREFIXES = [
  "/",
  "/get-started",
  "/home",
  "/network",
  "/rep",
  "/matt",
  "/troy",
  "/evan",
  "/bill",
  "/darrell",
  "/employee-register",
  "/login",
  "/employee-login",
  "/customer-login",
  "/forgot-access",
  "/leave-review",
  "/customer",
  "/terms",
  "/privacy",
  "/quote",
  "/quote-order",
  "/job-closeout",
  "/book",
  "/trash-valet",
  "/window-cleaning",
  "/lawn-care",
  "/cleaning",
  "/roofing",
  "/demolition",
  "/sponsors",
  "/services",
  "/offers",
  "/gift-cards",
  "/route-days",
  "/pricing",
  "/gallery",
  "/reviews",
  "/pi-jackpot",
  "/nature-made-jewls",
  "/handmade-jewels-by-ashley",
  "/ashley-shop-admin",
  "/legacy-home",
  "/welcome",
  "/moving-estimator",
  "/payment-success",
  "/promo/half-day",
  "/cart",
  "/bitcoin-payment",
  "/uhaul",
];

function isPublicPath(path: string) {
  if (path === "/") return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => prefix !== "/" && (path === prefix || path.startsWith(`${prefix}/`)));
}

function Router() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const shouldHoldProtectedRoute = isLoading && !isPublicPath(location);

  return (
    <Switch>
      {import.meta.env.DEV && (
        <Route path="/quick-book-fixture">{() => <QuickBookPage visualFixture />}</Route>
      )}
      {/* Onboarding / Get Started */}
      <Route path="/get-started" component={OnboardingPage} />

      {/* Public site (original marketing page) */}
        <Route path="/home">{() => <PublicHomePage />}</Route>
        <Route path="/marketing-onboarding" component={MarketingOnboardingPage} />
        <Route path="/network/:slug" component={MarketingRepPage} />
      <Route path="/rep/:slug" component={MarketingRepPage} />
      <Route path="/matt"><Redirect to="/network/matt" /></Route>
      <Route path="/troy"><Redirect to="/network/troy" /></Route>
      <Route path="/evan"><Redirect to="/network/evan" /></Route>
      <Route path="/bill"><Redirect to="/network/bill" /></Route>
      <Route path="/darrell"><Redirect to="/network/darrell" /></Route>

      {/* Public authentication routes */}
      <Route path="/employee-register" component={EmployeeRegister} />
      <Route path="/login" component={LoginPage} />
      <Route path="/employee-login" component={LoginPage} />
      <Route path="/customer-login" component={LoginPage} />
      <Route path="/forgot-access" component={ForgotAccessPage} />
      <Route path="/leave-review" component={LeaveReviewPage} />
      
      {/* Customer interface - accessible to all users without authentication */}
      <Route path="/customer" component={CustomerMobileInterface} />
      
      {/* Terms of Service - accessible to all */}
      <Route path="/terms" component={TermsOfService} />
      
      {/* Privacy Policy - accessible to all */}
      <Route path="/privacy" component={PrivacyPolicy} />
      
      {/* Quote page - accessible to all */}
      <Route path="/quote" component={QuotePage} />
      <Route path="/quote-order/:id" component={PublicQuoteOrderPage} />
      <Route path="/job-closeout/:token" component={JobCloseoutPage} />
      <Route path="/schedule-request/:token" component={ScheduleRequestPage} />
      
      {/* Book page - accessible to all users, authenticated or not */}
      <Route path="/book" component={MultiServiceBookPage} />
      <Route path="/book/chat" component={MultiServiceBookPage} />
      <Route path="/offers/:code" component={OffersPage} />
      <Route path="/offers" component={OffersPage} />
      <Route path="/uhaul/:slug" component={UhaulMarketPage} />

      {/* Trash Valet pages - accessible to all */}
      <Route path="/trash-valet/book" component={TrashValetBookPage} />
      <Route path="/trash-valet/gift" component={TrashValetGiftPage} />
      <Route path="/trash-valet" component={TrashValetPage} />

      {/* Lawn Care booking page - accessible to all */}
      <Route path="/book/lawn-care" component={BookLawnCarePage} />

      {/* Window Cleaning booking page - accessible to all */}
      <Route path="/window-cleaning" component={WindowCleaningPage} />
      <Route path="/snow-removal" component={SnowRemovalPublicPage} />

      {/* Service pages - accessible to all */}
      <Route path="/lawn-care" component={LawnCarePage} />
      <Route path="/cleaning" component={MoveOutCleaningPage} />
      <Route path="/roofing" component={RoofingPage} />
      <Route path="/demolition" component={DemolitionPage} />
      
      {/* Sponsors page - accessible to all */}
      <Route path="/sponsors" component={SponsorsPage} />
      
      {/* Services page - accessible to all */}
      <Route path="/services" component={ServicesPage} />
      <Route path="/gift-cards/bonus" component={GiftCardBonusPage} />
      <Route path="/gift-cards" component={GiftCardsPage} />
      <Route path="/route-days" component={RouteDaysPage} />
      <Route path="/route-days/:slug" component={RouteDaysPage} />
      <Route path="/pricing" component={PricingPage} />
      
      {/* Gallery page - accessible to all */}
      <Route path="/gallery" component={GalleryPage} />
      
      {/* Reviews page - accessible to all */}
      <Route path="/reviews" component={ReviewsPage} />
      
      {/* Pi Jackpot - Pi Network lottery app landing page */}
      <Route path="/pi-jackpot" component={PiJackpotPage} />
      
      {/* Handmade Jewels by Ashley — Made with Love */}
      <Route path="/handmade-jewels-by-ashley" component={NatureMadeJewls} />
      <Route path="/handmade-jewels-by-ashley/:id" component={JewelryDetailPage} />
      <Route path="/nature-made-jewls/:id">{(params) => <Redirect to={`/handmade-jewels-by-ashley/${params.id}`} />}</Route>
      <Route path="/nature-made-jewls"><Redirect to="/handmade-jewels-by-ashley" /></Route>
      <Route path="/ashley-shop-admin" component={AshleyShopAdminPage} />
      {/* Legacy public homepage preserved for reference */}
      <Route path="/legacy-home" component={LegacyHomePage} />
      <Route path="/welcome" component={LegacyHomePage} />
      <Route path="/moving-estimator" component={MovingEstimator} />
      <Route path="/payment-success" component={PaymentSuccessPage} />
      <Route path="/promo/half-day" component={PromoHalfDayPage} />
      <Route path="/cart" component={CartPage} />
      <Route path="/bitcoin-payment" component={BitcoinPaymentPage} />
      <Route path="/admin/btc-payments" component={AdminBtcPaymentsPage} />
      <Route path="/staking" component={StakingPage} />
      <Route path="/admin/quote-review">
        <RouteGuard allowedRoles={['admin', 'employee', 'business_owner']}>
          <AdminQuoteReviewPage />
        </RouteGuard>
      </Route>
      
      {/* Authenticated vs unauthenticated routing */}
      <Route>
        {shouldHoldProtectedRoute ? (
          <div className="min-h-screen bg-background text-foreground font-sans flex items-center justify-center">
            <div className="text-center">
              <div className="text-lg">Loading...</div>
            </div>
          </div>
        ) : isAuthenticated ? <AuthenticatedApp /> : <LandingPage />}
      </Route>
    </Switch>
  );
}

function AppWithTracking() {
  return (
    <>
      <PageViewTracker />
      <Router />
      <FloatingCartButton />
    </>
  );
}

function App() {
  return (
    <RootErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <WalletProviderWrapper>
            <CartProvider>
              <TooltipProvider>
                <PageErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <AppWithTracking />
                  </Suspense>
                </PageErrorBoundary>
                <Toaster />
                <CookieBanner />
                <SilentErrorBoundary label="PwaInstallPrompt">
                  <PwaInstallPrompt />
                </SilentErrorBoundary>
              </TooltipProvider>
            </CartProvider>
          </WalletProviderWrapper>
        </QueryClientProvider>
      </ThemeProvider>
    </RootErrorBoundary>
  );
}

export default App;
