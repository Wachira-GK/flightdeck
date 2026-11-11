"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@flightdeck/ui";

const links = [
  { href: "/cockpit", label: "Cockpit" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/missions/excel-sum-101", label: "Current mission" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const linkClass = (active: boolean) =>
  cn(
    "rounded-md px-3 py-2 font-medium transition-colors duration-(--fd-duration-fast)",
    active ? "bg-accent-subtle text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
  );

/**
 * Primary navigation. Phones (< sm): a "Menu" disclosure button that opens a full-width panel under
 * the header (Escape or choosing a link closes it, focus returns to the button). sm and up: inline links.
 */
export function NavLinks() {
  const pathname = usePathname();
  // The panel is open only for the page it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) =>
    setOpenOn((prev) => {
      const isOpen = prev === pathname;
      return (typeof next === "function" ? next(isOpen) : next) ? pathname : null;
    });
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenOn(null);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <ul className="hidden items-center gap-1 text-sm sm:flex">
        {links.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <li key={link.href}>
              <Link href={link.href} aria-current={active ? "page" : undefined} className={linkClass(active)}>
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="sm:hidden">
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 items-center gap-2 rounded-md border border-border-strong px-3 text-sm font-medium text-fg hover:bg-surface-2"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
            {open ? (
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
          Menu
        </button>
        <div
          id={panelId}
          hidden={!open}
          className="absolute inset-x-0 top-16 z-40 border-b border-border bg-surface shadow-lg"
        >
          <ul className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 text-base">
            {links.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(linkClass(active), "flex min-h-11 items-center")}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
