import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { SAMPLE_PROJECT } from "@/lib/demo-sample";
import { env } from "@/lib/env";
import { DemoTabs } from "./demo-tabs";

// Shell of the public demo pages: no session, no sidebar, no account menu.
// Logo, view tabs and theme share one row from the md breakpoint up; on a
// phone the tabs drop to a second row and scroll sideways.
// `narrow` is for the public card, which is a single column.
export function DemoShell({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) {
  const width = narrow ? "max-w-2xl" : "max-w-content";
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-content flex-wrap items-center gap-x-8 px-4 md:px-7">
          <div className="flex min-h-14 items-center gap-3">
            <Link href="/" className="text-fg">
              <Logo className="h-7 w-auto" />
            </Link>
            <span className="rounded-control bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text">Demo</span>
          </div>
          <div className="order-last -mb-px w-full md:order-none md:w-auto">
            <DemoTabs cardHref={`/p/${env.demoTenantSlug || SAMPLE_PROJECT.slug}`} />
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={`mx-auto w-full ${width} px-4 pt-8 pb-20 md:px-7 md:pt-12`}>{children}</main>
    </div>
  );
}
