# Project constraints

Rules that are not obvious from reading the code. Read the relevant guide in [`docs/dev/`](.) before changing a component.

## RFP scope

The RFP defines the project's scope. Official source: SCF handbook repository, `scf-awards/build-award/rfp-track.md` (id `scf-web-api-analytics`); a local copy may exist at `docs/RFP_Web_and_API_Analytics_for_Stellar_Ecosystem_Projects.md` (excluded from git). **Implement only what the RFP asks for; nothing beyond it.**

- Every new feature, component, cloud service or configuration must point to the RFP section that requires it (for example, "3.3: 24-month retention"). Cite the section in the PR.
- Also allowed: the RFP's listed nice-to-haves (custom events, Stellar Wallets Kit capture) and whatever is needed to meet a requirement: tests, documentation, IaC, runbooks, monitoring, security, privacy and the handover to a new operator (sections 3.4 and 5).
- Do not implement what the RFP does not ask for, even if it looks like good practice: extra portal features, integrations, cloud services or hardening beyond what a requirement needs (for example, a dedicated KMS key for backups). In code review, do not suggest additions outside the RFP as fixes.
- If a task seems to require something outside the RFP, ask the maintainers before implementing.

## Constraints

- **Dependency age:** only releases at least 14 days old (pnpm `minimumReleaseAge`, Renovate, GitHub Actions pinned by SHA). Pin exact versions.
- **Licenses:** production dependencies must have an [OSI](https://opensource.org/licenses)-approved license, with specific, temporary exceptions for build dependencies in `scripts/licenses/allowed.json` (see `CONTRIBUTING.md`). That is why TimescaleDB (TSL) is not used.
- **Umami pinned to v3.4.1**, used without a heavy fork; changes are minimal, documented patches (`docs/umami.md`). Upgrade only by PR, with a release at least two weeks old. Umami is never published (no port, no Caddy route).
- **Tenant isolation:** the tenant always comes from the session (portal) or the ingest key (collector), never from a client value. Portal data access only through `src/lib/data/` and `src/lib/umami/` with a context from `src/lib/access.ts`; ESLint enforces it. Another tenant's resource answers 404. Isolation must be covered by automated tests on web and API (#21).
- **The full IP is never persisted.** The gateway truncates it (last IPv4 octet, /48 for IPv6) before geolocation. No cookies or browser storage; Umami session recording and heatmaps are off. No log carries IP, `X-Forwarded-For` or `User-Agent`.
- **The collector drops traces, spans and logs:** none of them may be persisted.
- **Tracking script is immutable per version** (`/s/vX.Y.Z/<name>.js`, with SRI). Script names and endpoints must not contain terms blocked by ad blockers (`umami`, `analytics`, `track`, `collect`).
- **Route normalization** uses fixed rules in code: numeric IDs, Stellar G-/C-/M- addresses, UUIDs, hex hashes and trailing slash. A client-sent `http.route` takes priority.
- **Secrets:** a full ingest or read key exists only in its creation response: never in logs, the database or error messages.
- **`audit_log`** is insert-only; erasure (#154) may only replace `actor_user_id` with `[erased]`.
- **Never set `SEED_DEV_DATA` in production** or put dev seed SQL in `drizzle/`.
- **Pending maintainer decision:** do not enable `RELAY_MAX_INFLIGHT` in production (ADR 0011).
