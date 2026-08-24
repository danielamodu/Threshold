/**
 * Signal Cabinet style reminder: this footer is a field registry—dense, orderly, and operational.
 * Use copper for standard cues; reserve vermilion for the threshold mark and active event states.
 */
import { ArrowUpRight, CircleDot, Github, Mail, MoveUp, Twitter } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

const footerGroups = [
  { title: "Product", links: [["Route monitor", "#product"], ["Event record", "#product"], ["Driver safety", "#integrity"], ["Cargo liability", "#integrity"]] },
  { title: "Method", links: [["Observe", "#method"], ["Evaluate", "#method"], ["Act", "#method"], ["Decision integrity", "#integrity"]] },
  { title: "Operating record", links: [["PHX — 01", "#product"], ["Field protocol", "#method"], ["Confidence logic", "#integrity"], ["Signal archive", "#product"]] },
  { title: "Resources", links: [["Docs", "/docs"], ["Legal", "/legal"], ["Privacy", "/privacy"], ["Trust & security", "/legal"]] },
] as const;

const socialLinks = [
  { label: "X / Twitter", href: "https://x.com/szrxbt", icon: Twitter },
  { label: "GitHub", href: "https://github.com/Threshold", icon: Github },
  { label: "Email", href: "mailto:theamebonetwork@gmail.com", icon: Mail },
] as const;

export function SiteFooter() {
  return (
    <footer className="signal-footer">
      <div className="landing-container signal-footer__lead">
        <div className="signal-footer__brand"><BrandMark /><p>Temperature events do not respect team boundaries. The route record should not either.</p></div>
        <a className="signal-footer__return" href="#top">Return to top <MoveUp size={15} /></a>
      </div>

      <div className="landing-container signal-footer__grid">
        {footerGroups.map((group) => (
          <section className="signal-footer__group" key={group.title}>
            <p className="eyebrow">{group.title}</p>
            <ul>{group.links.map(([label, href]) => <li key={label}><a href={href}>{label}<ArrowUpRight size={12} /></a></li>)}</ul>
          </section>
        ))}
      </div>

      <div className="landing-container signal-footer__wordmark">
        <span>THRESHOLD</span>
        <p>Route intelligence<br />for the actual exposure.</p>
      </div>

      <div className="landing-container signal-footer__meta">
        <span>© 2026 Threshold Systems</span>
        <span className="signal-footer__status"><CircleDot size={13} /> Field protocol nominal</span>
        <div className="signal-footer__socials">{socialLinks.map(({ label, href, icon: Icon }) => <a key={label} href={href} aria-label={label} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}><Icon size={14} /><span>{label}</span></a>)}</div>
      </div>
    </footer>
  );
}
