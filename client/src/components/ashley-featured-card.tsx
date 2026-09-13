import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Gem, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// The featured endpoint returns the catalog's database field names.
type FeaturedPiece={id:string;title:string;price:string;image_url?:string;in_stock:boolean;status:string};
export function AshleyFeaturedCard(){
  const featured=useQuery<FeaturedPiece|null>({queryKey:['/api/ashley-shop/featured'],staleTime:60000});
  const item=featured.data?.status==='active'&&featured.data.in_stock?featured.data:null;
  return <aside aria-label="Ashley's Shop" className="min-w-0 rounded-2xl border border-rose-400/30 bg-rose-500/5 p-4">
    <h2 className="flex items-center gap-2 text-base font-bold"><Gem aria-hidden className="h-5 w-5 text-rose-400"/>Ashley’s Shop</h2>
    {item?<Link href={`/handmade-jewels-by-ashley/${encodeURIComponent(item.id)}`} className="mt-3 flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2">
      {item.image_url&&<img loading="lazy" src={item.image_url} alt={item.title} className="h-20 w-20 shrink-0 rounded-xl object-cover"/>}
      <span className="min-w-0"><span className="block text-xs text-muted-foreground">Featured piece</span><span className="block break-words text-sm font-semibold">{item.title}</span><span className="block text-sm">{Number(item.price)>0?`$${Number(item.price).toFixed(2)}`:'View price'}</span></span>
    </Link>:<p className="my-3 text-sm text-muted-foreground">Handmade jewels by Ashley</p>}
    <Button asChild variant="outline" className="mt-3 min-h-11 w-full"><Link href="/handmade-jewels-by-ashley">Open full shop<ArrowUpRight aria-hidden className="h-4 w-4"/></Link></Button>
  </aside>;
}
