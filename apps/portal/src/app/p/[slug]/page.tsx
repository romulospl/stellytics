import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoNotice } from "@/components/demo/demo-notice";
import { loadDemoContext } from "@/lib/access";
import { type ApiCounts, type ApiServiceDashboard, getServiceDashboard } from "@/lib/data/api-metrics";
import { listApiServices } from "@/lib/data/api-services";
import { getDemoApiOverview } from "@/lib/data/operator/api";
import { listSites } from "@/lib/data/sites";
import { cachedDemo } from "@/lib/demo-cache";
import { SAMPLE_PROJECT, sampleApiOverview, sampleServiceDashboard, sampleSiteDashboard, sampleWebOverview } from "@/lib/demo-sample";
import { env } from "@/lib/env";
import { bucketLabel, formatCount, formatLatency, formatShare } from "@/lib/format";
import { type Period, resolvePeriod } from "@/lib/period";
import { getDemoWebOverview } from "@/lib/umami/overview";
import { getSiteDashboard, type SiteDashboard, type Totals, UmamiError } from "@/lib/umami/stats";
import { ColumnChart } from "@/components/charts/column-chart";

export const metadata: Metadata = { title: "Public project card" };
// Rendered per request: the demo mode and the data are read at run time.
export const dynamic = "force-dynamic";

// Public card of the demo project: what someone outside the project
// and outside SCF sees, with no session. Only aggregated totals and the daily
// series of a fixed period (visitors, API requests, page views, events, p50,
// p95, 5xx errors): no per-page, per-endpoint, referrer or country detail.
//
// The slug in the URL selects nothing. It must be the demo project's own slug
// (the sample project, or the tenant of DEMO_TENANT_SLUG); any other slug,
// including a real project's, answers 404 before anything is read. No other
// project has a public card.
const CARD_PERIOD = "30d" as const;

type Card = {
  web: { name: string; sites: number; totals: Totals | null };
  api: { services: number; totals: ApiCounts };
  sites: (SiteDashboard | null)[];
  services: ApiServiceDashboard[];
};

async function tenantCard(slug: string, period: Period): Promise<Card> {
  const ctx = await loadDemoContext();
  if (!ctx || ctx.slug !== slug) notFound();
  const key = `${ctx.tenantId}:${period.key}`;
  const [web, api, siteList, serviceList] = await Promise.all([
    cachedDemo(`op-web:${key}`, () => getDemoWebOverview(ctx, period)),
    cachedDemo(`op-api:${key}`, () => getDemoApiOverview(ctx, period)),
    cachedDemo(`sites:${ctx.tenantId}`, () => listSites(ctx)),
    cachedDemo(`services:${ctx.tenantId}`, () => listApiServices(ctx)),
  ]);
  const [sites, services] = await Promise.all([
    Promise.all(
      siteList.map((site) =>
        cachedDemo(`web:${key}:${site.id}`, () => getSiteDashboard(ctx, site.id, period)).catch((error: unknown) => {
          if (!(error instanceof UmamiError)) throw error;
          console.error("Demo: failed to read the web dashboard", error.message);
          return null;
        }),
      ),
    ),
    Promise.all(serviceList.map((service) => cachedDemo(`api:${key}:${service.id}`, () => getServiceDashboard(ctx, service.id, period)))),
  ]);
  if (!web.projects[0] || !api[0]) notFound();
  return {
    web: web.projects[0],
    api: api[0],
    sites,
    services: services.filter((d): d is ApiServiceDashboard => d !== null),
  };
}

function sampleCard(slug: string, period: Period): Card {
  if (slug !== SAMPLE_PROJECT.slug) notFound();
  return {
    web: sampleWebOverview(period).projects[0]!,
    api: sampleApiOverview(period)[0]!,
    sites: [sampleSiteDashboard(period)],
    services: [sampleServiceDashboard(period)],
  };
}

const full = new Intl.NumberFormat("en");
const plural = (n: number, one: string, many: string) => `${full.format(n)} ${n === 1 ? one : many}`;

// One value per bucket, summed across the project's sites or services.
function sumSeries<P>(period: Period, lists: P[][], pick: (point: P) => number): number[] {
  return period.buckets.map((_, i) => lists.reduce((sum, list) => sum + (list[i] ? pick(list[i]) : 0), 0));
}

type Fact = { label: string; value: string; note?: string };

