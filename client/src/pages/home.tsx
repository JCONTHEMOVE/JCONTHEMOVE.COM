import { AshleyFeaturedCard } from "@/components/ashley-featured-card";
import { TaskDetails } from "@/components/task-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { SiGoogle } from "react-icons/si";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import {
  ArrowRight,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Gift,
  MapPin,
  MessageCircle,
  Phone,
  PhoneCall,
  Shield,
  Sparkles,
  Star,
  Trash2,
  Truck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ChatIntakeOverlay from "@/components/ChatIntakeOverlay";
import {
  IRONWOOD_DAILY_DISCOUNT,
  ROUTE_DAY_DISCOUNT,
  ROUTE_DAY_SCHEDULE,
  ROUTE_DAY_SERVICE_TAGS,
  SERVICE_ADDRESS_DISCOUNT_NOTE,
  routeDayLandingHref,
} from "@shared/routeDays";
import brandedTruckImage from "@assets/google_movers/branded-truck.jpg";
import crewRampImage from "@assets/google_movers/crew-ramp.jpg";
import dollyBoxesImage from "@assets/google_movers/dolly-boxes.jpg";
import loadedTrailerImage from "@assets/google_movers/loaded-trailer.jpg";
import packedTruckImage from "@assets/google_movers/packed-truck.jpg";
import shirtBackImage from "@assets/google_movers/shirt-back.jpg";
import trailerRampImage from "@assets/google_movers/trailer-ramp.jpg";
import truckTrailerYardImage from "@assets/google_movers/truck-trailer-yard.jpg";
import wrappedItemImage from "@assets/google_movers/wrapped-item.jpg";

interface Testimonial {
  id: string;
  reviewerName: string;
  rating: number;
  content: string;
  serviceType: string | null;
  sourcePlatform: string | null;
  featured: boolean;
}

const FALLBACK_TESTIMONIALS: Testimonial[] = [
  { id: "g1", reviewerName: "Susan Connor", rating: 5, content: "Needed big, heavy items moved through narrow doors. The crew handled it and was friendly.", serviceType: "Heavy item move", sourcePlatform: "Google", featured: true },
  { id: "g2", reviewerName: "Nathan Appel", rating: 5, content: "Right on time, professional, and careful with an 800-pound safe and a large armoire.", serviceType: "Safe moving", sourcePlatform: "Google", featured: true },
  { id: "g3", reviewerName: "Keith Ferrell", rating: 5, content: "Helped unload a 26-foot U-Haul in the rain and put everything where it needed to go.", serviceType: "Unload help", sourcePlatform: "Google", featured: true },
  { id: "g4", reviewerName: "Jessica Beckman", rating: 5, content: "Efficient, quick, and highly recommended for moving help.", serviceType: "Moving help", sourcePlatform: "Google", featured: true },
  { id: "g5", reviewerName: "Drea Dree", rating: 5, content: "Fast, efficient, affordable, and made a stressful move much easier.", serviceType: "Move + junk help", sourcePlatform: "5-star web review", featured: true },
];

const HERO_IMAGE = brandedTruckImage;
const CTA_IMAGE = truckTrailerYardImage;
const MOVERS_ALBUM_URL = "https://photos.app.goo.gl/taQBHTwyP1z7DjXQA";

const VISUAL_SERVICES = [
  {
    label: "Moving",
    sub: "Homes, apartments, offices",
    href: "/book?mode=quick&service=moving",
    image: packedTruckImage,
    icon: Truck,
    color: "blue",
  },
  {
    label: "Junk Removal",
    sub: "Cleanouts, hauling, disposal",
    href: "/book?mode=quick&service=junk_removal",
    image: loadedTrailerImage,
    icon: Trash2,
    color: "orange",
  },
  {
    label: "Delivery",
    sub: "Furniture, appliances, store pickups",
    href: "/book?mode=quick&service=delivery",
    image: dollyBoxesImage,
    icon: Truck,
    color: "emerald",
  },
  {
    label: "Cleanup / Labor",
    sub: "Move-outs, garages, extra hands",
    href: "/book?mode=quick&service=cleaning",
    image: trailerRampImage,
    icon: Sparkles,
    color: "violet",
  },
];

