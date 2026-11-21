import type { Metadata } from "next";
import { ColumnChart } from "@/components/charts/column-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { DemoHeader } from "@/components/demo/demo-header";
import { DemoNotice } from "@/components/demo/demo-notice";
import { MetricCard, MetricStrip } from "@/components/metrics/metric-card";
import { DeltaBadge } from "@/components/metrics/delta-badge";
import { PeriodPicker } from "@/components/metrics/period-picker";
import { cardClass } from "@/components/ui/card";
import { requireDemoContext } from "@/lib/access";
import { getDemoApiOverview } from "@/lib/data/operator/api";
import { listSites } from "@/lib/data/sites";
import { cachedDemo } from "@/lib/demo-cache";
import {
  averageVisitSeconds,
  bounceRate,
  bucketLabel,
  formatCount,
  formatDuration,
  formatLatency,
  formatPercent,
  formatShare,
  relativeDelta,
} from "@/lib/format";
import { sampleApiOverview, sampleSiteDashboard, sampleWebOverview } from "@/lib/demo-sample";
import { env } from "@/lib/env";
import { parsePeriodKey, type Period, resolvePeriod } from "@/lib/period";
import { getDemoWebOverview } from "@/lib/umami/overview";
import { getSiteDashboard, UmamiError } from "@/lib/umami/stats";

export const metadata: Metadata = { title: "Operator view" };
// Rendered per request: DEMO_TENANT_SLUG and the data are read at run time,
// never at build time (where the demo is off and the page would be a fixed 404).
export const dynamic = "force-dynamic";

// Public demo of the SCF operator panels (#29, #38): the same per-project
// numbers of /operator/web and /operator/api, with sample data or read only
// for the demo tenant (DEMO_TENANT_SLUG).
// It takes a DemoContext, not an OperatorContext, so the functions that read
// every project or change one (remove, approve, read keys) cannot be called
// from here. No link leads to /operator, which stays behind the session.
async function tenantOverview(period: Period) {
  const ctx = await requireDemoContext();
  const key = `${ctx.tenantId}:${period.key}`;
  const [web, api, sites] = await Promise.all([
    cachedDemo(`op-web:${key}`, () => getDemoWebOverview(ctx, period)),
    cachedDemo(`op-api:${key}`, () => getDemoApiOverview(ctx, period)),
    cachedDemo(`sites:${ctx.tenantId}`, () => listSites(ctx)),
  ]);
  // Daily visitors of the demo project, summed across its websites. A site
  // Umami does not answer for adds nothing (its totals already show "Unavailable").
  const dashboards = await Promise.all(
    sites.map((site) =>
      cachedDemo(`web:${key}:${site.id}`, () => getSiteDashboard(ctx, site.id, period)).catch((error: unknown) => {
        if (!(error instanceof UmamiError)) throw error;
        console.error("Demo: failed to read the web dashboard", error.message);
        return null;
      }),
    ),
  );
  const visitors = period.buckets.map((_, i) => dashboards.reduce((sum, d) => sum + (d?.series[i]?.visitors ?? 0), 0));
  return { web, api, visitors };
}