// One half of the card (web or API): the headline figure, its daily chart and
// the supporting figures of the same source.
function Panel({
  title,
  lead,
  unit,
  period,
  series,
  facts,
  summary,
}: {
  title: string;
  lead: { label: string; value: string };
  unit: string;
  period: Period;
  series: number[];
  facts: Fact[];
  summary: string;
}) {
  return (
    <section aria-labelledby={`card-${title}`} className="min-w-0">
      <h2 id={`card-${title}`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{summary}</p>
      <p className="mt-8 text-sm font-medium text-muted">{lead.label}</p>
      <p className="mt-1 text-6xl leading-none font-bold tracking-tight tabular-nums">{lead.value}</p>
      <div className="mt-8">
        <ColumnChart
          label={`${unit} per day`}
          currentIncomplete
          points={period.buckets.map((at, i) => {
            const n = series[i] ?? 0;
            const longLabel = bucketLabel(period.unit, at, true);
            return {
              label: bucketLabel(period.unit, at),
              longLabel,
              value: n,
              description: `${longLabel}: ${plural(n, unit.replace(/s$/, ""), unit)}`,
              tooltip: [{ value: full.format(n), unit }],
            };
          })}
        />
      </div>
      <dl className="mt-6 divide-y divide-border border-y border-border">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-sm text-muted">{fact.label}</dt>
            <dd className="text-right text-lg font-semibold tabular-nums">
              {fact.value}
              {fact.note && <span className="ml-2 text-xs font-normal text-muted">{fact.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function PublicCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const period = resolvePeriod(CARD_PERIOD);
  const sample = !env.demoTenantSlug;
  const { web, api, sites, services } = sample ? sampleCard(slug, period) : await tenantCard(slug, period);

  const webSeries = sumSeries(period, sites.flatMap((d) => (d ? [d.series] : [])), (p) => p.visitors);
  const apiSeries = sumSeries(period, services.map((d) => d.series), (p) => p.requests);
  const events = sites.reduce((sum, d) => sum + (d?.events.reduce((n, e) => n + e.count, 0) ?? 0), 0);
  const requests = api.totals.requests;

  const webFacts: Fact[] = [
    { label: "Page views", value: web.totals ? formatCount(web.totals.pageviews) : "—" },
    { label: "Custom events", value: formatCount(events) },
  ];
  const apiFacts: Fact[] = [
    { label: "Typical response time (p50)", value: formatLatency(api.totals.p50) },
    { label: "Slowest 5% of responses (p95)", value: formatLatency(api.totals.p95) },
    {
      label: "Server errors (5xx)",
      value: formatCount(api.totals.serverErrors),
      note: requests > 0 ? `${formatShare(api.totals.serverErrors, requests)} of requests` : undefined,
    },
  ];

  return (
    <DemoShell>
      <DemoNotice sample={sample} />
      <header className="mt-8 max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight md:text-6xl">{web.name}</h1>
        <p className="mt-4 text-lg text-muted">
          How people use {web.name} on Stellar, over the {period.label.toLowerCase()}. Open to everyone, measured by
          stellytics.
        </p>
      </header>

      <div className="mt-14 grid gap-14 border-t border-border pt-10 lg:grid-cols-2 lg:gap-16">
        <Panel
          title="Web"
          summary={plural(web.sites, "website", "websites")}
          lead={{ label: "Visitors", value: web.totals ? formatCount(web.totals.visitors) : "—" }}
          unit="visitors"
          period={period}
          series={webSeries}
          facts={webFacts}
        />
        <Panel
          title="API"
          summary={plural(api.services, "API service", "API services")}
          lead={{ label: "Requests", value: formatCount(requests) }}
          unit="requests"
          period={period}
          series={apiSeries}
          facts={apiFacts}
        />
      </div>

      <section aria-labelledby="card-method" className="mt-16 grid gap-6 border-t border-border pt-10 md:grid-cols-[1fr_2fr]">
        <h2 id="card-method" className="text-xl font-semibold tracking-tight">
          How this is measured
        </h2>
        <ul className="max-w-[62ch] space-y-3 text-muted">
          <li>Every figure is measured by the platform itself, not reported by the project.</li>
          <li>The page shows totals only, never a single visitor, page or endpoint.</li>
          <li>No cookies, no browser storage and no stored IP addresses.</li>
          <li>Each visitor is counted once per website, and all times are UTC.</li>
          <li>The current day is still in progress, so its bar is hatched.</li>
        </ul>
      </section>
    </DemoShell>
  );
}
