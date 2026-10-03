import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useState, useRef, useEffect } from "react";
import { Menu, X, User, LogOut, Sun, Moon, ChevronDown, ShoppingBag, Gem, BarChart3, Globe, Gift } from "lucide-react";
import { apiRequest, clearTokens, queryClient } from "@/lib/queryClient";

export default function Header() {
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { user, isAuthenticated, hasAdminAccess, isLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      clearTokens();
      queryClient.clear();
      window.location.href = "/";
    }
  };

  const scrollToSection = (sectionId: string) => {
    if (location === "/") {
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      window.location.href = `/#${sectionId}`;
    }
    setMobileMenuOpen(false);
  };

  const isEmployee = user?.role === 'employee' || user?.role === 'admin';
  const isCustomer = user?.role === 'customer';
  const isAdmin = hasAdminAccess || user?.role === 'business_owner';
  const publicNavLinkClass = "rounded-lg border border-slate-300/20 bg-slate-950/70 px-4 py-2 text-sm font-bold text-white transition-colors hover:border-blue-300/50 hover:bg-blue-950/60";
  const publicNavPrimaryClass = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-blue-500";
  const publicMobileLinkClass = "rounded-lg border border-slate-300/20 bg-slate-950/70 px-4 py-2.5 text-center text-sm font-bold text-white transition-colors hover:border-blue-300/50 hover:bg-blue-950/60";
  const publicMobilePrimaryClass = "rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-black text-white transition-colors hover:bg-blue-500";

  return (
    <header className="bg-background shadow-sm border-b border-border sticky top-0 z-50">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Link href="/" data-testid="link-home">
              <div className="flex flex-col">
                <h1 className="text-xl font-bold text-primary">JC ON THE MOVE</h1>
                <span className="text-[10px] text-muted-foreground -mt-1">Northwoods Moving & More</span>
              </div>
            </Link>
          </div>
          
          {!isMobile ? (
            <div className="hidden md:flex items-center gap-1">
              {isAuthenticated ? (
                <>
                  <Link
                    href="/"
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location === '/' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary'
                    }`}
                    data-testid="button-home"
                  >
                    {isCustomer ? 'My Portal' : 'Dashboard'}
                  </Link>
                  
                  {isEmployee && (
                    <Link
                      href="/dashboard"
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        location === '/dashboard' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary'
                      }`}
                      data-testid="button-dashboard"
                    >
                      Jobs
                    </Link>
                  )}

                  <Link
                    href="/rewards"
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location === '/rewards' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary'
                    }`}
                    data-testid="button-rewards"
                  >
                    Rewards
                  </Link>

                  <Link
                    href="/marketplace"
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location === '/marketplace' ? 'text-yellow-500 bg-yellow-500/10' : 'text-muted-foreground hover:text-yellow-500'
                    }`}
                  >
                    Rewards Shop
                  </Link>

                  <div className="relative" ref={moreMenuRef}>
                    <button
                      onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                      className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        moreMenuOpen ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary'
                      }`}
                      data-testid="button-more"
                    >
                      More
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {moreMenuOpen && (
                      <div className="absolute right-0 mt-1 w-48 bg-background border border-border rounded-lg shadow-lg py-1 z-50">
                        <Link
                          href="/handmade-jewels-by-ashley"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                          data-testid="button-jewls"
                          onClick={() => setMoreMenuOpen(false)}
                        >
                          <Gem className="h-4 w-4 text-emerald-500" />
                          <span className="bg-gradient-to-r from-emerald-600 to-amber-500 bg-clip-text text-transparent">Ashley’s Shop</span>
                        </Link>
                        <Link
                          href="/staking"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                          data-testid="button-staking"
                          onClick={() => setMoreMenuOpen(false)}
                        >
                          <BarChart3 className="h-4 w-4" />
                          Staking
                        </Link>
                        <div className="border-t border-border my-1" />
                        <a
                          href="/#home"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                          data-testid="button-view-public"
                          onClick={() => setMoreMenuOpen(false)}
                        >
                          <Globe className="h-4 w-4" />
                          Public Site
                        </a>
                      </div>
                    )}
                  </div>

                  {isAdmin && (
                    <Link
                      href="/in-god-we-trust"
                      className={`px-3 py-2 rounded-md text-sm font-bold transition-colors ${
                        location === '/in-god-we-trust'
                          ? 'bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent'
                          : 'bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent hover:from-blue-600 hover:to-purple-600'
                      }`}
                      data-testid="button-in-god-we-trust"
                    >
                      IGWT
                    </Link>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => scrollToSection("home")}
                    className={publicNavLinkClass}
                    data-testid="button-home"
                  >
                    Home
                  </button>
                  <Link
                    href="/gallery"
                    className={publicNavLinkClass}
                    data-testid="button-gallery"
                  >
                    Work Photos
                  </Link>
                  <Link
                    href="/services"
                    className={publicNavLinkClass}
                    data-testid="button-quotes-services"
                  >
                    Services
                  </Link>
                  <Link
                    href="/gift-cards"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-black text-amber-100 transition-colors hover:border-amber-200/60 hover:bg-amber-300/20"
                    data-testid="button-public-gift-cards"
                  >
                    <Gift className="h-4 w-4" /> Gift Cards
                  </Link>
                  <Link
                    href="/book?mode=quick&service=moving"
                    className={publicNavPrimaryClass}
                    data-testid="button-public-book"
                  >
                    Book Now
                  </Link>
                </div>
              )}
              
              <div className="flex items-center gap-1 ml-2 pl-2 border-l border-border">
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-full hover:bg-muted transition-colors"
                  data-testid="button-theme-toggle"
                  title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4 text-yellow-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
                </button>
                
                {isAuthenticated ? (
                  <>
                    <Link
                      href="/profile"
                      className="flex items-center gap-1.5 text-sm hover:text-primary transition-colors cursor-pointer px-2 py-1.5 rounded-md"
                      data-testid="link-profile"
                    >
                      {user?.profileImageUrl ? (
                        <img 
                          src={user.profileImageUrl} 
                          alt="Profile" 
                          className="w-6 h-6 rounded-full object-cover"
                          data-testid="img-profile-avatar"
                        />
                      ) : (
                        <User className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-primary"
                      data-testid="button-logout"
                      title="Logout"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <Link 
                    href="/login" 
                    className="rounded-lg border border-emerald-400/30 bg-emerald-600/15 px-4 py-2 text-sm font-black text-emerald-100 transition-colors hover:bg-emerald-600/25"
                    data-testid="button-employee-login"
                  >
                    JC CREW HQ
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="md:hidden flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-full hover:bg-muted transition-colors"
                data-testid="button-mobile-theme-toggle"
              >
                {theme === "dark" ? <Sun className="h-4 w-4 text-yellow-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                data-testid="button-mobile-menu"
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </Button>
            </div>
          )}
        </div>
        
        {isMobile && mobileMenuOpen && (
          <div className="md:hidden border-t border-border py-3">
            <div className="flex flex-col space-y-1">
              {isAuthenticated ? (
                <>
                  <Link
                    href="/"
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      location === '/' ? 'text-primary bg-primary/10' : 'text-foreground hover:text-primary hover:bg-muted'
                    }`}
                    data-testid="button-mobile-home"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {isCustomer ? 'My Portal' : 'Dashboard'}
                  </Link>
                  
                  {isEmployee && (
                    <Link
                      href="/dashboard"
                      className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                        location === '/dashboard' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary hover:bg-muted'
                      }`}
                      data-testid="button-mobile-dashboard"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Jobs
                    </Link>
                  )}

                  <Link
                    href="/rewards"
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      location === '/rewards' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary hover:bg-muted'
                    }`}
                    data-testid="button-mobile-rewards"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Rewards
                  </Link>

                  <Link
                    href="/marketplace"
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      location === '/marketplace' ? 'text-yellow-500 bg-yellow-500/10' : 'text-muted-foreground hover:text-yellow-500 hover:bg-muted'
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    🎁 Rewards Shop
                  </Link>

                  <div className="border-t border-border my-1" />
                  <span className="px-3 py-1 text-xs text-muted-foreground/60 uppercase tracking-wider">Marketplace</span>

                  <Link
                    href="/handmade-jewels-by-ashley"
                    className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-bold transition-colors hover:bg-muted"
                    data-testid="button-mobile-jewls"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Gem className="h-4 w-4 text-emerald-500" />
                    <span className="bg-gradient-to-r from-emerald-600 to-amber-500 bg-clip-text text-transparent">Ashley’s Shop</span>
                  </Link>
                  <Link
                    href="/staking"
                    className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                    data-testid="button-mobile-staking"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <BarChart3 className="h-4 w-4" />
                    Staking
                  </Link>

                  {isAdmin && (
                    <>
                      <div className="border-t border-border my-1" />
                      <Link
                        href="/in-god-we-trust"
                        className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-bold transition-colors hover:bg-muted"
                        data-testid="button-mobile-in-god-we-trust"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">IN GOD WE TRUST</span>
                      </Link>
                    </>
                  )}

                  <div className="border-t border-border my-1" />

                  <Link
                    href="/profile"
                    className="flex items-center gap-2 px-3 py-2.5 text-sm hover:text-primary hover:bg-muted transition-colors cursor-pointer rounded-md"
                    data-testid="link-mobile-profile"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {user?.profileImageUrl ? (
                      <img 
                        src={user.profileImageUrl} 
                        alt="Profile" 
                        className="w-5 h-5 rounded-full object-cover"
                        data-testid="img-mobile-profile-avatar"
                      />
                    ) : (
                      <User className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">
                      {user?.username || user?.firstName || user?.email || 'Profile'}
                    </span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-muted-foreground hover:text-destructive px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-left hover:bg-muted"
                    data-testid="button-mobile-logout"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => scrollToSection("home")}
                    className={publicMobileLinkClass}
                    data-testid="button-mobile-home"
                  >
                    Home
                  </button>
                  <Link
                    href="/gallery"
                    className={publicMobileLinkClass}
                    data-testid="button-mobile-gallery"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Work Photos
                  </Link>
                  <Link
                    href="/services"
                    className={publicMobileLinkClass}
                    data-testid="button-mobile-quotes-services"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Services
                  </Link>
                  <Link
                    href="/gift-cards"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-2.5 text-center text-sm font-black text-amber-100 transition-colors hover:bg-amber-300/20"
                    data-testid="button-mobile-public-gift-cards"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Gift className="h-4 w-4" /> Gift Cards
                  </Link>
                  <Link
                    href="/book?mode=quick&service=moving"
                    className={publicMobilePrimaryClass}
                    data-testid="button-mobile-public-book"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Book Now
                  </Link>
                  <div className="border-t border-border my-2" />
                  <Link 
                    href="/login" 
                    className="rounded-lg border border-emerald-400/30 bg-emerald-600/15 px-4 py-2.5 text-center text-sm font-black text-emerald-100 transition-colors hover:bg-emerald-600/25"
                    data-testid="button-mobile-employee-login"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    JC CREW HQ
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
