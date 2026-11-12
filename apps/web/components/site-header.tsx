import Link from "next/link";
import { NavLinks } from "./nav-links";

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 6 L19 17 L16 15 L13 17 Z" fill="var(--fd-accent)" />
      <path d="M6 16h4M22 16h4M16 22v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="relative border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-fg">
          <Logo />
          <span>FlightDeck</span>
        </Link>
        <nav aria-label="Primary">
          <NavLinks />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-fg-muted sm:px-6">
        <p>FlightDeck G1 prototype. Sign-in is real; mission progress and activity on these pages are still sample data.</p>
      </div>
    </footer>
  );
}
