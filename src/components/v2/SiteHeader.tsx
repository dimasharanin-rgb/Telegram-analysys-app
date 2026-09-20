"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/client/format";

const LINKS = [
  { href: "/analyze", label: "New analysis" },
  { href: "/analyses", label: "Analyses" },
  { href: "/account", label: "Account" },
];

/**
 * The application header.
 *
 * Three destinations, named for what the person is doing rather than for the
 * data model. On mobile the same links become a bottom bar, so the thumb
 * reaches them.
 */
export function SiteHeader({ subtitle }: { subtitle?: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className="no-print border-b border-line bg-white">
        <div className="app-container flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white"
            >
              C
            </span>
            <span className="hidden sm:inline">Conversation Analyzer</span>
          </Link>

          <nav aria-label="Main" className="hidden sm:block">
            <ul className="flex items-center gap-1">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={cx(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive(link.href)
                        ? "bg-brand-50 text-brand-700"
                        : "text-muted hover:text-ink",
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex min-w-0 items-center gap-3">
            {subtitle ? (
              <span className="hidden max-w-48 truncate text-sm text-muted lg:inline">
                {subtitle}
              </span>
            ) : null}
            <Link
              href="/privacy"
              className="shrink-0 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Privacy
            </Link>
          </div>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        <ul className="grid grid-cols-3">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cx(
                  "flex h-14 w-full items-center justify-center text-sm font-medium",
                  isActive(link.href) ? "text-brand-700" : "text-muted",
                )}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