const MORE_SERVICES = [
  { label: "Just Ask", href: "/book?mode=quick&service=custom" },
  { label: "Handyman", href: "/book?mode=quick&service=handyman" },
  { label: "Window Cleaning", href: "/book?mode=quick&service=window_cleaning" },
  { label: "Snow", href: "/book?mode=quick&service=snow_removal" },
  { label: "Lawn", href: "/book/lawn-care" },
  { label: "Demolition", href: "/book?mode=quick&service=demolition" },
  { label: "Roofing", href: "/book?mode=quick&service=roofing" },
  { label: "Painting", href: "/book?mode=quick&service=painting" },
];

const STORY_SLIDES = [
  {
    eyebrow: "Moving",
    title: "Protected, loaded, and handled right.",
    text: "Furniture wrap, steady crews, and local routes planned before we arrive.",
    image: wrappedItemImage,
    stat: "Local & long-distance",
  },
  {
    eyebrow: "Junk Removal",
    title: "Cleanouts without the drag.",
    text: "Trailers, muscle, and disposal help for garages, rentals, sheds, and post-move piles.",
    image: loadedTrailerImage,
    stat: "Fast haul-away",
  },
  {
    eyebrow: "Northwoods Crew",
    title: "Real people. Real work. Real proof.",
    text: "A local team customers can text, call, and recognize around town.",
    image: crewRampImage,
    stat: "5-star rated",
  },
  {
    eyebrow: "Rewards",
    title: "Book the job. Earn JCMOVES.",
    text: "Every completed service can earn rewards toward future moves and add-ons.",
    image: shirtBackImage,
    stat: "Rewards included",
  },
];

const TRUST_ITEMS = [
  { icon: Shield, label: "Licensed & insured" },
  { icon: Star, label: "5-star rated" },
  { icon: Zap, label: "Fast response" },
  { icon: MapPin, label: "Local crew" },
];

const COLOR_CLASSES: Record<string, { border: string; bg: string; text: string }> = {
  blue: { border: "border-blue-500/70", bg: "bg-blue-600", text: "text-blue-300" },
  orange: { border: "border-orange-500/70", bg: "bg-orange-500", text: "text-orange-300" },
  emerald: { border: "border-emerald-500/70", bg: "bg-emerald-600", text: "text-emerald-300" },
  violet: { border: "border-violet-500/70", bg: "bg-violet-600", text: "text-violet-300" },
};

function startOfDayMessage() {
  const hour = new Date().getHours();
  if (hour < 12) return "Morning move slots open";
  if (hour < 17) return "Same-day quotes open";
  return "Tomorrow's schedule open";
}

