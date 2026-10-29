# Health check

The app answers whether it and its PostgreSQL database are up. Kubernetes probes and anyone checking the server use it.

## Sub-features

- `health-ok` answers `200` with `{"status":"ok","database":"ok"}` when the database is reachable.
- `health-degraded` answers `503` with `{"status":"degraded","database":"unreachable"}` when it is not.

## How to get to it (user POV)

- `GET /api/health` from a browser, curl or a probe.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`.

- **Healthy.** Request the endpoint. Run `curl -s -i <appUrl>/api/health > .verify/<run-id>/evidence/health.http.txt`. The file shows `HTTP/1.1 200 OK` and body `{"status":"ok","database":"ok"}`.
- **Degraded.** Not drivable through this skill: the launcher owns PostgreSQL and there is no user path to take it down mid-run. Report `health-degraded` as not driven. No automated test covers it yet either.

## Gotchas

- `doctor.ts` already calls this endpoint. Its `HEALTHY` is not proof of this feature on its own; save the curl response as evidence.
- After PostgreSQL drops connections the app logs `PostgreSQL dropped an idle connection` and keeps serving. That line is expected, not a failure.
