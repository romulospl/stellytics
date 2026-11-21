import type { ReactNode } from "react";
import { cardClass } from "@/components/ui/card";

type MetricCardProps = { label: string; value: string; chart?: ReactNode; children?: ReactNode };

// Tiles of one dashboard read as a single instrument panel: one frame, hairline
// dividers (the 1px gap shows the frame's background), no card per number.
export function MetricStrip({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border shadow-card lg:grid-cols-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function MetricCard({ label, value, chart, children }: MetricCardProps) {
  return (
    <div className={`${cardClass} rounded-none border-0 p-5 shadow-none`}>
      <p className="text-[0.8125rem] font-medium text-muted">{label}</p>
      <p className="mt-1.5 text-3xl leading-tight font-semibold tracking-tight tabular-nums">{value}</p>
      {chart}
      {children && <div className="mt-2 text-xs">{children}</div>}
    </div>
  );
}
