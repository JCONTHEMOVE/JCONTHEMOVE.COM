import { useState } from 'react';
import { Gem } from 'lucide-react';

export function CatalogImage({src,alt,className}:{src?:string;alt:string;className?:string}) {
  const [failedSource,setFailedSource]=useState<string|null>(null);
  if (!src || failedSource===src) return <div role="img" aria-label={alt+' — photo unavailable'} className={'flex flex-col items-center justify-center gap-1 rounded-lg bg-rose-50 text-rose-700 '+(className||'')}><Gem aria-hidden className="h-7 w-7 shrink-0"/><span className="px-1 text-center text-[10px] leading-tight">Photo unavailable</span></div>;
  return <img src={src} alt={alt} loading="lazy" className={className} onError={()=>setFailedSource(src)}/>;
}
