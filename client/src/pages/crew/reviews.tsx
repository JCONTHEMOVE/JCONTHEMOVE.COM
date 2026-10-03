import { RewardsLink } from "@/components/task-ui";
import { useMemo, useState } from "react";
import { CrewReviewCelebration } from '@/components/CrewReviewCelebration';
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/star-rating";
import {
  Award,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Loader2,
  MessageSquare,
  Star,
} from "lucide-react";

type Review = {
  id: string;
  leadId: string;
  userId: string;
  employeeId: string;
  rating: number;
  comment: string | null;
  serviceQuality?: number | null;
  communication?: number | null;
  timeliness?: number | null;
  professionalism?: number | null;
  wouldRecommend?: boolean | null;
  rewardedAt: string | null;
  moverNames?: string | null;
  tipAmount?: string | null;
  createdAt: string;
};

type ReviewStats = {
  averageRating: number;
  totalReviews: number;
  ratings?: Record<string, number>;
  ratingDistribution?: Record<string, number>;
};

type SortMode = "newest" | "lowest" | "highest";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function compactLeadId(id: string) {
  return id ? `Job ${id.slice(0, 8).toUpperCase()}` : "Job";
}

function ReviewCard({ review }: { review: Review }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const comment = review.comment?.trim() || "No written feedback provided.";
  const shouldClamp = comment.length > 170;
  const visibleComment = expanded || !shouldClamp ? comment : `${comment.slice(0, 170).trim()}...`;

  async function copyReplyTemplate() {
    const reply = review.rating >= 4
      ? "Thank you for the review. We appreciate you trusting JC ON THE MOVE and we are glad the crew took care of you."
      : "Thank you for the feedback. We appreciate the chance to improve and will review this job with the crew.";
    await navigator.clipboard.writeText(reply);
    toast({ title: "Reply copied", description: "Paste it into your customer follow-up." });
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-slate-700 bg-slate-900/80">
      <div className="flex items-center justify-between bg-blue-700 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-base font-black text-white">Customer Review</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-100/80">{compactLeadId(review.leadId)}</p>
        </div>
        <p className="text-sm font-bold text-white">{formatDate(review.createdAt)}</p>
      </div>

      <div className="border-b border-slate-700 bg-slate-800/70 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200">Overall Rating</span>
            <StarRating rating={review.rating} readonly size="sm" />
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </div>

      <div className="space-y-3 bg-white px-4 py-3 text-slate-900">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-700">Customer Comments</p>
          <p className="mt-1 text-sm leading-6 text-slate-800">{visibleComment}</p>
          {shouldClamp && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 text-sm font-semibold text-blue-700 hover:text-blue-900"
            >
              {expanded ? "Show less" : "Show more..."}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {review.wouldRecommend === true && (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Would recommend
            </Badge>
          )}
          {review.rewardedAt && (
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
              <Award className="mr-1 h-3 w-3" />
              Bonus earned
            </Badge>
          )}
          {Number(review.tipAmount || 0) > 0 && (
            <Badge className="border-blue-200 bg-blue-50 text-blue-700">
              Tip ${Number(review.tipAmount).toFixed(2)}
            </Badge>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={copyReplyTemplate}
          className="mx-auto flex h-8 text-blue-700 hover:bg-blue-50 hover:text-blue-900"
        >
          <Clipboard className="mr-2 h-4 w-4" />
          Copy reply to this review
        </Button>
      </div>
    </div>
  );
}

export default function CrewReviewsPage() {
  const { user } = useAuth();
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const celebrationId=new URLSearchParams(window.location.search).get('review');

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery<Review[]>({
    queryKey: [`/api/reviews?employeeId=${user?.id || ""}&limit=100`],
    enabled: !!user?.id,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ReviewStats>({
    queryKey: [`/api/reviews/employee/${user?.id || ""}/stats`],
    enabled: !!user?.id,
  });

  const sortedReviews = useMemo(() => {
    const copy = [...reviews];
    if (sortMode === "lowest") return copy.sort((a, b) => a.rating - b.rating || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (sortMode === "highest") return copy.sort((a, b) => b.rating - a.rating || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [reviews, sortMode]);

  const lastTenAverage = useMemo(() => {
    const lastTen = [...reviews]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
    if (lastTen.length === 0) return 0;
    return lastTen.reduce((sum, review) => sum + review.rating, 0) / lastTen.length;
  }, [reviews]);

  const distribution = stats?.ratingDistribution || stats?.ratings || {};
  const loading = reviewsLoading || statsLoading;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8 pt-6">
      <div className="mb-5">
        <h1 className="text-2xl font-black text-white">Reviews</h1>
        <p className="text-sm text-slate-400">Customer feedback for your completed jobs</p>
      </div>

      {celebrationId&&<CrewReviewCelebration reviewId={celebrationId}/>}
      <div className="mb-5"><RewardsLink/></div>
      {loading ? (
        <div className="grid min-h-[280px] place-items-center rounded-[8px] border border-slate-800 bg-slate-900/70 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="rounded-[8px] border border-slate-800 bg-slate-900/70 p-8 text-center">
          <MessageSquare className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="font-semibold text-white">No reviews yet</p>
          <p className="mt-1 text-sm text-slate-500">Completed jobs with customer feedback will appear here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-[8px] border border-slate-800 bg-slate-900/80 p-4 text-center">
            <p className="text-sm text-slate-300">Average of your last 10 reviews:</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <StarRating rating={Math.round(lastTenAverage)} readonly size="md" />
              <span className="text-xl font-black text-white">{lastTenAverage.toFixed(1)}</span>
            </div>
            <p className="mt-2 text-xs text-blue-300">Keep communication fast, arrive prepared, and ask every happy customer for a review.</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[5, 4, 3].map((rating) => (
              <div key={rating} className="rounded-[8px] border border-slate-800 bg-slate-900/70 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-amber-300">
                  <Star className="h-3.5 w-3.5 fill-amber-300" />
                  <span className="text-sm font-bold">{rating}</span>
                </div>
                <p className="mt-1 text-lg font-black text-white">{distribution[String(rating)] || 0}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto rounded-[8px] border border-slate-800 bg-slate-900/70 p-2">
            <span className="px-2 text-sm text-slate-400">Sort</span>
            {[
              ["newest", "Newest"],
              ["lowest", "Lowest Rating"],
              ["highest", "Highest Rating"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSortMode(value as SortMode)}
                className={`whitespace-nowrap rounded-[6px] px-3 py-2 text-sm font-semibold ${
                  sortMode === value ? "bg-blue-600 text-white" : "text-blue-300 hover:bg-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {sortedReviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
