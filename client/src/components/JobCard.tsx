import { ProjectIntakeSummary } from "./project-intake-summary";
import { customerNotesFromDetails } from "@shared/leadDetails";
import { useLocation } from "wouter";
import { Phone, Mail, MapPin, Calendar, ChevronRight, Trash2, Users, DollarSign, Zap, Copy, Hash, ExternalLink, Clock, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getStatusColors } from "@/lib/job-status";
import { extractCustomerMediaLink } from "@/lib/lead-details";
import { formatOrderNumber } from "@shared/schema";

export const SERVICE_LABELS: Record<string, string> = {
  residential: "Residential Move",
  commercial: "Commercial Move",
  junk: "Junk Removal",
  snow: "Snow Removal",
  cleaning: "Cleaning",
  handyman: "Handyman",
  demolition: "Demolition",
  flooring: "Flooring",
  painting: "Painting",
};

export const SERVICE_BADGE_COLORS: Record<string, string> = {
  residential: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  commercial: "bg-purple-500/15 text-purple-300 border border-purple-500/30",
  junk: "bg-orange-500/15 text-orange-300 border border-orange-500/30",
  snow: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30",
  default: "bg-slate-500/15 text-slate-300 border border-slate-500/30",
};

export function getServiceBadgeColor(serviceType: string): string {
  return SERVICE_BADGE_COLORS[serviceType] ?? SERVICE_BADGE_COLORS.default;
}

export interface JobCardProps {
  lead: {
    id: string | number;
    orderNumber?: string | number | null;
    firstName?: string | null;
    lastName?: string | null;
    serviceType?: string | null;
    status?: string | null;
    fromAddress?: string | null;
    toAddress?: string | null;
    moveDate?: string | null;
    confirmedDate?: string | null;
    phone?: string | null;
    email?: string | null;
    details?: string | null;
    crewSize?: number | null;
    confirmedHours?: number | null;
    truckProvider?: string | null;
    truckSize?: string | null;
    isQuoteOnly?: boolean | null;
    zoneSnapshot?: unknown;
    estimatedTotal?: string | null;
    totalPrice?: string | null;
    basePrice?: string | null;
    tokenAllocation?: string | null;
    redemptionId?: string | number | null;
    createdAt?: string | Date;
    archivedAt?: string | Date | null;
  };
  onDelete?: (lead: any) => void;
  showContact?: boolean;
  showTokens?: boolean;
  compact?: boolean;
}

const EARN_RATE = 15;