function VisualStoryCarousel({ onQuote }: { onQuote: () => void }) {
  const autoplay = useRef(Autoplay({ delay: 5200, stopOnInteraction: false }));
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "start" }, [autoplay.current]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  return (
    <section id="jobs" className="border-y border-white/10 bg-slate-950/70 px-4 py-10 md:py-12">
      <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-[0.82fr_1.18fr] md:items-center">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.25em] text-blue-300">Real Northwoods Jobs</p>
          <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight md:text-4xl">
            The work tells the story.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-300">
            A quick look at the jobs, crew, and care behind JC ON THE MOVE.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wider text-slate-300">
            <span className="rounded-full border border-white/15 px-3 py-1">Moving</span>
            <span className="rounded-full border border-white/15 px-3 py-1">Junk</span>
            <span className="rounded-full border border-white/15 px-3 py-1">Local Crew</span>
            <a href={MOVERS_ALBUM_URL} target="_blank" rel="noreferrer" className="rounded-full border border-blue-400/40 bg-blue-500/10 px-3 py-1 text-blue-200 hover:bg-blue-500/20">
              Movers Album
            </a>
          </div>
          <Button onClick={onQuote} className="mt-6 h-11 rounded-lg bg-blue-600 px-6 font-black hover:bg-blue-500">
            Get My Price <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <div className="relative min-w-0">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl" ref={emblaRef}>
            <div className="flex">
              {STORY_SLIDES.map((slide) => (
                <div key={slide.title} className="min-w-0 flex-[0_0_100%]">
                  <div className="relative aspect-[4/5] overflow-hidden sm:aspect-[16/9]">
                    <img src={slide.image} alt="" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
                    <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4">
                      <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-black uppercase tracking-widest">
                        {slide.eyebrow}
                      </span>
                      <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-widest text-slate-200">
                        {slide.stat}
                      </span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
                      <h3 className="max-w-lg text-2xl font-black leading-tight md:text-4xl">{slide.title}</h3>
                      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-200 md:text-base">{slide.text}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="absolute inset-y-0 left-3 hidden items-center md:flex">
            <button
              type="button"
              onClick={scrollPrev}
              aria-label="Previous job story"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur hover:bg-black/75"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          </div>
          <div className="absolute inset-y-0 right-3 hidden items-center md:flex">
            <button
              type="button"
              onClick={scrollNext}
              aria-label="Next job story"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur hover:bg-black/75"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 flex justify-center gap-3 md:hidden">
            <button
              type="button"
              onClick={scrollPrev}
              aria-label="Previous job story"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={scrollNext}
              aria-label="Next job story"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const [, setLocation] = useLocation();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeedChip, setChatSeedChip] = useState<string | undefined>(undefined);
  const [showMoreServices, setShowMoreServices] = useState(false);
  const [availabilityLine, setAvailabilityLine] = useState(startOfDayMessage());

  const { data: liveTestimonials } = useQuery<Testimonial[]>({
    queryKey: ["/api/testimonials?status=published&featured=true&limit=5"],
    staleTime: 5 * 60 * 1000,
  });

  const displayTestimonials = liveTestimonials && liveTestimonials.length >= 5
    ? liveTestimonials.slice(0, 5)
    : FALLBACK_TESTIMONIALS;

  useEffect(() => {
    const id = window.setInterval(() => setAvailabilityLine(startOfDayMessage()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  function openChat(chip?: string) {
    setChatSeedChip(chip);
    setChatOpen(true);
  }

  function openQuoteStart(service = "moving") {
    setLocation(`/book?mode=choose&service=${encodeURIComponent(service)}`);
  }

  return (
    <div className="min-h-screen bg-[#020915] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#020915]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link
            href="/login"
            aria-label="Open JC ON THE MOVE login"
            title="Team and customer login"
            className="group flex min-w-0 items-center gap-3 rounded-lg text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020915]"
          >
            <span
              aria-hidden="true"
              className="relative hidden h-9 w-9 shrink-0 rounded-full border border-white/45 bg-white/10 shadow-[0_0_22px_rgba(255,255,255,0.12)] transition group-hover:bg-white/18 sm:block"
            >
              <span className="absolute left-1/2 top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
              <span className="absolute left-1/2 top-1/2 h-1 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-black leading-none tracking-tight transition group-hover:text-blue-100 sm:text-xl">JC ON THE MOVE</span>
              <span className="mt-1 block truncate text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 transition group-hover:text-slate-200 sm:text-[10px] sm:tracking-[0.28em]">Northwoods moving & more</span>
            </span>
          </Link>
          <div className="hidden items-center gap-8 text-sm font-semibold text-slate-200 xl:flex">
            <a href="#services" className="hover:text-white">Services</a>
            <Link href="/gift-cards" className="text-amber-200 hover:text-amber-100">Gift Cards</Link>
            <a href="#jobs" className="hover:text-white">Jobs</a>
            <Link href="/gallery" className="hover:text-white">Gallery</Link>
            <a href="#reviews" className="hover:text-white">Reviews</a>
            <a href="#rewards" className="hover:text-white">Rewards</a>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <a href="tel:+19062859312" className="hidden items-center gap-2 text-sm font-bold text-white sm:flex">
              <Phone className="h-4 w-4 text-blue-300" />
              (906) 285-9312
            </a>
            <Link href="/login">
              <Button variant="outline" className="h-10 rounded-lg border-white/20 bg-white/5 px-3 text-sm font-black text-white hover:bg-white/10 hover:text-white sm:px-4">
                <span className="sm:hidden">Login</span>
                <span className="hidden sm:inline">Login</span>
              </Button>
            </Link>
            <Button onClick={() => openQuoteStart("moving")} className="h-10 rounded-lg bg-blue-600 px-3 text-sm font-black hover:bg-blue-500 sm:px-5">
              <span className="sm:hidden">Price</span>
              <span className="hidden sm:inline">Get My Price</span>
            </Button>
          </div>
        </div>
      </nav>

      <section
        className="relative isolate min-h-[320px] overflow-hidden border-b border-white/10 bg-cover bg-center md:min-h-[400px]"
        style={{ backgroundImage: `url(${HERO_IMAGE})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-[#020915] via-[#020915]/78 to-[#020915]/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020915] via-transparent to-black/30" />

        <div className="relative z-10 mx-auto grid max-w-6xl items-start gap-5 px-4 py-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] md:py-10">
          <div className="max-w-3xl">
            <p className="mb-4 text-xs font-black uppercase tracking-[0.24em] text-blue-300">Local movers. Northwoods strong.</p>
            <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">
              Moving &amp; local services
            </h1>
            <p className="mt-5 flex flex-wrap gap-x-3 gap-y-1 text-base font-bold text-white">
              <span>Moving</span>
              <span className="text-blue-300">Junk removal</span>
              <span>Delivery</span>
              <span className="text-emerald-300">Cleanup help</span>
              <button type="button" onClick={() => setLocation("/book?mode=quick&service=custom")} className="text-amber-200 underline decoration-amber-300/40 underline-offset-4 hover:text-amber-100">
                Just ask
              </button>
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button onClick={() => setLocation("/book?mode=quick&service=moving")} className="h-12 rounded-lg bg-blue-600 px-8 text-base font-black hover:bg-blue-500">
                Request A Callback <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button onClick={() => openQuoteStart("moving")} variant="outline" className="h-12 rounded-lg border-white/40 bg-black/30 px-8 text-base font-black text-white hover:bg-white/10">
                Build My Quote
              </Button>
              <a href="sms:+19062859312">
                <Button variant="outline" className="h-12 rounded-lg border-white/40 bg-black/30 px-8 text-base font-black text-white hover:bg-white/10">
                  <MessageCircle className="mr-2 h-5 w-5" />
                  Text Us Now
                </Button>
              </a>
            </div>
          </div>

          <AshleyFeaturedCard/><p className="text-sm text-slate-200 lg:col-span-2">{availabilityLine} · Serving Ironwood and the Northwoods.</p>
        </div>
      </section>

      <section className="border-b border-white/10 bg-slate-950/80">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-3 gap-y-4 px-4 py-5 md:grid-cols-4">
          {TRUST_ITEMS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center justify-start gap-2 text-[11px] font-black uppercase tracking-tight text-slate-200 sm:justify-center sm:gap-3 sm:text-sm sm:tracking-wide">
              <Icon className="h-6 w-6 shrink-0 text-blue-300 sm:h-7 sm:w-7" />
              <span className="min-w-0 leading-tight">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="route-days" className="border-b border-white/10 bg-slate-950 px-4 py-10 md:py-12"><TaskDetails title="Service areas and route days">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">Preferred Route Days</p>
              <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight md:text-4xl">
                Stack local jobs by town. Save drive time. Serve more customers.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                We are building customer bases around target towns on certain days so moving, junk removal, handyman work, light demo, flooring, painting, roofing, and more can be grouped into smarter routes.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wider text-slate-200">
                {ROUTE_DAY_SERVICE_TAGS.map((tag) => (
                  <span key={tag} className="rounded-full border border-white/15 bg-white/5 px-3 py-1">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm leading-relaxed text-emerald-50">
                <p className="font-black">5% route-day savings</p>
                <p className="mt-1 text-emerald-100/90">
                  {ROUTE_DAY_DISCOUNT} {IRONWOOD_DAILY_DISCOUNT} {SERVICE_ADDRESS_DISCOUNT_NOTE}
                </p>
                <p className="mt-3 font-black">Flexible availability</p>
                <p className="mt-1 text-emerald-100/90">
                  If no jobs are requested for a route day, we can accept other jobs. Customers outside these towns can still request a quote and we will confirm availability with 2 crews and up to 6 movers.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROUTE_DAY_SCHEDULE.map((route) => (
                <button
                  key={route.key}
                  type="button"
                  onClick={() => setLocation(routeDayLandingHref(route))}
                  className="group rounded-lg border border-white/12 bg-white/[0.04] p-4 text-left transition hover:border-blue-400/60 hover:bg-blue-500/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">{route.day}</p>
                      <h3 className="mt-1 text-xl font-black text-white">{route.city}</h3>
                      <p className="mt-1 text-sm font-semibold text-slate-300">{route.state}</p>
                    </div>
                    <MapPin className="h-5 w-5 text-emerald-300 transition group-hover:scale-110" />
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-slate-300">{route.note}</p>
                  <p className="mt-3 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-200">
                    Save 5% when the service address is in {route.city} and the job is booked for {route.day}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-black text-blue-200">
                    View {route.label} <ArrowRight className="h-4 w-4" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </TaskDetails></section>

      <section id="services" className="px-4 py-10 md:py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-7 flex items-center justify-center gap-5">
            <span className="h-px w-16 bg-white/20" />
            <p className="text-sm font-black uppercase tracking-[0.25em]">Choose Service</p>
            <span className="h-px w-16 bg-white/20" />
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            {VISUAL_SERVICES.map((service) => {
              const color = COLOR_CLASSES[service.color];
              const Icon = service.icon;
              return (
                <button
                  key={service.label}
                  onClick={() => setLocation(service.href)}
                  className={`group relative min-h-[180px] overflow-hidden rounded-lg border ${color.border} bg-slate-900 text-left shadow-xl transition-transform hover:-translate-y-1 md:min-h-[200px]`}
                >
                  <img src={service.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70 transition-transform duration-500 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl ${color.bg} shadow-lg`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <p className="text-xl font-black uppercase">{service.label}</p>
                    <p className="mt-1 text-sm font-medium text-slate-200">{service.sub}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-5 text-center">
            <button
              onClick={() => setShowMoreServices((prev) => !prev)}
              className="rounded-lg border border-white/25 px-10 py-2 text-sm font-black uppercase tracking-widest text-slate-200 hover:bg-white/10"
            >
              {showMoreServices ? "Hide Services" : "+ More Services"}
            </button>
          </div>
          {showMoreServices && (
            <div className="mx-auto mt-5 grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3">
              {MORE_SERVICES.map((service) => (
                <button
                  key={service.label}
                  onClick={() => setLocation(service.href)}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-200 hover:border-blue-400/60 hover:bg-blue-500/10"
                >
                  {service.label}
                </button>
              ))}
            </div>
          )}
          <div className="mx-auto mt-8 grid max-w-5xl gap-4 rounded-xl border border-white/15 bg-white/[0.05] p-5 md:grid-cols-[1fr_auto] md:items-center md:p-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">Need something else?</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Just ask. If it needs moved, hauled, delivered, cleaned, or handled, we can quote it.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                Send a quick request with notes, photos, videos, or an album link. A coordinator will confirm what is possible, what crew is needed, and the next open time.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row md:flex-col">
              <Button onClick={() => setLocation("/book?mode=quick&service=custom")} className="h-11 rounded-lg bg-emerald-600 px-5 font-black hover:bg-emerald-500">
                Just Ask
              </Button>
              <a href="sms:+19062859312">
                <Button variant="outline" className="h-11 w-full rounded-lg border-white/25 bg-white/5 px-5 font-black text-white hover:bg-white/10">
                  Text Us
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-amber-300/15 bg-gradient-to-br from-amber-300/10 via-slate-950 to-blue-500/10 px-4 py-10 md:py-14">
        <div className="mx-auto grid max-w-6xl gap-7 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/75 p-5 shadow-2xl md:grid-cols-[0.9fr_1.1fr] md:items-center md:p-8">
          <img
            src="/gift-cards/jc-helping-hand-egift.png"
            alt="JC ON THE MOVE Give the Gift of a Helping Hand eGift card"
            className="aspect-[8/5] w-full rounded-xl border border-white/10 object-cover"
            width={640}
            height={400}
          />
          <div>
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-amber-200">
              <Gift className="h-4 w-4" /> Bless someone with service
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Give the gift of a helping hand.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">
              Send prepaid help for moving, junk removal, seasonal lawn care, snow removal, or another eligible JC ON THE MOVE service.
            </p>
            <p className="mt-2 text-sm font-bold text-amber-200">Available from $50 to the $5,000 Gold Helping Hand concierge card.</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/gift-cards"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-amber-400 px-6 text-sm font-black text-slate-950 transition-colors hover:bg-amber-300"
                data-testid="home-gift-cards-link"
              >
                Send a Gift Card <ArrowRight className="h-4 w-4" />
              </Link>
              <span className="text-xs text-slate-400">Personalized email delivery through Square</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white px-4 py-10 text-slate-950 md:py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-7">
            <p className="text-sm font-black uppercase tracking-[0.24em] text-blue-700">How It Works</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">Choose the work. Show the job. Get confirmed.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            {[
              { title: "Choose", text: "Pick moving, junk removal, delivery, cleanup, or labor help.", icon: Truck },
              { title: "Request", text: "Use quick callback or build a detailed quote with guided cards.", icon: PhoneCall },
              { title: "Show", text: "Add photos, videos, an album link, address, timing, and notes so we send the right crew.", icon: CalendarCheck },
              { title: "Confirm", text: "We review, schedule, complete the job, then rewards can apply.", icon: CheckCircle2 },
            ].map(({ title, text, icon: Icon }) => (
              <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="text-lg font-black">{title}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <VisualStoryCarousel onQuote={() => openQuoteStart("moving")} />

      <section id="reviews" className="px-4 py-12"><TaskDetails title="Customer reviews">
        <div className="mx-auto max-w-6xl">
          <div className="mb-7 flex items-center justify-center gap-5">
            <span className="h-px w-16 bg-white/20" />
            <p className="text-sm font-black uppercase tracking-[0.25em]">5-Star Northwoods Service</p>
            <span className="h-px w-16 bg-white/20" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-slate-900/80 p-5 text-center">
              <SiGoogle className="mx-auto mb-2 h-9 w-9 text-blue-300" />
              <p className="text-xl font-black">Google</p>
              <div className="my-2 flex justify-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />)}
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">5-Star Review Picks</p>
              <p className="mt-2 text-xs text-slate-500">47 Google reviews</p>
            </div>
            {displayTestimonials.map((review) => (
              <div key={review.id} className="rounded-lg border border-white/10 bg-slate-900/80 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-black">{review.reviewerName}</p>
                  <div className="flex gap-0.5">
                    {Array.from({ length: Math.max(1, review.rating) }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />)}
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-slate-200">{review.content}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                  {review.serviceType && <span>{review.serviceType}</span>}
                  {review.sourcePlatform && <span className="rounded-full border border-white/10 px-2 py-0.5">{review.sourcePlatform}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </TaskDetails></section>

      <section id="rewards" className="border-y border-white/10 bg-slate-950/70 px-4 py-12"><TaskDetails title="Rewards and JCMOVES">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-[0.25em] text-blue-300">Book Moves. Earn Rewards.</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">JCMOVES makes every job count.</h2>
          </div>
          <div className="mt-9 grid gap-5 md:grid-cols-4">
            {[
              { icon: CalendarCheck, title: "Book Service", text: "Schedule any service with JC On The Move." },
              { icon: Star, title: "Earn JCMOVES", text: "Points land with every completed booking." },
              { icon: Gift, title: "Redeem Rewards", text: "Use points for discounts and extras." },
            ].map(({ icon: Icon, title, text }, idx) => (
              <div key={title} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600">
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-black">{idx + 1}</span>
                </div>
                <p className="font-black uppercase">{title}</p>
                <p className="mt-2 text-sm text-slate-300">{text}</p>
              </div>
            ))}
            <div className="rounded-lg border border-blue-400/30 bg-blue-600/10 p-5">
              <p className="text-sm font-black uppercase tracking-widest text-blue-200">Ready to earn?</p>
              <p className="mt-3 text-sm text-slate-300">Create your free account and start earning today.</p>
              <Link href="/login?mode=register&intent=rewards&redirect=/rewards">
                <Button className="mt-5 w-full rounded-lg bg-blue-600 font-black hover:bg-blue-500">Join JCMOVES</Button>
              </Link>
            </div>
          </div>
        </div>
      </TaskDetails></section>

      <section className="relative overflow-hidden px-4 py-10">
        <img src={CTA_IMAGE} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
        <div className="absolute inset-0 bg-[#020915]/80" />
        <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 md:flex-row">
          <div className="text-center md:text-left">
            <p className="text-3xl font-black tracking-tight">LET'S GET YOUR MOVE DONE.</p>
            <p className="mt-2 text-slate-300">Fast. Friendly. Northwoods strong.</p>
          </div>
          <Button onClick={() => openQuoteStart("moving")} className="h-14 rounded-lg bg-blue-600 px-10 text-base font-black hover:bg-blue-500">
            Get My Price <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-slate-950 px-4 py-10">
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <p className="text-4xl font-black leading-none">JC</p>
            <p className="mt-1 text-lg font-black">ON THE MOVE</p>
            <p className="mt-3 max-w-xs text-sm text-slate-400">Northwoods moving, junk removal, delivery, cleanup, labor, and local service work.</p>
          </div>
          <div>
            <p className="mb-3 text-sm font-black uppercase tracking-widest">Services</p>
            <div className="space-y-2 text-sm text-slate-400">
              <Link href="/book?mode=quick&service=moving" className="block hover:text-white">Moving</Link>
              <Link href="/book?mode=quick&service=junk_removal" className="block hover:text-white">Junk Removal</Link>
              <Link href="/book?mode=quick&service=delivery" className="block hover:text-white">Delivery</Link>
              <Link href="/book?mode=quick&service=cleaning" className="block hover:text-white">Cleanup / Labor</Link>
              <Link href="/book?mode=quick&service=custom" className="block hover:text-white">Just Ask</Link>
              <Link href="/gift-cards" className="block font-semibold text-amber-200 hover:text-amber-100">Gift Cards</Link>
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-black uppercase tracking-widest">Service Area</p>
            <div className="space-y-2 text-sm text-slate-400">
              <p>Ironwood, MI</p>
              {ROUTE_DAY_SCHEDULE.map((route) => (
                <Link key={route.key} href={routeDayLandingHref(route)} className="block hover:text-white">
                  {route.city} {route.day}
                </Link>
              ))}
              <p>Other nearby areas by availability</p>
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-black uppercase tracking-widest">Contact</p>
            <div className="space-y-2 text-sm text-slate-400">
              <a href="tel:+19062859312" className="block hover:text-white">(906) 285-9312</a>
              <p>Ironwood, Michigan</p>
              <p className="flex items-center gap-2 text-slate-200"><Shield className="h-4 w-4 text-blue-300" /> Licensed & insured</p>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-6xl border-t border-white/10 pt-5 text-center text-xs text-slate-600">
          &copy; {new Date().getFullYear()} JC On The Move. All rights reserved.
        </p>
      </footer>

      <ChatIntakeOverlay
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        initialChip={chatSeedChip}
      />
    </div>
  );
}
