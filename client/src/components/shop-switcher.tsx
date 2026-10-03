import { Link, useLocation } from 'wouter';
import { Coins, Truck, Wallet, Gem } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const CREW_ROLES = ['employee', 'admin', 'business_owner'];

// Browser location is the pathname. Static renders and older callers can still
// pass a path that includes the search string, so honor both forms.
function isCurrentDestination(location: string, path: string) {
  return location === path || location.startsWith(`${path}?`);
}

export function ShopSwitcher() {
  const [location] = useLocation();
  const { user } = useAuth();
  const crewExperience = CREW_ROLES.includes(user?.role ?? '');
  // /wallet belongs to CustomerApp; staff already have a guarded earnings route.
  const walletLink = user?.role === 'customer'
    ? { path: '/wallet', label: 'Wallet', Icon: Wallet }
    : crewExperience
      ? { path: '/crew/earnings', label: 'Earnings', Icon: Wallet }
      : null;
  const links = [
    { path: '/services', label: 'Book services', Icon: Truck },
    { path: crewExperience ? '/crew/rewards' : '/marketplace', label: 'Rewards shop', Icon: Coins },
    ...(walletLink ? [walletLink] : []),
    { path: '/handmade-jewels-by-ashley', label: 'Ashley’s Shop', Icon: Gem },
  ];

  return (
    <nav aria-label="Shop and rewards" className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4 py-3">
      {links.map(({ path, label, Icon }) => {
        const current = isCurrentDestination(location, path);
        return (
          <Link key={path} href={path} aria-current={current ? 'page' : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${current ? 'border-blue-400 bg-blue-500/15 text-blue-400' : 'border-border text-muted-foreground'}`}>
            <Icon aria-hidden className="h-4 w-4" />{label}
          </Link>
        );
      })}
    </nav>
  );
}