export function JobCard({ lead, onDelete, showContact = true, showTokens = true, compact = false }: JobCardProps) {
  const [, setLocation] = useLocation();
  const sc = getStatusColors(lead.status ?? "");
  const serviceLabel = SERVICE_LABELS[lead.serviceType ?? ""] ?? (lead.serviceType ?? "Service");
  const badgeColor = getServiceBadgeColor(lead.serviceType ?? "");
  const customerMediaLink = extractCustomerMediaLink(lead.details);

  const displayPrice = lead.totalPrice || lead.estimatedTotal || lead.basePrice;
  const earnTokens = displayPrice ? Math.round(parseFloat(displayPrice) * EARN_RATE) : null;
  const savedPreview = lead.zoneSnapshot && typeof lead.zoneSnapshot === "object"
    ? (lead.zoneSnapshot as { preview?: { matched?: boolean; quote?: { minEstimate?: number; maxEstimate?: number } } }).preview
    : undefined;
  const savedEstimate = savedPreview?.quote;
  const savedEstimateLabel = savedEstimate && Number.isFinite(Number(savedEstimate.minEstimate)) && Number.isFinite(Number(savedEstimate.maxEstimate))
    ? `${Math.round(Number(savedEstimate.minEstimate))}–${Math.round(Number(savedEstimate.maxEstimate))}`
    : null;
  const truckLabel = lead.truckProvider === "jc_on_the_move" ? "JC truck" : lead.truckProvider === "rental_uhaul" ? "Rental / U-Haul" : lead.truckProvider === "customer" ? "Customer truck" : lead.truckProvider === "none" ? "No truck" : null;

  return (
    <Card
      className={`border-l-4 ${sc.border} border-t border-r border-b border-slate-700/60 hover:border-slate-600 hover:shadow-xl transition-all bg-slate-800/80 backdrop-blur-sm cursor-pointer group`}
      data-testid={`job-card-${lead.id}`}
      onClick={() => setLocation(`/lead/${lead.id}`)}
    >
      <CardContent className={compact ? "p-3" : "p-4"}>
        {/* Header row */}
        <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-block w-3 h-3 rounded-full ${sc.dot} shadow-md animate-pulse shrink-0`}
              title={sc.label}
            />
            <h3 className={`font-bold ${compact ? "text-sm" : "text-base"} text-white group-hover:text-blue-300 transition-colors`}>
              {lead.firstName} {lead.lastName}
            </h3>
            {lead.orderNumber && (
              <span className="text-xs font-mono text-slate-400 bg-slate-700/60 border border-slate-600/50 rounded px-1.5 py-0.5 select-all">
                {lead.orderNumber}
              </span>
            )}
            <Badge className={badgeColor}>{serviceLabel}</Badge>
            <Badge className={sc.badgeBg}>{sc.label}</Badge>
            {lead.redemptionId && (
              <Badge className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs">🎁 Rewards</Badge>
            )}
            {lead.archivedAt && (
              <Badge className="bg-slate-600/30 text-slate-400 border border-slate-600/40 text-xs">Archived</Badge>
            )}
          </div>

          <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              onClick={() => setLocation(`/lead/${lead.id}`)}
              className="gap-1 h-7 text-xs"
              data-testid={`open-job-${lead.id}`}
            >
              <ChevronRight className="h-3.5 w-3.5" /> Open
            </Button>
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(lead)}
                className="hover:text-red-400 h-7"
                data-testid={`delete-job-${lead.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Contact buttons */}
        {showContact && (lead.phone || lead.email) && (
          <div className="flex flex-wrap gap-1.5 mb-3" onClick={(e) => e.stopPropagation()}>
            {lead.phone && (
              <Button variant="outline" size="sm" asChild
                className="h-7 text-xs border-slate-600 text-slate-300 hover:text-white hover:border-slate-500">
                <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />{lead.phone}
                </a>
              </Button>
            )}
            {lead.email && (
              <Button variant="outline" size="sm" asChild
                className="h-7 text-xs border-slate-600 text-slate-300 hover:text-white hover:border-slate-500">
                <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />{lead.email}
                </a>
              </Button>
            )}
          </div>
        )}

        {/* Address + Date + Crew */}
        <div className="space-y-1 text-xs text-slate-400">
          {lead.fromAddress && (
            <div className="flex items-start gap-1.5">
              <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-500" />
              <span className="text-slate-300">
                <span className="text-slate-500">From:</span> {lead.fromAddress}
                {lead.toAddress && <> &rarr; {lead.toAddress}</>}
              </span>
            </div>
          )}
          {(lead.confirmedDate || lead.moveDate) && (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="text-slate-300">
                <span className="text-slate-500">Date:</span> {lead.confirmedDate || lead.moveDate}
              </span>
            </div>
          )}
          {lead.crewSize && (
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="text-slate-300">
                <span className="text-slate-500">Crew:</span> {lead.crewSize} mover{lead.crewSize !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {lead.confirmedHours && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="text-slate-300"><span className="text-slate-500">Expected:</span> {lead.confirmedHours} hour{lead.confirmedHours === 1 ? "" : "s"}</span>
            </div>
          )}
          {truckLabel && (
            <div className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="text-slate-300"><span className="text-slate-500">Truck:</span> {truckLabel}{lead.truckSize && lead.truckSize !== "none" ? ` · ${lead.truckSize.replace("_", " ")}` : ""}</span>
            </div>
          )}
          {!displayPrice && savedEstimateLabel && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className={lead.isQuoteOnly || !savedPreview?.matched ? "text-amber-300 font-semibold" : "text-emerald-400 font-semibold"}>
                {lead.isQuoteOnly || !savedPreview?.matched ? "Estimate review" : "Zone estimate"}: ${savedEstimateLabel}
              </span>
            </div>
          )}
          {displayPrice && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="text-emerald-400 font-semibold">
                ${parseFloat(displayPrice).toFixed(2)}
              </span>
              {showTokens && earnTokens && earnTokens > 0 && (
                <span className="text-orange-400/80 text-[10px] ml-1 flex items-center gap-0.5">
                  <Zap className="h-2.5 w-2.5" /> crew ~{earnTokens.toLocaleString()} JCMOVES
                </span>
              )}
            </div>
          )}
        </div>

        <ProjectIntakeSummary details={lead.details} />
        {/* Details snippet */}
        {!compact && lead.details && (
          <div className="mt-3 bg-slate-700/40 px-3 py-2 rounded-lg">
            {customerMediaLink && (
              <a
                href={customerMediaLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] font-bold text-blue-300 hover:bg-blue-500/20"
              >
                <ExternalLink className="h-3 w-3" />
                Open customer media
              </a>
            )}
            <p className="text-xs text-slate-300 line-clamp-2">{customerNotesFromDetails(lead.details)}</p>
          </div>
        )}

        {/* Timestamp */}
        {lead.createdAt && (
          <p className="text-xs text-slate-600 border-t border-slate-700/50 pt-2 mt-3">
            {new Date(lead.createdAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
