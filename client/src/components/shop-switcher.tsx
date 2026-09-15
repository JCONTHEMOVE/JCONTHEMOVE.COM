import { Link, useLocation } from 'wouter';
import { Coins, Truck, Wallet, Gem } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function ShopSwitcher() {
  const [location] = useLocation();
  const { user } = useAuth();
  // /wallet belongs to CustomerApp; staff already have a guarded earnings route.
  const walletLink = user?.role === 'customer'
    ? { path: '/wallet', label: 'Wallet', Icon: Wallet }
    : ['employee', 'admin', 'business_owner'].includes(user?.role ?? '')
      ? { path: '/crew/earnings', label: 'Earnings', Icon: Wallet }
      : null;
  const links = [
    { path: '/services', label: 'Book services', Icon: Truck },
    { path: '/marketplace', label: 'Rewards shop', Icon: Coins },
    ...(walletLink ? [walletLink] : []),
    { path: '/handmade-jewels-by-ashley', label: 'Ashley’s Shop', Icon: Gem },
  ];

  return (
    <nav aria-label="Shop and rewards" className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4 py-3">
      {links.map(({ path, label, Icon }) => (
        <Link key={path} href={path} aria-current={location === path ? 'page' : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${location === path ? 'border-blue-400 bg-blue-500/15 text-blue-400' : 'border-border text-muted-foreground'}`}>
          <Icon aria-hidden className="h-4 w-4" />{label}
        </Link>
      ))}
    </nav>
  );
}
