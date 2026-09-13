import { Link, useLocation } from 'wouter';
import { Coins, Truck, Wallet, Gem } from 'lucide-react';
export function ShopSwitcher(){
  const [location]=useLocation();
  return <nav aria-label="Shop and rewards" className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4 py-3">
    {[{path:'/services',label:'Book services',Icon:Truck},{path:'/marketplace',label:'Rewards shop',Icon:Coins},{path:'/wallet',label:'Wallet',Icon:Wallet},{path:'/handmade-jewels-by-ashley',label:'Ashley’s Shop',Icon:Gem}].map(({path,label,Icon})=><Link key={path} href={path} aria-current={location===path?'page':undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${location===path?'border-blue-400 bg-blue-500/15 text-blue-400':'border-border text-muted-foreground'}`}><Icon aria-hidden className="h-4 w-4"/>{label}</Link>)}
  </nav>;
}
