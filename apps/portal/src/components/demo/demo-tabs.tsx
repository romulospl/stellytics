"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";

// The three views of the public demo as one tab bar: tenant, SCF operator
// and the public card.
// Plain links (GET), so it works without JavaScript; the active tab is marked
// with aria-current, an underline and the accent colour.
export function DemoTabs({ cardHref }: { cardHref: string }) {
  const pathname = usePathname();
  const tabs: { href: string; label: string; icon: IconName }[] = [
    { href: "/demo", label: "Tenant", icon: "layers" },
    { href: "/operator", label: "SCF operator", icon: "shield" },
    { href: cardHref, label: "Public card", icon: "eye" },
  ];
  return (
    <nav aria-label="Demo views" className="flex gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-4 text-sm whitespace-nowrap outline-none focus-visible:bg-surface-2 ${
              active
                ? "border-accent font-semibold text-accent-text"
                : "border-transparent font-medium text-muted hover:border-border-strong hover:text-fg"
            }`}
          >
            <Icon name={tab.icon} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
