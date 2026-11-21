# Privacy and GDPR

This document describes what the platform does with personal data, from reading the code on `main`, and lists what does not exist yet. It is **not legal advice**: the roles (controller and processor) and the points of attention per jurisdiction are a **proposal to validate with legal counsel**, and what was not checked is marked as such. It addresses issue [#40](https://github.com/romulospl/stellytics/issues/40).

Conventions: "verified" means the statement was checked against the code or configuration cited next to it. "Not verified" means it depends on third-party behaviour (Umami, the SMTP provider, the VPS and S3 storage providers) or on something the repository does not have yet.

Sections verified directly in the code: 3.1 (`tracker.ts`, `relay.go`), 3.3 (`auth.ts`, `schema.ts`) and 4 (`clientip.go`). The others combine code, specs and ADRs, as stated in each one.

## 1. Summary

- **Visitors of tenant sites (web analytics):** no cookie, no `localStorage`/`sessionStorage`, no persistent identifier in the browser. The full IP is never stored: the gateway truncates it before relaying to Umami.
- **Visitors of the portal itself:** the public home page (`/`) loads the same tracking script, with the same handling as tenant sites, when the public demo uses a real project (`DEMO_TENANT_SLUG`). That project's numbers are public at `/demo`; they are aggregates, with no per-visitor data.
- **Tenant API calls (API analytics):** only counters and histograms per route, method and status, every minute. Traces, spans and logs are dropped.
- **Portal users (email, name, hashed password):** these are personal data and live in the `stellytics` database. The portal does not store the IP of whoever signs in.
- **Where they would live:** in the region of the VPS and of the S3 backup bucket that the operator chooses; the proof of concept runs in **Brazil** and production moves to an **EU region** in Tranche 1.
- **Erasure:** exists now (#154), with three paths: the user deletes their own account at `/settings` (their project and the collected data go with it); the SCF operator erases the data of a removed project; and automatic retention deletes web events older than 183 days (section 6). What does not exist is erasing *the data of one specific visitor* without erasing the whole site: section 7 explains why.

## 2. Roles (proposal to validate)

| Data | Who decides purpose and means (proposed) | Platform's role (proposed) |
|---|---|---|
| Visitor events from the tenant's sites and the tenant's API metrics | The project (tenant), which installs the script or OpenTelemetry | **Processor** |
| Portal account (email, name, password, sessions) | The platform itself | **Controller** |
| `audit_log` and operation records (project removal, keys) | The platform | **Controller** |

Consequences to handle with legal counsel, **not resolved here**: who is the legal entity that operates the instance (the repository is open source; whoever hosts it takes on the role), a data processing agreement (DPA) with each tenant, the text of the portal's privacy notice and guidance to tenants on the notice they must give their own visitors. SCF operators see data from every project (section 5); the relationship between the SCF and each tenant also needs to be defined.

## 3. What is collected and where it lives

### 3.1 Web analytics

The `packages/tracker` script sends one page view per load (and per route change in an SPA) with these fields (`packages/tracker/src/tracker.ts`): `website` (site ID), `hostname`, `url` (path plus only the `utm_*` parameters; the rest of the query string is discarded), `referrer` (origin and path, without query or fragment; empty if it is the same page), `title`, `language` (`navigator.language`) and `screen` (width x height). The JS execution proof goes along with it, and the gateway does not relay it.

The gateway (`services/ingest-web/internal/relay/relay.go`) rebuilds the payload with only these fields and relays it to Umami with the original `User-Agent` and the **already truncated** IP in a header. It never relays `ip`, `userAgent`, `id` or `timestamp` sent by the client.

Umami (v3.4.1, unpatched, `docs/umami.md`) stores the events in the `umami` database. What Umami creates from them (session, browser, operating system, device, country/region/city from geolocation of the truncated IP) is **Umami behaviour and was not read here**. It was only verified that the session's country comes from the truncated IP and that the full IP does not appear in any text column of the `umami` and `stellytics` databases (`services/ingest-web/e2e/privacy_test.go`, runs in the CI `compose` job).

Two points of attention: `url` and `title` are data that the tenant's page defines. A path such as `/profile/maria@example.com` or a title with a person's name would be stored. The script already discards the query string (except `utm_*`), but the tenant should avoid personal data in paths and titles.

### 3.2 API analytics

The collector (`services/collector`) authenticates by the ingest key, stores the key's tenant and ignores whatever the client says about it. The `stellyticspg` exporter turns HTTP server spans and the duration metric into per-minute points in the `api_metric_1m` table: tenant, service, normalized route, method, status, count, sum of durations and histogram (`docs/specs/e5-api-pipeline.md`, section 4). Traces, spans and logs are dropped and are not stored. There is no IP or end-user identifier in the columns.

Point of attention: the route is text. Numeric segments, UUIDs, Stellar addresses and hex hashes become placeholders (`{id}`, `{uuid}`, `{address}`, `{hash}`), but another segment carrying personal data (for example `/users/maria`) would be stored as received, and an `http.route` sent by the client is used as received. Partial mitigation: a cap of 500 routes per service and day, then `{other}`.

### 3.3 Portal accounts

Tables `user`, `account`, `session` and `verification` (`apps/portal/src/lib/db/schema.ts`):

- `user`: name, email, role and dates. `account`: hashed password (Better Auth). `tenant_member`: the link between the user and the project.
- `session`: token, expiry and **`user_agent`**. `ip_address` is always null, because the `databaseHooks.session.create.before` hook in `apps/portal/src/lib/auth.ts` clears it. That is, the User-Agent of whoever signs in to the portal **is stored**; the IP is not.
- `verification`: email confirmation and password reset tokens.
- `operator_invite` (ADR 0017): the email of the person invited to be an SCF operator and the SHA-256 of the invite token, only while the invite is pending. The row is deleted when the invite is accepted, cancelled or replaced, and the admin script deletes the expired ones.
- Better Auth uses a session cookie in the portal (needed for login). 7-day session, renewed on each day of use. This applies only to the portal, not to tenant sites.
- The attempt limit per IP (`rateLimit` in `auth.ts`) is in memory, per instance. Whether Better Auth or Next.js logs the IP at some point **was not verified**.

### 3.4 Audit log and keys

`audit_log` receives the action, who did it (`actor_user_id`), tenant, date and `details` (`tenant.created`, `tenant.removed`, `tenant.reactivated`, `operator.created`, `ingest_key.created`, `ingest_key.revoked`, among others). The code and the schema comment say it carries no key, password or IP. The reason for removing a project is free text typed by the operator and goes to `details` and also to `tenant.status_reason`; `tenant.status_changed_by` stores the operator (foreign key to `user` with `onDelete: set null`), that is, deleting the operator clears that field, but not the `actor_user_id` of the `audit_log`. The table only accepts inserts (triggers in `apps/portal/drizzle/0002_ingest_views.sql` and `0009_erasure.sql` against UPDATE, DELETE and TRUNCATE) and has no foreign key, on purpose: it survives the deletion of the user or the tenant.

**Single exception (#154):** the trigger in `0009_erasure.sql` accepts one change and only that one — replacing an existing `actor_user_id` with the `[erased]` marker, without touching the other columns. That is what account deletion runs: the person's actions stay in the history, but no longer point to them, whose row has left the database. The isolation test (`apps/portal/test/isolation.test.ts`) checks that any other change, DELETE and TRUNCATE are still refused and that the marker in the code is the same as the trigger's.

The full ingest key is never stored; only the prefix and the SHA-256 (`ingest_key`), and `last_used_on` stores only the date.

### 3.5 Email

The portal sends through SMTP (`apps/portal/src/lib/mail.ts`, variable `SMTP_URL`) only two messages, in plain text: email confirmation and password reset. On failure, the log carries only the error type, without recipient or body. Which SMTP provider will be used in production **is not defined in the repository** (`.env.production.example` leaves `SMTP_URL` empty). The provider will be a sub-processor: it must be in the declared region (section 6) or have transfer safeguards, and this **was not verified**. There is no marketing email.

### 3.6 Logs and memory

- **Gateway:** no log carries IP, `X-Forwarded-For` or `User-Agent`; a panic is logged with `path` and `fmt.Sprint(v)` (`handler.go`, `recoverPanic`), where `v` is an arbitrary panic value: it carries no IP by design, but the content is not controlled. The log level is the `slog` default (Info), so the `Debug` "event dropped" logs are off. No response sets a cookie. The request limit per IP and the fingerprint count (hash of User-Agent, `Accept-Language`, language and screen) use the **truncated** IP, only in memory and for a short window (`internal/limit`, `internal/fingerprint`).
- **Caddy:** does not configure an access log; error logs go to the container's stderr with IP, port, headers, URI and TLS data removed by the filter in `infra/caddy/Caddyfile`. Host-wide logs may follow the system's default configuration.
- **Collector:** when the query on `ingest_key_active` fails, the log carries the key prefix (`ingestkeyauth/auth.go`), which is the public part and is not personal data; the full key is not logged. A read of all the collector's logs **was not done**.
- **Portal:** the Better Auth logger is at `warn` (`auth.ts`), and email sending logs only the error type.
- **Containers:** in production they use `json-file` with 20 MB per file and 5 files (`x-logging` in `infra/compose/prod.yaml`). Rotation is by size, not by time, so there is no fixed retention period for the logs. The content of the Umami and Postgres logs **was not verified**.

## 4. IP truncation

`services/ingest-web/internal/clientip/clientip.go`, function `Truncate`: zeroes the last octet of IPv4 (`203.0.113.77` becomes `203.0.113.0`) and everything after the `/48` of IPv6; IPv4 mapped in IPv6 is treated as IPv4. Tested in `clientip_test.go`. The full IP exists only in the request's memory. `X-Forwarded-For` only counts when it comes from `TRUSTED_PROXIES` (Caddy on the Docker network in production). Honest limit: a truncated IPv4 still identifies a network of up to 256 addresses, and the full `User-Agent` still goes to Umami. Whether this set is "personal data" depends on the legal assessment and on what Umami stores (not verified).

## 5. Who has access

- Each tenant sees only its own data; the tenant always comes from the session (ADR 0003, suite `apps/portal/test/isolation.test.ts`).
- The SCF operator has global read access (dashboards `/operator`, `/operator/web`, `/operator/api`) and today only writes to remove and reactivate a project. Operators are created only by admin command, directly or through an email invite that the command creates (ADR 0017), and each step writes to the `audit_log`.
- Umami stays on the internal network only: no published port and no Caddy route (`docs/umami.md`, #62). Session recording and heatmaps are off, and there is a test (`TestRecorderRecordsNothing`).
- Whoever administers the VPS and the database over SSH also has access to everything. There is no documented access control beyond the admin tunnel (`docs/deploy.md`); access process and logging **not verified**.

## 6. Data residency and retention

**Where they live** ([ADR 0016](decisions.md#0016-production-on-a-vps)): in the region of the VPS and of the S3 backup bucket that the operator chooses; the repository fixes neither provider nor region. The proof of concept (`stellytics.xyz`) runs in **Brazil**, without pilots; production moves to an **EU region** in Tranche 1, and that change has not been made yet. The RFP requires declaring the residency: the operator must decide and declare the region (for example, EU) before receiving data. WAL-G backups leave the VPS **encrypted on the client** (`WALG_LIBSODIUM_KEY`, kept outside the VPS). External monitoring (ADR 0005) runs on a separate host, also chosen by the operator, and, according to the ADR, serves to check availability; **I did not verify** whether any analytics data reaches it. The VPS and S3 storage providers are sub-processors; their contract and the location of their support **not verified**.

**How long they stay:**

| Data | Retention | Source |
|---|---|---|
| `api_metric_1m` | 35 days, by `DROP` of the monthly partition | migration `0005_api_metric_rollup.sql`, E5 spec |
| `api_metric_1h`, `api_metric_1d` | 25 months | same |
| Web events in Umami | **183 days, about six months** (#154): the rollup job (`services/rollup`) deletes older events and sessions, with `UMAMI_DATABASE_URL` and `UMAMI_RETENTION_DAYS` | `services/rollup/main.go`, `docs/umami.md` |
| Account, sessions, sites, keys | Deleted when the user deletes their own account (`/settings`) or when the operator erases a removed project (#154) | `src/lib/data/erasure.ts` |
| `operator_invite` | Until it is accepted, cancelled or replaced; expired ones are deleted on the next run of the admin script (the link is valid for 3 days) | `scripts/operator.mjs`, ADR 0017 |
| `audit_log` | Forever, **anonymized** on account deletion: `actor_user_id` becomes `[erased]`, the only change the trigger accepts (migration `0009_erasure.sql`) | schema |
| Backups | WAL-G: the newest `WALG_RETAIN_FULL` (default 7) base backups plus the continuous WAL between them, encrypted on the client. Erased data stays in the backups until it leaves the window | `infra/compose/postgres/backup.sh`, ADR 0016 |

The rollup service (`services/rollup`) and the collector have been in `infra/compose/prod.yaml` since 16 November 2026 (ADR 0012). The API retention described above is implemented and tested, but no real production has been applied yet. The Caddy vhost does not configure an access log and logs only critical errors; so the headers, including the ingest key (`Authorization`), are not written by the proxy.

## 7. Right to erasure and other rights

The issue asks for the justification for having no erasure flow because "no personal data is stored". After reading the code, the sentence holds only in part, and the document promises no more than that. **As of 17 November 2026 the flows below exist** (issue #154); what remains open is marked.

**Site visitors (web analytics):**

- The browser stores no identifier (no cookie or storage), the gateway does not relay the client's `id` and the full IP is not stored. **How Umami 3.4.1 derives the `session_id` (checked in the version's source code, tag `v3.4.1`, `src/app/api/send/route.ts` and `src/lib/crypto.ts`):** `uuid5(sha512(website_id, ip, user_agent, salt, distinct_id, APP_SECRET))`, where `ip` is the already truncated one and the salt rotates monthly (`SALT_ROTATION`, default `month`). That is: it is a pseudonym **derived from truncated IP plus User-Agent**, encrypted with the server's secret — it is not an anonymous identifier, and a set of truncated IP plus User-Agent is probably personal data. There is no `distinct_id` here: the gateway never relays the client's `id`.
- Practical consequence for individual erasure: **there is no way to map a visitor's request ("erase my data") to database rows**, because neither the tenant nor the platform knows which `session_id` belongs to that person (unless they identify it themselves, which does not happen). The erasure paths that apply:
  1. **Automatic retention:** events and sessions leave after 183 days (`services/rollup`, `docs/umami.md`).
  2. **Erase the whole site:** when the operator removes the project or the owner deletes their account, all sites leave Umami (`DELETE /api/websites/:id`) with everything they collected.
  3. **One specific visitor**, in the unlikely case that they present their `session_id` or an identifiable slice: a manual procedure by whoever administers the database (`DELETE` on `website_event`/`session` by `session_id`); no screen and no automatic process — recorded in the checklist in section 9.
- Archiving a site (`site.archived_at`) stops ingestion and takes the site off the dashboards; erasing the collected data is the project erasure flow, which removes the site from Umami entirely.

**Portal users (controller: the platform):**

- **Deleting one's own account exists:** the portal's `/settings` page, with confirmation by typing the email (`src/app/(private)/settings/`). It deletes, in order: the project's sites in Umami (if the user owns it), site/service/key rows, the API metrics (`api_metric_purge_tenant`, migration `0009`), the SCF read keys created by the user, and finally the user's row — session, password and membership go by cascade. The project stays in the database as `removed`, without data, and its history stays readable.
- **Audit_log:** all of the user's actions (`tenant.purged`, the `account.deleted` itself and the earlier ones) get `actor_user_id = [erased]`, the only change the trigger accepts. The project's `status_changed_by` becomes null through the foreign key.
- **Rectification (changing name or email), portability, restriction and objection: still have no screen or process.** Today the request is handled by hand by whoever administers the database; a documented process for data subject requests remains in the checklist (section 9, item 7).
- **A request to correct data in the `audit_log`** remains impossible by design: the trigger accepts only the replacement of `actor_user_id` with the marker.

**SCF operator:** the project page, at `/operator/tenants/[id]`, has "Erase project data" for `removed` projects (it does not apply to active or pending ones), with confirmation by typing the slug. The action is the same as account deletion, without deleting the user.

**Known limits of the flows:**

- **Backups:** erased data stays in the backups until it leaves the window (`WALG_RETAIN_FULL`, section 6). A restore brings back what existed at the target time; there is no "erase in the backups too".
- **Concurrency:** the sites leave Umami before the database; if the database part fails, repeat the whole operation (the DELETE in Umami treats 404 as success). Events that arrive between the site's DELETE and completion are deleted by Umami along with the site.
- **Projects with more than one member:** today there are no invites and each user belongs to a single project; deleting the owner's account erases their project. If invites are implemented, the rule needs review.

## 8. Jurisdictions: provisional list (proposal)

The issue asks for the list of jurisdictions where the solution would not be compliant without opt-in. **This criterion is met only partially:** there is no legal conclusion in the repository, and this document does not invent one. Below is a **provisional list, to validate with legal counsel**, which separates where there is a specific consent regime for device access (the starting point of the question) from what was not analysed.

What the code does, verified: the script neither writes nor reads a cookie, `localStorage` or `sessionStorage` and stores no identifier in the browser (`packages/tracker/src/tracker.ts`). It reads `navigator.language`, `screen`, `document.title` and `document.referrer` and sends them.

**To review first (consent regime for device access, conclusion open):**

| Jurisdiction | Point to review |
|---|---|
| EU/EEA (GDPR and ePrivacy directive, art. 5(3)) | Whether reading `language` and `screen` and sending truncated IP and `User-Agent` to Umami requires consent or a legal basis. **Open** |
| Germany (TDDDG, formerly TTDSG) and France (CNIL guidance on audience measurement) | Their own guidance, with conditions for waiving consent. The conditions (such as a retention limit) **were not checked here**; the retention of Umami events (183 days, section 6) is already implemented, but the full list of conditions **was not checked against it** |
| United Kingdom (UK GDPR and PECR) | Analogous regime, with ICO guidance; **not verified** |

**Not analysed** (they may have their own privacy or consent rules): Brazil (LGPD), California (CCPA/CPRA), Switzerland and other jurisdictions. Applicability and classification, including the fact that the code does not send data to advertising third parties (verified only in the gateway and the portal), do not replace that analysis.

There is no basis in the repository to conclude, either way, whether consent is required or not. Each tenant that installs the script decides whether to show a notice or banner; this project does not offer opt-in.

There is no transfer out of the VPS region by the code: the gateway only talks to the internal Umami. Tenants in another jurisdiction send visitor data to the region the operator chooses (section 6); this, and any transfer by sub-processors (SMTP, backup), needs analysis.

## 9. Checklist of what to verify with legal counsel

1. Operating legal entity, roles from section 2 and DPA with tenants (and with the SCF).
2. Qualification of truncated IP (/24, /48) plus User-Agent as personal data or not.
3. Need for consent per jurisdiction (section 8).
4. ~~Retention of Umami events and conclusion on the permanent `audit_log`.~~ Implemented (#154): 183 days for events (`docs/umami.md`) and `audit_log` anonymized on account deletion (sections 3.4 and 7). **Missing:** the legal validation of the 183-day period and of the marker.
5. Sub-processors: the VPS and S3 storage providers (to be chosen), the SMTP provider and, if any, the monitoring one.
6. Portal privacy notice and template text for tenants.
7. Process for data subject requests: **still open** — automatic erasure exists (section 7), but there is no documented process for individual requests (rectification, portability, one specific visitor).
8. How Umami derives and persists the `session_id` and the other session fields (truncated IP, `User-Agent`, salt), and whether that allows or waives an erasure flow for visitors. **Derivation checked in the v3.4.1 source code** (section 7): `uuid5(sha512(website_id, ip, user_agent, salt, distinct_id, APP_SECRET))`, salt rotating monthly. **Missing:** the legal conclusion on the set.
9. `audit_log` trigger and requests for correction or erasure (section 3.4): **partially resolved** — the only accepted change is anonymization on account deletion; correcting content remains impossible by design.

## 10. Files checked

`services/ingest-web/internal/clientip/clientip.go`, `services/ingest-web/internal/relay/relay.go`, `services/ingest-web/internal/fingerprint/fingerprint.go`, `services/ingest-web/handler.go`, `services/ingest-web/main.go` (logs), `services/ingest-web/e2e/privacy_test.go` (read the header and the IP test), `packages/tracker/src/tracker.ts`, `apps/portal/src/lib/auth.ts`, `apps/portal/src/lib/mail.ts`, `apps/portal/src/lib/db/schema.ts`, `apps/portal/src/lib/data/operator/tenants.ts`, `apps/portal/src/lib/data/erasure.ts`, `apps/portal/src/app/(private)/settings/`, `infra/caddy/Caddyfile`, `infra/compose/prod.yaml` (list of services), `docs/decisions.md#0004-hosting-and-backup`, `docs/umami.md`, `docs/specs/e5-api-pipeline.md` and `docs/specs/e2-tenants-and-access-control.md` (passages on retention and removal). On 17 November 2026 (#154): the Umami 3.4.1 source code (`src/app/api/send/route.ts`, `src/lib/crypto.ts`, `src/queries/sql/sessions/createSession.ts`, tag `v3.4.1`) for the `session_id` derivation, and the schema of the `umami` database (tables `session` and `website_event`, checked on a database of that version).

**Not read or tested:** the Umami code beyond the `session_id` derivation (how it stores events and geolocation), the `0002` and `0005` migrations in SQL (only the summaries in the specs), the full code of the collector and the exporter, real execution logs, the real SMTP and monitoring configuration.
