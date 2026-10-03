import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, ArrowUpRight, Check, Gem, Gift, Hammer, Leaf, MapPin, Package, Star, Truck } from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public-site-shell";
import crewImage from "@assets/google_movers/crew-ramp.jpg";
import workImage from "@assets/google_movers/wrapped-item.jpg";

type Review = { id: string; reviewerName: string; rating: number; content: string; status: string; sourcePlatform?: string | null };
const services = [
  { name: "Moving", text: "Across town. Into a new chapter.", icon: Truck, href: "/book?service=moving" },
  { name: "Delivery & hauling", text: "Bring it home. Clear it out.", icon: Package, href: "/services" },
  { name: "Home projects", text: "Painting, flooring, roofing & more.", icon: Hammer, href: "/book?service=handyman" },
  { name: "Yard & seasonal care", text: "From the first mow to the first snow.", icon: Leaf, href: "/book?service=lawn_care" },
];

export default function HomePage() {
  const { data: reviews = [] } = useQuery<Review[]>({ queryKey: ["/api/testimonials?status=published&featured=true&limit=5"] });
  // Render actual published customer text; never synthesize a testimonial.
  const review = reviews.find(item => item.status === "published" && item.rating === 5 && item.content.trim());
  return <div className="jc-public">
    <PublicHeader />
    <main id="main-content">
      <section className="jc-container jc-hero">
        <div className="jc-hero-copy">
          <p className="jc-eyebrow"><span /> YOUR NORTHWOODS NEIGHBORS</p>
          <h1>Five-star movers.<br /><span>More help around<br className="jc-desktop-break" /> the corner.</span></h1>
          <p className="jc-hero-description">Moving is where we started. Helping you feel at home is what we do. Tell us what you need — we'll take it from there.</p>
          <Link href="/book" className="jc-button jc-button-large">Start my request <ArrowUpRight size={21} /></Link>
          <p className="jc-caption"><Check size={15} /> About 60 seconds. No account needed.</p>
          <div className="jc-hero-trust"><span><Star size={17} /> Five-star customer reviews</span><span><MapPin size={17} /> Ironwood & the Northwoods</span></div>
        </div>
        <div className="jc-hero-photo"><img src={crewImage} alt="The JC ON THE MOVE crew with a carefully loaded moving truck in the Northwoods" fetchPriority="high" width="750" height="1000" /><div className="jc-photo-note"><span className="jc-note-dot" /><div><strong>Real people. A helping hand.</strong><span>Your local JC ON THE MOVE crew.</span></div></div></div>
      </section>
      <section className="jc-steps-band" aria-label="How it works"><div className="jc-container jc-how-it-works">
        {[['01', 'Choose your project', 'A move, a pickup, a little help at home.'], ['02', 'Pick a time. Or a callback.', 'Choose a preferred date or let us help schedule.'], ['03', 'We confirm the details', 'Your project, price and schedule, together.']].map(([number, title, text]) => <div className="jc-how-step" key={number}><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></div>)}
      </div></section>
      <section className="jc-container jc-section" id="services"><div className="jc-section-heading"><div><p className="jc-eyebrow">ONE FAMILIAR TEAM</p><h2>What's on your to-do list?</h2></div><Link href="/services" className="jc-text-link">Explore all services <ArrowRight size={17} /></Link></div>
        <div className="jc-services-grid">{services.map(({ name, text, icon: Icon, href }) => <Link key={name} href={href} className="jc-service-card"><Icon size={28} strokeWidth={1.5} /><h3>{name}</h3><p>{text}</p><ArrowUpRight className="jc-service-arrow" size={19} /></Link>)}</div>
      </section>
      <section className="jc-container jc-proof" aria-label="Our work and customer reviews"><Link href="/gallery" className="jc-work-feature"><img src={workImage} alt="Furniture wrapped and protected by the moving crew" loading="lazy" width="750" height="1000" /><div><p className="jc-eyebrow">A LITTLE CARE GOES A LONG WAY</p><h2>Your things.<br />In good hands.</h2><span>See our crew at work <ArrowRight size={17} /></span></div></Link>
        <div className="jc-review"><div className="jc-review-stars" aria-label="5 stars">{[1,2,3,4,5].map(star => <Star key={star} size={19} fill="currentColor" />)}</div>{review ? <><blockquote>“{review.content.trim()}”</blockquote><p className="jc-review-author">{review.reviewerName}<span>{review.sourcePlatform ? `${review.sourcePlatform} review` : "Published customer review"}</span></p></> : <><h2>Neighbors helping neighbors.</h2><p>Get to know the crew through our customers' experiences.</p></>}<Link href="/reviews" className="jc-text-link">Read customer reviews <ArrowRight size={16} /></Link></div>
      </section>
      <section className="jc-container jc-returning" aria-label="More for our guests"><div><p className="jc-eyebrow">A LITTLE MORE FROM JC</p><h2>Good to have you back.</h2></div><Link href="/handmade-jewels-by-ashley" className="jc-small-feature"><Gem size={24} /><div><h3>Ashley's jewelry</h3><p>Handmade finds. A personal touch.</p></div><ArrowUpRight size={18} /></Link><Link href="/rewards" className="jc-small-feature"><Gift size={24} /><div><h3>Your rewards</h3><p>See what your next visit holds.</p></div><ArrowUpRight size={18} /></Link></section>
    </main><PublicFooter />
  </div>;
}
