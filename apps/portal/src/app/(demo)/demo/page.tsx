import type { Metadata } from "next";
import { requireDemoContext } from "@/lib/access";
import { type ApiServiceDashboard, getServiceDashboard } from "@/lib/data/api-metrics";
import { listApiServices } from "@/lib/data/api-services";
import { listSites } from "@/lib/data/sites";
import { cachedDemo } from "@/lib/demo-cache";
import { SAMPLE_PROJECT, SAMPLE_SERVICE, SAMPLE_SITE, sampleServiceDashboard, sampleSiteDashboard } from "@/lib/demo-sample";
import { env } from "@/lib/env";
import { parsePeriodKey, type Period, resolvePeriod } from "@/lib/period";
import { getSiteDashboard, type SiteDashboard, UmamiError } from "@/lib/umami/stats";
import { ServiceDashboardView } from "@/components/dashboards/service-dashboard";
import { SiteDashboardView } from "@/components/dashboards/site-dashboard";
import { DemoHeader } from "@/components/demo/demo-header";
import { DemoNotice } from "@/components/demo/demo-notice";
import { PeriodPicker } from "@/components/metrics/period-picker";

export const metadata: Metadata = { title: "Tenant view" };
// Rendered per request: DEMO_TENANT_SLUG and the data are read at run time,
// never at build time (where the demo is off and the page would be a fixed 404).
export const dynamic = "force-dynamic";

// Public demo of the tenant dashboards, with no session and read-only
// (docs/dev/portal.md). Two modes, chosen by the server environment, never by the request:
// - DEMO_TENANT_SLUG empty: sample data from src/lib/demo-sample.ts. Nothing is
//   read from the database or from Umami.
// - DEMO_TENANT_SLUG set: the web panel of each website and the API panel of
//   each service of that tenant (requireDemoContext); unknown or not active, 404.
// The only request value used is the period.
type WebSection = { id: string; name: string; domain: string; data: SiteDashboard | null };
type ApiSection = { id: string; name: string; data: ApiServiceDashboard | null };

async function tenantSections(period: Period): Promise<{ name: string; web: WebSection[]; api: ApiSection[] }> {
  const ctx = await requireDemoContext();
  const key = `${ctx.tenantId}:${period.key}`;
  const [sites, services] = await Promise.all([
    cachedDemo(`sites:${ctx.tenantId}`, () => listSites(ctx)),
    cachedDemo(`services:${ctx.tenantId}`, () => listApiServices(ctx)),
  ]);
  const [web, api] = await Promise.all([
    Promise.all(
      sites.map((site) =>
        cachedDemo(`web:${key}:${site.id}`, () => getSiteDashboard(ctx, site.id, period)).catch((error: unknown) => {
          if (!(error instanceof UmamiError)) throw error;
          // The detail stays in the log only.
          console.error("Demo: failed to read the web dashboard", error.message);
          return null;
        }),
      ),
    ),
    Promise.all(services.map((service) => cachedDemo(`api:${key}:${service.id}`, () => getServiceDashboard(ctx, service.id, period)))),
  ]);
  return {
    name: ctx.name,
    web: sites.map((site, i) => ({ id: site.id, name: site.name, domain: site.domain, data: web[i]! })),
    api: services.map((service, i) => ({ id: service.id, name: service.name, data: api[i]! })),
  };
}

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const period = resolvePeriod(parsePeriodKey((await searchParams).period));
  const sample = !env.demoTenantSlug;
  const { name, web, api } = sample
    ? {
        name: SAMPLE_PROJECT.name,
        web: [{ ...SAMPLE_SITE, data: sampleSiteDashboard(period) }],
        api: [{ ...SAMPLE_SERVICE, data: sampleServiceDashboard(period) }],
      }
    : await tenantSections(period);

  return (
    <section>
      <DemoNotice sample={sample} />
      <DemoHeader
        title={name}
        picker={<PeriodPicker className="" current={period.key} href={(k) => `/demo?period=${k}`} />}
      >
        What an enrolled project sees: its own websites and API services, and nothing from any other project.
      </DemoHeader>

      {web.length === 0 && api.length === 0 && (
        <p className="mt-6 text-muted">The demo project has no website or API service yet.</p>
      )}

      {web.map((site) => (
        <section key={site.id} aria-labelledby={`site-${site.id}`} className="mt-14 border-t border-border pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id={`site-${site.id}`} className="text-xl font-semibold tracking-tight">
              Web analytics
            </h2>
            <p className="text-sm text-muted">
              {site.name} on <span className="font-mono">{site.domain}</span>
            </p>
          </div>
          {site.data ? (
            <SiteDashboardView period={period} data={site.data} />
          ) : (
            <p role="alert" className="mt-6 text-muted">
              Web analytics is unavailable right now. Try again in a few minutes.
            </p>
          )}
        </section>
      ))}

      {api.map((service) => (
        <section key={service.id} aria-labelledby={`service-${service.id}`} className="mt-14 border-t border-border pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id={`service-${service.id}`} className="text-xl font-semibold tracking-tight">
              API analytics
            </h2>
            <p className="text-sm text-muted">{service.name}</p>
          </div>
          {service.data ? (
            <ServiceDashboardView period={period} data={service.data} />
          ) : (
            <p role="alert" className="mt-6 text-muted">
              API analytics is unavailable right now. Try again in a few minutes.
            </p>
          )}
        </section>
      ))}
    </section>
  );
}