export default async function DemoOperatorPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const period = resolvePeriod(parsePeriodKey((await searchParams).period));
  // No demo tenant configured: sample data, nothing read (src/lib/demo-sample.ts).
  const sample = !env.demoTenantSlug;
  const { web, api, visitors } = sample
    ? {
        web: sampleWebOverview(period),
        api: sampleApiOverview(period),
        visitors: sampleSiteDashboard(period).series.map((p) => p.visitors),
      }
    : await tenantOverview(period);
  const totalVisitors = web.projects.reduce((sum, p) => sum + (p.totals?.visitors ?? 0), 0);
  const totalPageviews = web.projects.reduce((sum, p) => sum + (p.totals?.pageviews ?? 0), 0);
  const totalRequests = api.reduce((sum, p) => sum + p.totals.requests, 0);
  const full = new Intl.NumberFormat("en");
  const vsLabel = `vs previous ${period.label.replace(/^Last /, "")}`;
  const th = "py-3 pl-4 text-right text-xs font-medium";
  const td = "py-4 pl-4 text-right align-top tabular-nums";

  return (
    <section>
      <DemoNotice sample={sample} />
      <DemoHeader
        title="SCF operator view"
        picker={<PeriodPicker className="" current={period.key} href={(k) => `/operator?period=${k}`} />}
      >
        What SCF operators see: the same metrics for every enrolled project, side by side. This demo lists only the demo
        project; the real view adds filtering, sorting and comparison, and needs an operator account. Times are UTC.
      </DemoHeader>

      <MetricStrip className="mt-8">
        <MetricCard label="Enrolled projects" value={formatCount(web.projects.length)} />
        <MetricCard label="Visitors" value={formatCount(totalVisitors)} />
        <MetricCard label="Page views" value={formatCount(totalPageviews)} />
        <MetricCard label="API requests" value={formatCount(totalRequests)} />
      </MetricStrip>

      <h2 className="mt-14 border-t border-border pt-8 text-xl font-semibold tracking-tight">Web analytics across projects</h2>
      <div className={`${cardClass} mt-4 overflow-x-auto px-5 py-1`}>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="py-3 text-xs font-medium">Project</th>
              <th className={th}>Websites</th>
              <th className={th}>Page views</th>
              <th className={th}>Visitors</th>
              <th className={th}>Avg. visit</th>
              <th className={th}>Bounce rate</th>
              <th className={th}>Trend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {web.projects.map((p) => (
              <tr key={p.tenantId}>
                <td className="py-4 align-top">
                  <span className="block text-base font-semibold">{p.name}</span>
                  <span className="block font-mono text-xs text-muted">{p.slug}</span>
                </td>
                <td className={td}>{p.sites}</td>
                {p.totals === null || p.previous === null ? (
                  <td colSpan={5} className="py-4 pl-4 text-right align-top text-muted">
                    Unavailable
                  </td>
                ) : (
                  <>
                    <td className={td}>
                      {formatCount(p.totals.pageviews)}
                      <Change delta={relativeDelta(p.totals.pageviews, p.previous.pageviews)} />
                    </td>
                    <td className={td}>
                      {formatCount(p.totals.visitors)}
                      <Change delta={relativeDelta(p.totals.visitors, p.previous.visitors)} />
                    </td>
                    <td className={td}>{p.totals.visits > 0 ? formatDuration(averageVisitSeconds(p.totals)) : "—"}</td>
                    <td className={td}>{p.totals.visits > 0 ? formatPercent(bounceRate(p.totals)) : "—"}</td>
                    <td className={`${td} w-28`}>
                      <Sparkline values={visitors} className="h-7 w-24" />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Changes are {vsLabel}. Projects with several websites add them up.</p>

      <div className={`${cardClass} mt-4`}>
        <h2 className="text-[0.8125rem] font-medium text-muted">Visitors per {period.unit}</h2>
        <div className="mt-4">
          <ColumnChart
            label="Visitors per period"
            currentIncomplete
            points={period.buckets.map((at, i) => {
              const n = visitors[i] ?? 0;
              const longLabel = bucketLabel(period.unit, at, true);
              return {
                label: bucketLabel(period.unit, at),
                longLabel,
                value: n,
                description: `${longLabel}: ${full.format(n)} ${n === 1 ? "visitor" : "visitors"}`,
                tooltip: [{ value: full.format(n), unit: n === 1 ? "visitor" : "visitors" }],
              };
            })}
          />
        </div>
      </div>

      <h2 className="mt-14 border-t border-border pt-8 text-xl font-semibold tracking-tight">API analytics across projects</h2>
      <div className={`${cardClass} mt-4 overflow-x-auto px-5 py-1`}>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="py-3 text-xs font-medium">Project</th>
              <th className={th}>Services</th>
              <th className={th}>Requests</th>
              <th className={th}>5xx</th>
              <th className={th}>4xx</th>
              <th className={th}>p50</th>
              <th className={th}>p95</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {api.map((p) => (
              <tr key={p.tenantId}>
                <td className="py-4 align-top">
                  <span className="block text-base font-semibold">{p.name}</span>
                  <span className="block font-mono text-xs text-muted">{p.slug}</span>
                </td>
                <td className={td}>{p.services}</td>
                {p.totals.requests === 0 ? (
                  <td colSpan={5} className="py-4 pl-4 text-right align-top text-muted">
                    {p.services === 0 ? "No API services" : "No requests in this period"}
                  </td>
                ) : (
                  <>
                    <td className={td}>{formatCount(p.totals.requests)}</td>
                    <td className={td}>{formatShare(p.totals.serverErrors, p.totals.requests)}</td>
                    <td className={td}>{formatShare(p.totals.clientErrors, p.totals.requests)}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatLatency(p.totals.p50)}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatLatency(p.totals.p95)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Each project adds up its API services. Errors are the share of requests; latency is across all requests of the
        project.
      </p>
    </section>
  );
}

function Change({ delta }: { delta: ReturnType<typeof relativeDelta> }) {
  if (!delta) return null;
  return (
    <span className="block text-xs">
      <DeltaBadge delta={delta} />
    </span>
  );
}
