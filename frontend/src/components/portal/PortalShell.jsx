import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Bell, LogOut, GraduationCap, Menu, X } from "lucide-react";
import { logout } from "@/lib/auth";

function PortalShell({ nav, user, children }) {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const isActive = (item) =>
    item.end
      ? pathname === item.to || pathname === `${item.to}/`
      : pathname === item.to || (item.to !== "/" && pathname.startsWith(`${item.to}/`));

  const NavLinks = ({ onNavigate }) =>
    nav.map((item) => {
      const Icon = item.icon;
      const active = isActive(item);
      return (
        <Link
          key={item.to}
          to={item.to}
          onClick={() => onNavigate?.()}
          className={`bvu-nav-link flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
            active
              ? "bvu-nav-active bg-gold font-semibold text-navy shadow-sm"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          {Icon ? <Icon className="h-4 w-4 shrink-0" /> : <span className="inline-block h-4 w-4" />}
          <span className="truncate">{item.label}</span>
        </Link>
      );
    });

  const brand = (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4 sm:px-5 sm:py-5">
      <div className="bvu-logo-float grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-gold text-gold shadow-[0_0_20px_rgba(212,175,55,0.25)]">
        <GraduationCap className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate font-serif text-base leading-tight sm:text-lg" style={{ fontFamily: "var(--font-serif)" }}>
          Bharati Vidyapeeth
        </p>
        <p className="text-[10px] text-white/60">(Deemed to be University)</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen min-h-[100dvh] w-full bg-background">
      {/* Desktop sidebar */}
      <aside className="bvu-slide-in sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col bg-navy text-white md:flex">
        {brand}
        <nav className="bvu-stagger flex-1 space-y-1 overflow-y-auto px-3 py-4">{NavLinks({})}</nav>
        <div className="border-t border-white/10 px-3 py-4">
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/");
            }}
            className="bvu-btn flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-50 md:hidden ${mobileOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-navy/50 backdrop-blur-sm transition-opacity duration-300 ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={`absolute left-0 top-0 flex h-[100dvh] w-[min(18rem,88vw)] flex-col bg-navy text-white shadow-2xl transition-transform duration-300 ease-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pr-2">
            <div className="min-w-0 flex-1">{brand}</div>
            <button
              type="button"
              className="mr-2 grid h-11 w-11 place-items-center rounded-xl text-white/80 hover:bg-white/10"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4">
            {NavLinks({ onNavigate: () => setMobileOpen(false) })}
          </nav>
          <div className="border-t border-white/10 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="bvu-btn flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bvu-fade-in sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border/80 bg-card/90 px-3 py-2.5 backdrop-blur-md sm:gap-4 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="grid h-11 w-11 place-items-center rounded-xl border border-border/70 bg-background text-navy transition hover:bg-muted md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 md:hidden">
              <p className="truncate text-sm font-semibold text-navy">{user?.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{user?.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              type="button"
              className="relative grid h-11 w-11 place-items-center rounded-full transition-colors hover:bg-muted"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5 text-navy" />
              <span className="bvu-bell-dot absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" />
            </button>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gold-soft text-xs font-semibold text-navy shadow-sm transition-transform hover:scale-105 sm:h-10 sm:w-10 sm:text-sm">
                {(user?.name || "?")
                  .split(" ")
                  .map((s) => s[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")}
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold text-navy">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.subtitle}</p>
              </div>
            </div>
          </div>
        </header>
        <main
          key={pathname}
          className="bvu-page-enter bvu-route-transition flex-1 overflow-x-hidden p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5 md:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function StatCard({ value, label, tone = "default" }) {
  const toneMap = {
    default: "text-navy",
    good: "text-success",
    excellent: "text-success",
    warn: "text-warning",
  };
  return (
    <div className="bvu-card rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
      <p className={`text-2xl font-bold tracking-tight sm:text-3xl ${toneMap[tone]}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{label}</p>
      {tone !== "default" && (
        <p className={`mt-1 text-xs font-medium capitalize ${toneMap[tone]}`}>{tone}</p>
      )}
    </div>
  );
}

function SectionCard({ title, action, children, className = "" }) {
  return (
    <div className={`bvu-card rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:items-center sm:justify-between">
          {title && <h3 className="text-sm font-semibold text-navy sm:text-base">{title}</h3>}
          {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}

export { PortalShell, SectionCard, StatCard };
