# Anti-bot and supply chain

This document describes two stellytics defenses and, for each one, what it prevents and what it does **not** prevent. Everything here was read in the code on `main`; where a control depends on an action outside the repository, that is stated. The account and GitHub items (Renovate app, private vulnerability reporting, branch protection) cannot be verified in the code: they are recorded by the maintainers. Did the code change? Update the document along with it.

- [Part 1: anti-bot and anti-inflation](#part-1-anti-bot-and-anti-inflation)
- [Part 2: supply chain](#part-2-supply-chain)
- [Gaps and actions outside the code](#gaps-and-actions-outside-the-code)

Related: [`architecture.md`](architecture.md), [`privacy.md`](privacy.md), [`deploy.md`](deploy.md), [`SECURITY.md`](../SECURITY.md), [ADR 0002](decisions.md#0002-architecture-and-stack).

---

## Part 1: anti-bot and anti-inflation

### Threat

Visit statistics are only worth something if they are hard to inflate. Whoever wants to inflate a project's numbers (to look more used, or to pollute a competitor's dashboard) only needs to send events to the public ingestion endpoint (`POST /e`, in [`services/ingest-web/handler.go`](../services/ingest-web/handler.go)). The site ID (a UUID) is not a secret: it is in the HTML of whoever installs the script.

stellytics does not try to tell "human" from "robot" with certainty. The strategy is to **make fake traffic more expensive** and to **limit the damage** from each origin, with no cookie, no storage and without keeping the full IP (see [`privacy.md`](privacy.md)).

### Layers, in the order the gateway applies them

`event` in [`handler.go`](../services/ingest-web/handler.go) runs the checks in this order. The values below are the defaults from [`internal/config/config.go`](../services/ingest-web/internal/config/config.go). Only some are adjustable in production: [`prod.yaml`](../infra/compose/prod.yaml) passes only `PROOF_SECRET`, `RATE_LIMIT`, `RATE_BURST` and `FINGERPRINT_LIMIT` to the container (through `INGEST_*` in the `.env`); changing the others requires editing `prod.yaml`.

| # | Layer | Where | Default limit | Adjustable in production | Response when it fails |
|---|---|---|---|---|---|
| 1 | Rate limit per truncated IP (token bucket, in memory) | [`internal/limit`](../services/ingest-web/internal/limit/limit.go) | `RATE_LIMIT` 20 events/s, `RATE_BURST` 40 | yes (`RATE_LIMIT`, `RATE_BURST`) | `429` |
| 2 | Content type and body size | `handler.go` | `text/plain` or `application/json`; body of up to 16 KiB (`maxBody`) | no (constant) | `415` / `413` |
| 3 | Proof of JavaScript execution | [`internal/proof`](../services/ingest-web/internal/proof/proof.go) | `PROOF_BITS` 12, `PROOF_TTL` 10 min | only the secret; `PROOF_BITS` and `PROOF_TTL` are not | `204`, event dropped |
| 4 | Site exists and accepts ingestion | [`internal/site`](../services/ingest-web/internal/site/site.go) (view `ingest_site`) | cache of at most 1 min (`SITE_CACHE_TTL`) | no | `204`, event dropped |
| 5 | Limit of distinct fingerprints per IP and site | [`internal/fingerprint`](../services/ingest-web/internal/fingerprint/fingerprint.go) | `FINGERPRINT_LIMIT` 50 per `FINGERPRINT_WINDOW` of 10 min | only `FINGERPRINT_LIMIT`; the window is not | `204`, event dropped |
| 6 | Relay to Umami with a rebuilt payload | [`internal/relay`](../services/ingest-web/internal/relay/relay.go) | only `website`, `hostname`, `url`, `referrer`, `title`, `language`, `screen`; optional: `RELAY_MAX_INFLIGHT` simultaneous relays (default 0, off) and `RELAY_QUEUE_WAIT` 250 ms ([ADR 0011](decisions.md#0011-umami-relay-limit)) | yes (off by default) | `204` when the relay limit is on and there is no free slot; the event is lost |

Failures of layers 3, 4 and 5 answer `204`, the same as success, so as not to hint at which rule blocked the event or whether a site exists (E2 spec, section 6, in [`e2-tenants-and-access-control.md`](specs/e2-tenants-and-access-control.md)). This applies only to those layers; other responses from `handler.go` are visible to whoever tests:

| Response | When |
|---|---|
| `400` | unreadable client IP, invalid JSON or fields outside the limits (`relay.Decode`), `s` of `GET /c` that is not a UUID |
| `413` | body larger than 16 KiB |
| `415` | content type other than `text/plain` and `application/json` |
| `429` | rate limit per truncated IP |
| `503` | failure querying `ingest_site` (the gateway lets no event through without checking the site) |
| `502` | failure relaying to Umami |
| `204` (saturation) | no relay slot within `RELAY_QUEUE_WAIT`; the event is dropped and counted in the aggregated log |

Saturation answers `204`, just like the drops by site and fingerprint, which avoids telling them apart by the status. Timing differences between the paths may still give hints. `GET /c` goes through the rate limit and does not query `ingest_site`.

### Proof of JS execution (`internal/proof`)

How it works:

1. The script requests `GET /c?s=<website>`. The gateway returns a token and the number of bits required.
2. The token has 32 bytes: issue time, 8 random bytes and an HMAC-SHA-256 truncated to 16 bytes. The HMAC covers the `website` and uses the `PROOF_SECRET` key (minimum of 32 characters, validated in `config.go`), with domain separation (`stellytics-proof-v1`). In production, the secret comes from `INGEST_PROOF_SECRET` ([`infra/compose/prod.yaml`](../infra/compose/prod.yaml), value in `.env.production`).
3. The script searches for a nonce such that `SHA-256(token + ":" + nonce)` starts with `PROOF_BITS` zero bits (`solve` in [`packages/tracker/src/tracker.ts`](../packages/tracker/src/tracker.ts), using `crypto.subtle`) and sends `p:{t,n}` in each event.
4. `Issuer.Verify` checks format, signature (constant-time comparison with `hmac.Equal`), validity (`PROOF_TTL` from 1 min to 1 h, tolerance of 1 min for a clock running ahead) and the work. The proof is never relayed to Umami.

With 12 bits, the browser does on average about 4 thousand hashes per proof, which is imperceptible; each proof costs milliseconds of CPU. What limits the volume is not the proof, it is the rate (1) and fingerprint (5) layers, and the limits below.

Accepted ranges and values that turn controls off (validated in `config.go`; the gateway does not start with a value outside the range):

| Variable | Range | Effect of an extreme value |
|---|---|---|
| `PROOF_BITS` | 0 to 24 | `0` removes the cost of the proof (the signed token is still required) |
| `PROOF_TTL` | 1 min to 1 h | the larger, the longer a token can be reused |
| `PROOF_SECRET` | 32 characters or more, or empty | empty: `main.go` draws a random key and warns in the log; the tokens are not valid across restarts or across replicas. `prod.yaml` requires the secret (`INGEST_PROOF_SECRET`) |
| `FINGERPRINT_LIMIT` | 0 to 1000 | `0` turns the fingerprint layer off |
| `FINGERPRINT_WINDOW` | 1 min to 24 h | sliding window of the count |
| `RATE_LIMIT`, `RATE_BURST` | greater than 0 | no value turns the rate limit off |
| `SITE_CACHE_TTL` | 0 to 1 min | `0` queries the database on every event |
| `SITE_STALE_TTL` | 0 to 1 h | `0` (default) turns it off; above that, the expired answer for a known site stays valid for that long when the database fails. **Risk window:** a tenant removed or a site archived during the outage keeps accepting events for up to `SITE_CACHE_TTL` + `SITE_STALE_TTL` |

**What the proof prevents:** `curl`, scripts that repeat a `POST /e` without going through the challenge, and traffic forged with a site's ID without ever having loaded the script's flow. A token for one site is not valid for another (the HMAC covers the `website`).

**What the proof does NOT prevent** (the package's own comment says it is not a barrier that cannot be bypassed):

- **Bots that execute JavaScript**, such as headless browsers (Playwright, Puppeteer) or any program that reimplements the `GET /c` flow plus the hash computation. For them the proof costs a few milliseconds. The proof removes the cheap traffic and makes the rest more expensive; it does not tell a person from a machine.
- **Reuse of the token within its validity.** The token is not single-use and is not bound to an IP: the gateway does not keep issued tokens (it is stateless). The same token and nonce are valid for any number of events during `PROOF_TTL`. What limits this is layer 1 (rate per IP) and layer 5 (fingerprints).
- **Pages outside HTTPS.** Without `crypto.subtle` (outside HTTPS or `localhost`) the script cannot get the proof and the events are not sent (`fetchProof` returns null). It is the safe choice, but it means that a tenant with a plain HTTP site records no visits.
- **Old script version.** v1.0.0 has no proof and the gateway drops its events. v1.1.0 is the one that works ([tracker guide](dev/tracker.md)).
- **Events coming from another origin.** The CORS of `POST /e` is open (`Access-Control-Allow-Origin: *`, in `handler.go`) and the gateway does not check `Origin`; the `hostname` in the payload is whatever the client says. Whoever has a site's ID and runs the full flow can record visits "to that site" from anywhere. The only defense against this is the volume one (layers 1, 3 and 5).

### Fingerprints per IP (`internal/fingerprint`)

For each pair (truncated IP, site), the `Counter` accepts up to `FINGERPRINT_LIMIT` distinct fingerprints in a sliding window of `FINGERPRINT_WINDOW`. The fingerprint is the hash (SHA-256, 8 bytes) of `User-Agent`, `Accept-Language`, language and screen, and exists only in memory (nothing goes to the database or to the log). A fingerprint already seen in the window always passes; new ones beyond the limit are dropped with `204`. The count is separate per site, so that a robot does not exhaust the quota of the sites of other tenants that share the same IP or CGNAT.

**What it prevents:** a robot that changes the User-Agent on every request, from a single IP, does not inflate the metrics beyond the first 50 fingerprints per window.

**What it does NOT prevent:**

- **Botnets and rotating proxies.** The limit is per truncated IP (last octet of IPv4, /48 in IPv6). Whoever uses many IPs, on different networks, gets one quota per IP.
- **False positives.** A network with many people (CGNAT, school, company) can have more than 50 distinct combinations in 10 minutes within the same /24; the excess visits vanish from the metrics. The limit is an adjustable trade-off, not a truth.
- **Persistence.** The state is in memory, per process. Restarting the gateway resets the counts, and with more than one replica each one counts separately. Production has one instance today ([`prod.yaml`](../infra/compose/prod.yaml)), so the second point does not show up yet.

### Rate limit (`internal/limit`)

Token bucket per truncated IP (20 events/s with a burst of 40, by default), in memory, with cleanup of keys idle for more than 10 minutes. It applies to `POST /e` and to `GET /c`. For the same reason as above, it is per process and does not stop a distributed attack. Trust in the client IP depends on `TRUSTED_PROXIES` (`X-Forwarded-For` is only valid when it comes from them; see `internal/clientip`).

### What the gateway never trusts from the client

The payload relayed to Umami is built again with seven fields. The client's `ip`, `userAgent`, `id` and `timestamp` are never relayed: Umami would accept them and the client could change the IP or the session. Umami receives the already truncated IP through the `CLIENT_IP_HEADER` header.

### Anti-inflation on the API

The API flow does not use the JS proof: authentication is the ingest key, and `tenant.id` always comes from it, never from a client attribute (see [`e5-api-pipeline.md`](specs/e5-api-pipeline.md) and `services/collector/components/ingestkeyauth` and `tenantattr`). This prevents one tenant from writing metrics on behalf of another; it does **not** prevent a tenant from sending false numbers about its own service. The key can be revoked in the portal (`/services`) and the revocation takes effect within 60 s (cache `INGEST_KEY_CACHE_TTL`). The cap of 500 routes per service and day (`{other}`) limits the cardinality a client can create.

### How the anti-bot is tested

- Go tests for each package (`proof_test.go`, `fingerprint_test.go`, `limit_test.go`); in the tests, `proof.Solve` plays the role of the script.
- Script tests in `packages/tracker/test/`.
- The gateway e2e (`services/ingest-web/e2e/`, CI `compose` job) exercises the full flow with a real database and Umami.

There is no load test and no measurement of the false positive rate on real traffic. The default limits are conservative estimates, to be calibrated with the pilots (E8).

---

## Part 2: supply chain

### Threat

stellytics serves a script that runs on each tenant's site and images that process data from several projects. The attacks that matter: a tampered script delivered to the tenants' visitors (as in attacks on third-party CDNs), a malicious dependency published and adopted right afterwards, a compromised CI action, and an image swapped at deploy.

### Controls applied in the repository

| Control | What it does | Where it is |
|---|---|---|
| **Pinned-version, immutable script** | Each version lives at `/s/vX.Y.Z/n.js` with a one-year cache and `immutable`; the gateway never alters the file. The script does not update itself: the tenant changes the path and the hash in its own HTML. | `packages/tracker/published/`, `services/ingest-web/handler.go` (`script`, serves `SCRIPT_DIR` with `os.Root`) |
| **SRI (sha384) per version** | Hash of each version in `published/sri.json`, used in the `integrity` of the installation snippet (with `crossorigin="anonymous"`). If the served file changes, the browser refuses it. | `packages/tracker/published/sri.json`, `packages/tracker/README.md`, `examples/README.md` |
| **Immutability verified in CI** | `test/published.test.ts` fails if a published file changes, if the SRI of a folder is missing, or if the current code does not match the version in `package.json` (this includes an esbuild update that changes the output). The tracker's `pnpm release` refuses to overwrite a version. | `packages/tracker/test/published.test.ts`, `packages/tracker/scripts/release.ts` |
| **Names that ad blockers do not block** | Prevents the script and the endpoints from being blocked (and tenants from being tempted to host their own copies, without SRI). The `adblock` workflow downloads EasyList, EasyPrivacy, the default uBlock Origin lists and Peter Lowe's list and fails if any of them blocks `/s/vX.Y.Z/n.js`, `/e` or `/c`. It runs on PRs that touch the script or the routes, on `main` and every day. It is outside the `ci` aggregator on purpose (the lists change without a change in the code). | `.github/workflows/adblock.yml`, `packages/tracker/scripts/check-adblock.ts`, `packages/tracker/docs/ad-blockers.md` |
| **Locked dependencies** | `pnpm-lock.yaml` and `services/go.sum` committed; CI installs with `pnpm install --frozen-lockfile`, and so does the portal's `Dockerfile`. Exact versions in the `package.json` files. | `.github/workflows/ci.yml`, `apps/portal/Dockerfile`, `CONTRIBUTING.md` |
| **14-day wait** | pnpm refuses releases less than 14 days old (`minimumReleaseAge: 20160`, in minutes) and Renovate only proposes releases at least 14 days old (`minimumReleaseAge` and `internalChecksFilter: strict`). It gives the community time to find and pull a malicious version. Critical or high fixes can receive a specific, documented exception ([runbook](runbooks/vulnerabilities.md)); pnpm requires its own exception. The OTel Collector modules are upgraded together, in the same release. | `pnpm-workspace.yaml`, `renovate.json`, `docs/dev/constraints.md` |
| **Renovate** | Updates by PR, `rangeStrategy: pin`, `gomodTidy`, major version only after approval in the Dependency Dashboard (security updates go straight through, as long as the repository's security alerts are active, which is an account action), Umami never grouped nor automatic, Postgres with no major version jump, actions grouped. The `docker-compose` manager reads `infra/compose/*.yaml`. | `renovate.json` |
| **Actions pinned by SHA** | Every `uses:` in the workflows has the commit SHA, with the tag in a comment (`helpers:pinGitHubActionDigests` maintains this). Minimal permissions per workflow (`contents: read`, raised only in the jobs that need it, such as `id-token: write` for signing). | `.github/workflows/ci.yml`, `release.yml`, `adblock.yml`, `dependencies.yml` |
| **Images by digest** | Base images in the `Dockerfile`s (`node`, `golang`) and in Compose (`postgres`, `umami`, `mailpit`, `caddy`, `otel/opentelemetry-collector`) pinned by tag and digest. The production Postgres image (Debian) as well. The final Go images are `scratch`: only the binary, with no shell or package manager. Go compiles with `-trimpath` and `CGO_ENABLED=0`. | `apps/portal/Dockerfile`, `services/*/Dockerfile`, `infra/compose/*.yaml`, `infra/compose/postgres/Dockerfile` |
| **OSI-approved licenses** | Project rule: every dependency needs an OSI license. It has already weighed on decisions (TimescaleDB, TSL license, discarded in [ADR 0002](decisions.md#0002-architecture-and-stack); OpenTofu in place of Terraform, BUSL license, in [ADR 0004](decisions.md#0004-hosting-and-backup), later removed together with the IaC in [ADR 0016](decisions.md#0016-production-on-a-vps)). The repository is MIT. | `CONTRIBUTING.md`, `LICENSE`, ADRs |
| **Vulnerability scanning** | Three checks, once a day and also on `main` and on PRs that touch manifests, lockfiles or the Go version in the `Dockerfile`s (without a manifest change, only the daily run catches a new advisory). `govulncheck` (golang.org/x/vuln v1.9.0) in `services/`, with the Go from the `Dockerfile`s (it is its standard library that goes to production), fails only on a vulnerability **reachable** by the code. `pnpm audit --prod` fails on `high` or `critical`; `moderate` and `low` are only listed. A second pass without `--prod` only **lists** what is in devDependencies (informational, does not fail), because build tools such as the esbuild of `packages/tracker`, which generates the `n.js` served to all tenants, are outside `--prod`. The script distinguishes "found something" from "could not query" (network, registry down): both leave the job red, but it never turns green silently. | `.github/workflows/dependencies.yml`, `scripts/deps/audit-pnpm.mjs` |
| **License check** | Allowlist of OSI-approved SPDX ids in `scripts/licenses/allowed.json`, checked against the production dependencies of pnpm (`pnpm licenses list --prod`) and of Go (`go-licenses` v2.0.1, Apache-2.0, only packages that go into the binaries). It fails with the list of packages and licenses outside the list. No license, `UNLICENSED`, `Unknown` and an invalid expression fail; `OR` (dual license) passes if one alternative is allowed, `AND` requires all of them. A one-off exception only with a reason, date and expiry in the same file. An empty list is an error, not "zero dependencies". | `.github/workflows/dependencies.yml`, `scripts/licenses/`, `scripts/deps/check-licenses.mjs`, `CONTRIBUTING.md` |
| **Release with SBOM** | When a release is published, the workflow generates an SPDX SBOM of the repository (syft) and attaches it to the release. | `.github/workflows/release.yml` (job `sbom`) |
| **Signed and attested images** | For each `Dockerfile` in `apps/*` and `services/*`, it publishes to GHCR with the version tag and the commit tag, signs with **keyless** cosign (GitHub Actions OIDC identity) and attaches the image's SBOM as an attestation, all by digest. | `.github/workflows/release.yml` (job `image`) |
| **Own images at deploy** | By default `deploy.sh` builds the portal, gateway, collector and rollup from the checkout (`docker compose up --build`). The signed release images can be used by digest (`PORTAL_IMAGE`, `INGEST_WEB_IMAGE`, `COLLECTOR_IMAGE`, `ROLLUP_IMAGE`), but **nothing checks the signature at deploy**: it is a weaker control than verifying before bringing the stack up. | `deploy.sh`, `infra/compose/prod.yaml`, [`deploy.md`](deploy.md) |
| **Vulnerability reporting channel** | Policy, deadlines by severity (3 business days to confirm, 14 days for a critical) and scope; it includes the `/s/vX.Y.Z/` script in the supported versions. | [`SECURITY.md`](../SECURITY.md) |

How to verify a published image and the attested SBOM: see the [`README.md`](../README.md), section "CI and supply chain".

### Dependencies and review

- **Review by PR.** Every Renovate update becomes a PR and goes through CI (lint, types, tests, `go vet`, `go test -race`, tests with Compose). Umami, which is the most sensitive third-party component, is only upgraded through a reviewed PR, with a release at least two weeks old ([project constraints](dev/constraints.md)).
- **Few dependencies on the critical path.** The gateway and the rollup are Go with few libraries and a `scratch` image; the browser script has no runtime dependency (it is bundled with esbuild).

### Honest limits of the supply chain

- **The signature proves origin, not the absence of bugs.** A `cosign verify` (done by hand; the deploy does not run it) confirms that the image came out of `release.yml` on a `v*` tag of the repository. If the repository or a maintainer account is compromised and a release is published, the image will come out signed. The defense there is account protection (2FA) and review, which are outside the code.
- **Dependency scanning does not have full reach.** `pnpm audit` and `govulncheck` only know advisories already published (nothing against a new malicious dependency; for that there is the 14-day wait). `pnpm licenses` reads the `node_modules` of the CI platform: optional dependencies for other platforms (native macOS or Windows binaries) are not checked and may have a license different from the main package (`sharp` is Apache-2.0, but `@img/sharp-libvips-*` is LGPL-3.0-or-later). `pnpm audit --prod` does not cover devDependencies; the informational pass lists them, but does not block, and the esbuild that generates the tracking script is a case where this matters. `govulncheck` shows traces from `loadtest` and `internal/pgtest` as examples of reachability; I do not filter them, because the report is the same and the vulnerability is also reachable by the services' code. `go-licenses` classifies by the text of the license file; a module without a file shows up as `Unknown` and fails. The `dependencies` workflow is outside the `ci` aggregator (the result changes without a change in the code), so it does not block merges and depends on someone looking at the red.
- **`main` has no branch protection**, by a maintainer decision: CI runs but does not block merges or direct pushes. A direct push to `main` does not go through review. If protection is turned on, require only the `ci` check.
- **Third-party images do not have their signature checked.** Umami, Caddy and the other third-party images have only a pinned digest. The production Postgres is built on the host itself (`docker compose up --build`) from a base by digest, with no signature.
- **`cosign verify` does not tie the digest to a specific release.** It checks identity (workflow `release.yml` on a `v*` tag) and issuer, not which release the digest should be; whoever uses the release images chooses the digest to fill into `PORTAL_IMAGE` etc.
- **The identity regex accepts any `v*` tag**, not only those of approved releases. Whoever can create a tag and publish a release (write permission on the repository) produces an accepted image.
- **Builds are not verified as reproducible.** There are steps that help (`-trimpath`, lockfiles, bases by digest, `CGO_ENABLED=0`), but the `apt-get install` of `curl` in `infra/compose/postgres/Dockerfile` has no pinned version (it changes with the Debian repository), no job rebuilds the image and compares the digest, and the portal build (Next.js) has not been assessed in this respect. We do not claim bit-for-bit reproducibility. The SBOMs and the attestation give traceability, not reproducibility.
- **The SBOM is not checked automatically.** It is published and attested, but no step compares it against a vulnerability database.
- **There is no automatic license check or vulnerability scanning in CI.** The OSI license rule is a review rule (CONTRIBUTING). There is no `pnpm audit`, `govulncheck`, Dependency Review or equivalent in the workflows; what catches a known vulnerability today is Renovate (security update) once it is installed. See the next section.
- **The 14-day wait reduces the risk, it does not eliminate it.** A malicious version that goes unnoticed for more than 14 days gets installed. Renovate security updates skip this wait on purpose, for the other side of the same risk.
- **Images pinned by digest go stale.** A pinned digest means that security fixes to the base image only come in through a Renovate PR (or by hand).
- **The four own images are not verified at deploy:** `portal`, `ingest-web`, `collector` and `rollup` are built from the checkout by default; passed by digest, they come from the signed release, but without `cosign verify` ([ADR 0016](decisions.md#0016-production-on-a-vps)).
- **SRI only protects those who use it.** A tenant that omits the `integrity` attribute from the snippet receives the script unchecked (even so, the gateway only serves immutable files). `integrity` is in the examples and in the script's README, but there is no way to force it.
- **If the `ingest_host` is compromised**, the served script can change, and only SRI (when the tenant uses it) stops the swap. The mitigations are the `scratch` image and `published/` kept immutable by a test; the deploy does not require a signed image.

---

## Gaps and actions outside the code

| Item | State | Action |
|---|---|---|
| Renovate app | **Not installed.** `renovate.json` has no effect without it (pending item of #55). Without Renovate, there is no automatic update PR, nor security alert, and the 14-day rule applies only to pnpm. | Account action: install the app at github.com/apps/renovate for this repository and validate the Dependency Dashboard. |
| Private vulnerability reporting | Only exists on a public repository. | Turn on *Settings, Code security, Private vulnerability reporting* when opening the repository (pending item of #56). |
| Protection of `main` | Off by decision. | If turned on, require the `ci` check and review. |
| 2FA and protection of maintainer accounts | Cannot be verified from the repository. | Organization action. |
| Reproducible build verification | Does not exist. | [#136](https://github.com/romulospl/stellytics/issues/136) (verified reproducible builds). |
| Calibration of the anti-bot limits | Defaults not measured with real traffic. | Calibrate in the pilots (E8). |
| Gateway replication | In-memory limits per process. | If there is more than one replica, move the counters to shared storage or accept the quota per replica. |

## Summary of the criteria of issue #41

- **Anti-bot strategy described with the limits used:** Part 1 lists each layer, the default value and the variable that changes it, plus what each one does not prevent.
- **Supply chain measures described and applied in the repository:** Part 2 points to the file of each measure. Applied in the repository: immutable script with SRI, lockfiles, 14-day wait, `renovate.json`, actions by SHA, images by digest, SBOM and signed images (the deploy does not verify the signature: by default it builds from the checkout). **Depend on action outside the code:** installing the Renovate app and the account and branch protections. **Also applied:** vulnerability scanning (`govulncheck`, `pnpm audit`) and license checking against an OSI allowlist, in the `dependencies` workflow. **Does not exist yet:** verified reproducible build; this is stated above instead of promised.
