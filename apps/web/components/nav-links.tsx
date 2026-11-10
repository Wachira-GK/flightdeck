"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@flightdeck/ui";

const links = [
  { href: "/cockpit", label: "Cockpit" },
  { href: "/missions/excel-sum-101", label: "Current mission" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-1 text-sm">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 font-medium transition-colors duration-(--fd-duration-fast)",
                active ? "bg-accent-subtle text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
