import { type ApiCounts, type ApiServiceDashboard, ENDPOINT_LIMIT } from "@/lib/data/api-metrics";
import { bucketLabel, formatCount, formatLatency, formatShare, statusLabel } from "@/lib/format";
import { ChartFrame } from "@/components/charts/chart-frame";
import { ColumnChart } from "@/components/charts/column-chart";
import { PALETTE } from "@/components/charts/palette";
import { Sparkline } from "@/components/charts/sparkline";
import { MetricCard, MetricStrip } from "@/components/metrics/metric-card";
import { RankedList } from "@/components/metrics/ranked-list";
import { cardClass } from "@/components/ui/card";
import type { Period } from "@/lib/period";
import { LatencyChart } from "./latency-chart";
import { StatusChart } from "./status-chart";

const card = cardClass;
const full = new Intl.NumberFormat("en");
const plural = (n: number, one: string, many: string) => `${full.format(n)} ${n === 1 ? one : many}`;

// Body of the API dashboard of one service (#37): tiles, charts, endpoints and
// status codes. Shared by the tenant page (/services/[serviceId]) and the
// public demo (/demo); it only renders data its caller already read.
export function ServiceDashboardView({ period, data }: { period: Period; data: ApiServiceDashboard }) {
  const { totals, series, endpoints, endpointCount, statuses } = data;
  const unitName = period.unit === "hour" ? "Hour" : period.unit === "day" ? "Day" : "Month";
  const points = series.map((p) => ({ ...p, label: bucketLabel(period.unit, p.at), longLabel: bucketLabel(period.unit, p.at, true) }));
  const statusPoints = points.map((p) => ({
    label: p.label,
    longLabel: p.longLabel,
    ok: Math.max(0, p.requests - p.clientErrors - p.serverErrors),
    clientErrors: p.clientErrors,
    serverErrors: p.serverErrors,
  }));


  return (
    <>
      <MetricStrip className="mt-5">
        <StatTile label="Requests" value={formatCount(totals.requests)} trend={points.map((p) => p.requests)} />
        <StatTile
          label="Server errors (5xx)"
          value={formatShare(totals.serverErrors, totals.requests)}
          note={totals.requests > 0 ? plural(totals.serverErrors, "request", "requests") : undefined}
          trend={points.map((p) => p.serverErrors)}
        />
        <StatTile label="Median latency (p50)" value={formatLatency(totals.p50)} trend={points.map((p) => p.p50)} />
        <StatTile label="p95 latency" value={formatLatency(totals.p95)} trend={points.map((p) => p.p95)} />
      </MetricStrip>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className={card}>
          <h2 className="font-medium">Requests</h2>
          <p className="text-sm text-muted">
            {period.label}, per {period.unit} (UTC), including the current {period.unit}
          </p>
          <div className="mt-4">
            <ColumnChart
              label="Requests per period"
              currentIncomplete
              points={points.map((p) => ({
                label: p.label,
                longLabel: p.longLabel,
                value: p.requests,
                description: `${p.longLabel}: ${plural(p.requests, "request", "requests")}, ${plural(p.serverErrors, "server error", "server errors")}`,
                tooltip: [
                  { value: full.format(p.requests), unit: p.requests === 1 ? "request" : "requests" },
                  { value: full.format(p.serverErrors), unit: "5xx" },
                  { value: full.format(p.clientErrors), unit: "4xx" },
                ],
              }))}
            />
          </div>
        </div>
        <div className={card}>
          <h2 className="font-medium">Latency</h2>
          <p className="text-sm text-muted">
            {period.label}, per {period.unit} (UTC). Gaps are periods without requests.
          </p>
          <div className="mt-4">
            <LatencyChart points={points.map(({ label, longLabel, p50, p95 }) => ({ label, longLabel, p50, p95 }))} />
          </div>
        </div>
      </div>
      <ChartFrame
        className="mt-4"
        title="Responses by status class"
        subtitle={`${period.label}, per ${period.unit} (UTC). OK is every request without a 4xx or 5xx status.`}
        table={
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">{unitName}</th>
                <th className="py-1 text-right font-medium">OK</th>
                <th className="py-1 text-right font-medium">4xx</th>
                <th className="py-1 text-right font-medium">5xx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {statusPoints.map((p) => (
                <tr key={p.longLabel}>
                  <td className="whitespace-nowrap py-1 pr-3">{p.longLabel}</td>
                  <td className="py-1 text-right">{full.format(p.ok)}</td>
                  <td className="py-1 text-right">{full.format(p.clientErrors)}</td>
                  <td className="py-1 text-right">{full.format(p.serverErrors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <StatusChart
          points={statusPoints}
          colors={{ ok: PALETTE.ok, clientErrors: PALETTE.clientError, serverErrors: PALETTE.serverError }}
        />
      </ChartFrame>
      <details className={`mt-4 ${card} text-sm`}>
        <summary className="cursor-pointer text-muted">Show charts as a table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">{unitName}</th>
                <th className="py-1 text-right font-medium">Requests</th>
                <th className="py-1 text-right font-medium">4xx</th>
                <th className="py-1 text-right font-medium">5xx</th>
                <th className="py-1 text-right font-medium">p50</th>
                <th className="py-1 text-right font-medium">p95</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {points.map((p) => (
                <tr key={p.longLabel}>
                  <td className="whitespace-nowrap py-1 pr-3">{p.longLabel}</td>
                  <td className="py-1 text-right">{full.format(p.requests)}</td>
                  <td className="py-1 text-right">{full.format(p.clientErrors)}</td>
                  <td className="py-1 text-right">{full.format(p.serverErrors)}</td>
                  <td className="py-1 text-right">{formatLatency(p.p50)}</td>
                  <td className="py-1 text-right">{formatLatency(p.p95)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className={`${card} min-w-0`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Endpoints</h2>
            <span className="text-xs text-muted">
              {endpointCount > ENDPOINT_LIMIT
                ? `Top ${ENDPOINT_LIMIT} of ${full.format(endpointCount)} by requests`
                : `${plural(endpointCount, "endpoint", "endpoints")}, by requests`}
            </span>
          </div>
          {endpoints.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No data in this period.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm tabular-nums">
                <thead className="border-b border-border text-muted">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Endpoint</th>
                    <th className="py-1.5 pl-3 text-right font-medium">Requests</th>
                    <th className="py-1.5 pl-3 text-right font-medium">4xx</th>
                    <th className="py-1.5 pl-3 text-right font-medium">5xx</th>
                    <th className="py-1.5 pl-3 text-right font-medium">p50</th>
                    <th className="py-1.5 pl-3 text-right font-medium">p95</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {endpoints.map((e) => (
                    <tr key={`${e.method} ${e.route}`}>
                      <td className="min-w-44 max-w-80 py-1.5 pr-3">
                        <span className="block font-mono text-xs text-muted sm:mr-2 sm:inline-block sm:w-14">{e.method}</span>
                        <span className="break-all font-mono text-xs">{e.route}</span>
                      </td>
                      <td className="py-1.5 pl-3 text-right">{formatCount(e.requests)}</td>
                      <td className="py-1.5 pl-3 text-right">{formatShare(e.clientErrors, e.requests)}</td>
                      <td className="py-1.5 pl-3 text-right">{formatShare(e.serverErrors, e.requests)}</td>
                      <td className="whitespace-nowrap py-1.5 pl-3 text-right">{formatLatency(e.p50)}</td>
                      <td className="whitespace-nowrap py-1.5 pl-3 text-right">{formatLatency(e.p95)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            Paths are grouped: IDs, Stellar addresses, UUIDs and hashes become placeholders such as {"{id}"}.
          </p>
        </div>

        <StatusCodes statuses={statuses} total={totals.requests} />
      </div>
    </>
  );
}

function StatTile({ label, value, note, trend }: { label: string; value: string; note?: string; trend?: (number | null)[] }) {
  return (
    <MetricCard label={label} value={value} chart={trend && <Sparkline values={trend} />}>
      {note && <span className="text-muted">{note}</span>}
    </MetricCard>
  );
}

// Status distribution: code, bar and number per row, like the lists of the
// web dashboard. The bar uses the series color; the class (2xx, 4xx...) is written out.
function StatusCodes({ statuses, total }: { statuses: { statusCode: number; requests: number }[]; total: ApiCounts["requests"] }) {
  return (
    <RankedList
      title="Status codes"
      unit="Requests"
      rows={statuses.map((s) => ({
        key: String(s.statusCode),
        name: statusLabel(s.statusCode),
        value: s.requests,
        display: formatCount(s.requests),
        detail: formatShare(s.requests, total),
      }))}
    />
  );
}
