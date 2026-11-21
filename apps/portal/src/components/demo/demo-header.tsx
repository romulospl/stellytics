import type { ReactNode } from "react";

// Title, one sentence on who sees this view, and the period picker beside it
// on wide screens (below it on a phone).
export function DemoHeader({ title, children, picker }: { title: string; children: ReactNode; picker: ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
      <div className="min-w-0 flex-1 basis-96">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 max-w-[62ch] text-base text-muted">{children}</p>
      </div>
      {picker}
    </div>
  );
}
