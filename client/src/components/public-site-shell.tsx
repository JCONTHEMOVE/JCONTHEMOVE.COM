import { Link } from "wouter";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useState } from "react";
import "@/styles/public-site.css";

export function PublicHeader({ booking = false }: { booking?: boolean }) {
  const [open, setOpen] = useState(false);
  return <header className="jc-public-header">
    <div className="jc-container jc-header-inner">
      <Link href="/home" className="jc-brand" aria-label="JC ON THE MOVE home"><span className="jc-brand-mark">JC<span>↗</span></span><span><strong>ON THE MOVE</strong><small>NORTHWOODS MOVING & MORE</small></span></Link>
      {booking ? <Link href="/home" className="jc-text-link">Back to home</Link> : <>
        <button className="jc-menu-toggle" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
        <nav className={`jc-navigation ${open ? "is-open" : ""}`} aria-label="Main navigation">
          <Link href="/services">Services</Link><Link href="/gallery">Our work</Link><Link href="/handmade-jewels-by-ashley">Ashley's shop</Link><Link href="/rewards">Rewards</Link><Link href="/login">Sign in</Link>
          <Link href="/book" className="jc-button">Start my request <ArrowUpRight size={17} /></Link>
        </nav>
      </>}
    </div>
  </header>;
}
export function PublicFooter() {
  return <footer className="jc-footer"><div className="jc-container jc-footer-inner"><div><strong>JC ON THE MOVE</strong><p>Local movers. Neighbors you can call.</p><a href="tel:+19062859312">(906) 285-9312</a></div><nav aria-label="More from JC ON THE MOVE"><Link href="/services">All services</Link><Link href="/reviews">Reviews</Link><Link href="/gallery">Gallery</Link><Link href="/gift-cards">Gift cards</Link><Link href="/route-days">Route days</Link><Link href="/handmade-jewels-by-ashley">Jewelry</Link><Link href="/rewards">Rewards</Link></nav></div></footer>;
}
