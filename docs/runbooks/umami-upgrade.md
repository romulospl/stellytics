# Runbook: Umami upgrade

Umami is the base tool ([ADR 0001](../decisions.md#0001-base-tool)) and runs **without a patch**, pinned by tag and digest. Rules: [`docs/umami.md`](../umami.md) and [`docs/dev/constraints.md`](../dev/constraints.md) (the version only goes up by PR, with a release at least two weeks old, without a heavy fork).

## Symptoms (when to use)

- Renovate opened a PR for `ghcr.io/umami-software/umami` (its own rule in [`renovate.json`](../../renovate.json): no grouping and no automerge, labels `dependencies` and `umami`; a major version only after it is approved in the Dependency Dashboard).
- A Umami security advisory, or the need for a fix that only exists in the new version.

## Diagnosis (deciding whether to upgrade)

1. Is the release at least 14 days old? Renovate waits (`minimumReleaseAge`); for an urgent security fix, the exception is a decision recorded in the PR, not an automatic one.
2. Read the release notes looking for: database migration, changes to `/api/send`, `/api/websites/:id/...` (`stats`, `pageviews`, `metrics`), to the recorder (`/api/record`, columns `recorder_enabled` and `replay_config`, tables `session_replay`, `session_replay_saved` and `heatmap_event`) and to environment variables.
3. Umami appears in `infra/compose/dev.yaml` and `prod.yaml` (image by digest) and in its own rule in `renovate.json`. Look for every mention of the current version: `grep -rn '3.4.1' docs/ infra/ apps/ services/ packages/ examples/ renovate.json` (adjust the number) and update the texts and tests that cite the version.

## Action

1. In the PR (or on a branch of your own), change the tag and digest in both Compose files. If a patch is needed, it goes in documented in `docs/umami.md`, with the reason and how to reapply it; avoid it.
2. Run in the local environment (`docker compose up -d --wait`, with the override `-f compose.yaml -f infra/compose/umami-port.yaml` when you need the interface):
   - `pnpm --filter @stellytics/portal test` (the portal's Umami is a fake; it tests the client contract);
   - the gateway e2e (`services/ingest-web/e2e/`, which also covers `TestRecorderRecordsNothing`) and the ones in `examples/e2e`: the CI `compose` job runs all of them against the real Umami, and it is what decides;
   - the portal isolation test (`apps/portal/test/isolation.test.ts`) and the collector/ingestion one that CI already runs.
3. If the dashboard uses a new Umami response (`/stats`, `/pageviews`, `/metrics`), compare its shape in the new version with `apps/portal/src/lib/umami/` and with the fake Umami (`apps/portal/test/fake-umami.ts`); remember that in the 3.4.1 `/metrics` the `y` counts visitors.
4. Check `docs/umami.md` (recorder off, port closed) and adjust names that changed.
5. Deploy: the PR goes through the whole CI (the `ci` aggregator, including `infra`) and is merged after human review. In production, once it is merged, update the checkout on the VPS and run `sudo ./deploy.sh`. **Before that**, force a base backup (`systemctl start stellytics-backup`), because Umami migrates its own database on startup and the migration only moves forward (`docs/deploy.md`, "Rollback").

## Verification

- `docker compose -f prod.yaml ps` with `umami` `healthy` (the healthcheck calls `/api/heartbeat`); `docker compose -f prod.yaml logs --tail 100 umami` with no migration error.
- Umami is still closed: step 3 ("Check production") of `docs/deploy.md` (`/api/send` with 404 from outside; Caddy has no route to Umami).
- A test event arrives through the gateway and shows up on the site's dashboard; the SCF dashboard (`/operator/web`) loads.
- Isolation: tenant A does not see B's site (the `isolation.test.ts` suite passed in CI on the new version).
- `docs/umami.md`, `docs/dev/constraints.md` and the other version texts (the `grep` result) reflect the new version. **Do not rewrite ADR 0001 just because of the version**; a new ADR only if the decision changes (for example, a change of tool or a patch).

## Rollback

Reverting the Umami digest without restoring the database only works if the new version did not migrate the schema. If it did, restore the backup taken beforehand ([backup and restore](backup-and-restore.md)) and only then bring up the old digest.

## When to escalate

- The Umami migration fails on startup and the database does not open: restore the preventive backup.
- The new version changes the contract in an incompatible way: do not upgrade; record it in the PR and follow the next version. If the current version has a security flaw with no compatible fix, treat it as a [vulnerability](vulnerabilities.md).

## Not tested

No Umami upgrade has been done in production; Renovate has not yet opened this PR against this repository (the version in use is 3.4.1, and 3.5.x is postponed on purpose, see ADR 0001).
