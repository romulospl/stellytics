import Link from "next/link";
import { DOCS_URL, SiteShell } from "@/components/site/site-shell";
import { Icon } from "@/components/ui/icons";
import { loadDemoContext } from "@/lib/access";
import { listSites } from "@/lib/data/sites";
import { cachedDemo } from "@/lib/demo-cache";
import { env } from "@/lib/env";
import { trackerScript } from "@/lib/tracker-snippet";

const TRACKS: { title: string; text: string; steps: string[] }[] = [
  {
    title: "Web",
    text: "Pages, visitors, referrers and countries from one script tag.",
    steps: ["Script on your site", "Gateway", "Dashboard"],
  },
  {
    title: "API",
    text: "Requests, errors and latency per route, sent from your app over OpenTelemetry.",
    steps: ["Your API", "Collector", "Dashboard"],
  },
];

const PRIVACY: string[] = [
  "No cookies and no browser storage.",
  "The full IP address is never stored.",
  "Traces, spans and logs are dropped, not kept.",
  "Each project sees only its own data.",
];

// What the gateway and the collector keep for one visit and one request.
function KeepPanel() {
  const row = "grid grid-cols-[5.5rem_1fr] items-baseline gap-x-4 gap-y-1 py-4 sm:grid-cols-[6.5rem_1fr_1fr]";
  const cell = "font-mono text-sm break-all";
  return (
    <figure className="rounded-card border border-border bg-surface shadow-card">
      <figcaption className="border-b border-border px-5 py-3 text-sm font-semibold">
        What stellytics keeps from one visit and one request
      </figcaption>
      <div
        aria-hidden="true"
        className="hidden grid-cols-[6.5rem_1fr_1fr] gap-x-4 px-5 pt-3 text-xs font-medium text-muted sm:grid"
      >
        <span />
        <span>Received</span>
        <span>Stored</span>
      </div>
      <dl className="divide-y divide-border px-5">
        <div className={row}>
          <dt className="text-sm text-muted">Visitor IP</dt>
          <dd className={`${cell} text-muted line-through decoration-bad-fill/70`}>203.0.113.42</dd>
          <dd className={`${cell} col-start-2 sm:col-start-auto font-semibold text-accent-text`}>203.0.113.0</dd>
        </div>
        <div className={row}>
          <dt className="text-sm text-muted">API route</dt>
          <dd className={`${cell} text-muted line-through decoration-bad-fill/70`}>/accounts/GB7B…QXAH/payments/48213</dd>
          <dd className={`${cell} col-start-2 sm:col-start-auto font-semibold text-accent-text`}>/accounts/:address/payments/:id</dd>
        </div>
        <div className={row}>
          <dt className="text-sm text-muted">Cookies</dt>
          <dd className={`${cell} text-muted`}>none</dd>
          <dd className={`${cell} col-start-2 sm:col-start-auto font-semibold text-accent-text`}>none</dd>
        </div>
      </dl>
      <p className="border-t border-border px-5 py-3 text-xs text-muted">Illustrative values. Both rules run before anything is saved.</p>
    </figure>
  );
}

// The demo tenant's site registered for the portal's own host, if any: the
// home page installs the tracker for it (the platform measuring itself).
async function ownSiteId(): Promise<{ demo: boolean; websiteId: string | null }> {
  const ctx = await cachedDemo("demo-context", loadDemoContext);
  if (!ctx) return { demo: false, websiteId: null };
  const sites = await cachedDemo(`sites:${ctx.tenantId}`, () => listSites(ctx));
  const host = new URL(env.authUrl).host;
  return { demo: true, websiteId: sites.find((s) => s.domain === host)?.umamiWebsiteId ?? null };
}

// Public home page.
export default async function Home() {
  const { demo, websiteId } = await ownSiteId();
  const script = trackerScript();

  const outlineButton =
    "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-control border border-border-strong px-6 text-base font-semibold text-fg hover:bg-surface-2";

  return (
    <SiteShell>
      <section className="grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div>
          <h1 className="max-w-[16ch] text-4xl leading-[1.05] font-bold tracking-tight text-balance md:text-6xl">
            See how your Stellar project is used.
          </h1>
          <p className="mt-6 max-w-[56ch] text-lg text-muted md:text-xl">
            stellytics is open-source analytics for the Stellar Community Fund. Projects see their own web and API
            traffic. SCF operators compare all of them in one place.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/demo"
              className="inline-flex min-h-12 items-center justify-center gap-2.5 rounded-control bg-accent px-7 text-base font-semibold text-accent-fg hover:brightness-110"
            >
              <Icon name="play" className="size-4" />
              Open the live demo
            </Link>
            <a href={DOCS_URL} className={outlineButton}>
              <Icon name="doc" className="size-5" />
              Read the docs
            </a>
          </div>
          <p className="mt-4 text-sm text-muted">
            No account needed: the demo shows {demo ? "this site\u2019s own traffic" : "sample data"}.
          </p>
        </div>
        <KeepPanel />
      </section>

      <section id="features" className="scroll-mt-6 border-t border-border py-14 md:py-20">
        <h2 className="max-w-[24ch] text-2xl leading-tight font-bold tracking-tight text-balance md:text-4xl">
          One dashboard for your website and your API.
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {TRACKS.map((track) => (
            <article key={track.title} className="rounded-card border border-border bg-surface p-6 shadow-card md:p-8">
              <h3 className="text-xl font-bold">{track.title}</h3>
              <p className="mt-2 max-w-[44ch] text-muted">{track.text}</p>
              <ol className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium">
                {track.steps.map((step, i) => (
                  <li key={step} className="flex items-center gap-3">
                    <span
                      className={`rounded-control border px-3 py-1.5 ${
                        i === track.steps.length - 1
                          ? "border-accent bg-accent-soft/60 text-accent-text"
                          : "border-border-strong bg-surface-2"
                      }`}
                    >
                      {step}
                    </span>
                    {i < track.steps.length - 1 && <span aria-hidden="true" className="h-px w-6 bg-border-strong" />}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-10 border-t border-border py-14 md:py-20 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="max-w-[20ch] text-2xl leading-tight font-bold tracking-tight text-balance md:text-4xl">
            Private by design.
          </h2>
          <p className="mt-4 max-w-[48ch] text-muted md:text-lg">
            Usage data should not cost your users their privacy. stellytics removes what identifies a person before
            anything reaches the database.
          </p>
        </div>
        <ul className="divide-y divide-border border-y border-border">
          {PRIVACY.map((item) => (
            <li key={item} className="flex items-center gap-4 py-4 text-base">
              <Icon name="check" className="size-5 text-good" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-6 rounded-card bg-art-bg px-6 py-10 text-art-fg md:px-12">
        <div>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Explore a live dashboard.</h2>
          <p className="mt-2 text-art-muted">No account needed.</p>
        </div>
        <Link
          href="/demo"
          className="inline-flex min-h-12 items-center justify-center gap-2.5 rounded-control bg-art-fg px-7 text-base font-semibold text-art-bg hover:brightness-95"
        >
          <Icon name="play" className="size-4" />
          Open the live demo
        </Link>
      </section>
      {websiteId && (
        <script defer src={script.src} integrity={script.integrity} crossOrigin="anonymous" data-site={websiteId} />
      )}
    </SiteShell>
  );
}
