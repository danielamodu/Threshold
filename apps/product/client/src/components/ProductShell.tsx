/**
 * Signal Cabinet style reminder: product navigation behaves like an instrument rail—quiet, compact, role-first.
 *
 * Role/org come from the real Clerk session (useThresholdSession), not the
 * URL — RequireRole (client/src/components/RequireRole.tsx) already
 * guarantees the URL's :role segment matches the session by the time this
 * renders. The old "View as" dropdown is gone; there is nothing left here
 * that can put a session into a role it doesn't actually hold.
 */
import { useOrganization } from "@clerk/clerk-react";
import { AlertTriangle, BookOpenText, FileClock, FilePlus2, Gauge, LogOut, MapPinned, Route as RouteIcon, Settings2, ShieldCheck, UserCheck } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { useThresholdSession } from "@/hooks/useThresholdSession";
import { toDemoRole } from "@/lib/roleMapping";
import { roleMeta, type DemoRole } from "@/lib/productShellData";
import "@/product-review.css";

type NavItem = { label: string; page: string; icon: typeof Gauge };

const navigation: Record<DemoRole, NavItem[]> = {
  admin: [{ label: "Routes", page: "routes", icon: RouteIcon }, { label: "Create route", page: "create", icon: FilePlus2 }, { label: "Drivers", page: "drivers", icon: UserCheck }, { label: "Organisation", page: "settings", icon: Settings2 }],
  dispatcher: [{ label: "Routes", page: "routes", icon: RouteIcon }, { label: "Create route", page: "create", icon: FilePlus2 }, { label: "Route activity", page: "activity", icon: Gauge }],
  compliance: [{ label: "Audit timeline", page: "audit", icon: FileClock }, { label: "Compliance records", page: "records", icon: ShieldCheck }, { label: "Cargo claims", page: "claims", icon: AlertTriangle }],
  driver: [{ label: "My routes", page: "routes", icon: MapPinned }, { label: "My records", page: "records", icon: BookOpenText }],
};

/** Real role/page for the CURRENT render — role from the session, page from the URL. */
export function useProductRoute() {
  const [location] = useLocation();
  const { role: sessionRole } = useThresholdSession();
  const params = useParams<{ page?: string }>();
  const role: DemoRole = sessionRole ? toDemoRole(sessionRole) : "dispatcher";
  return { location, role, page: params.page ?? "routes" };
}

export function ProductShell({ children, title, subtitle, actions }: { children: React.ReactNode; title: string; subtitle: string; actions?: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { role, page } = useProductRoute();
  const { organization } = useOrganization();
  return <main className="product-shell"><aside className="product-rail"><a className="product-rail__brand" href="/"><BrandMark compact /></a><div className="product-rail__org"><span className="eyebrow">Organisation</span><strong>{organization?.name ?? "—"}</strong></div><div className="product-rail__coordinates"><span>33° 27′ N</span><i /><span>112° 04′ W</span></div><nav className="product-rail__nav" aria-label="Product navigation">{navigation[role].map((item) => { const Icon = item.icon; const active = page === item.page || (page === "detail" && item.page === "routes"); return <a key={item.page} href={`/app/${role}/${item.page}`} className={active ? "product-nav-item product-nav-item--active" : "product-nav-item"}><Icon size={16} /><span>{item.label}</span></a>; })}</nav><div className="product-rail__foot"><a href="/"><LogOut size={15} /> Exit</a></div></aside><section className="product-main"><header className="product-topbar"><div className="product-topbar__crumb"><span className="eyebrow">{roleMeta[role].short}</span><span className="product-topbar__fork"><i /><i /> Shared event</span></div><div className="product-topbar__right"><button className="product-avatar" onClick={() => setLocation("/organization")}>{roleMeta[role].short.slice(0, 2).toUpperCase()}</button></div></header><div className="product-page-head"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="product-page-head__actions">{actions}</div>}</div>{children}</section></main>;
}
