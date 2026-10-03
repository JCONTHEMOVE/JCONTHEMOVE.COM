import { copperCuffBonus } from "@shared/ashleyCopperPromotion";

export function CopperCuffOffer({ sku, available, compact = false }: { sku?: string | null; available: boolean; compact?: boolean }) {
  if (!available || !copperCuffBonus(sku)) return null;
  return <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-950">
    <p className="text-xs font-bold">Featured · +555 JCMOVES extra</p>
    <p className="mt-1 text-xs">{compact ? "With verified regular payment to your rewards account." : "On top of normal eligible rewards, after verified regular payment to an enrolled account. Crypto and shop-credit purchases excluded."}</p>
  </div>;
}
