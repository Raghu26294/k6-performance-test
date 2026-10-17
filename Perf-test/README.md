# Perf-Test — k6 Performance Testing Framework

A config-driven [k6](https://k6.io) framework covering two testing styles:

1. **API load tests** — 10 sample API definitions, each independently runnable or run all together.
2. **User journey tests** — 4 multi-step journeys simulating real user flows, each with its own configurable virtual-user (VU) count (defaults: 10 / 20 / 30 / 5).

Everything that typically changes between environments or runs — base URL, per-API/per-journey VUs, ramp-up/steady/ramp-down time, and thresholds — lives in JSON config, not code, and can be overridden from the CLI without touching files.

## Requirements

- [k6](https://k6.io/docs/getting-started/installation/) (`brew install k6` on macOS)
- Internet access on first run (the HTML report pulls [k6-reporter](https://github.com/benc-uk/k6-reporter) from a CDN)

## Project layout

```
Perf-test/
├── config/
│   ├── env.json        # base URL + defaults
│   ├── apis.json       # API defs + thresholds
│   └── journeys.json   # journeys: vus, steps
├── src/lib/             # config, http, scenarios,
│                        # thresholds builders
├── src/lib/report/      # handleSummary.js
├── tests/
│   ├── api-test.js      # API test entry point
│   └── journey-test.js  # journey entry point
├── scripts/
│   └── run.sh           # CLI wrapper
├── .github/workflows/
│   └── perf-test.yml    # CI pipeline
└── results/
    └── <RUN_ID>/        # reports per run
```

- `config/env.json` — base URL per environment + global defaults (vus, duration, ramp times).
- `config/apis.json` — 10 API definitions (method, path, body, optional vus/duration/thresholds).
- `config/journeys.json` — 4 journeys (vus, ramp times, ordered steps, optional thresholds).
- `src/lib/` — `config.js`, `http.js`, `scenarios.js`, `thresholds.js`: shared test-building logic.
- `src/lib/report/handleSummary.js` — pass/fail table, optional phase breakdown, k6-reporter HTML.
- `tests/api-test.js` / `tests/journey-test.js` — entry points (select one, many, or all).
- `scripts/run.sh` — CLI wrapper: validates names, applies overrides, runs api/journey/both.
- `.github/workflows/perf-test.yml` — CI: installs k6, runs `run.sh`, uploads `results/` as an artifact.
- `results/<RUN_ID>/` — HTML + JSON reports, one timestamped folder per run.

## Quick start

```bash
# all APIs, using defaults from config/
./scripts/run.sh api all

# a single API
./scripts/run.sh api getUserById

# a subset
./scripts/run.sh api getUsers,getPosts,createPost

# all 4 journeys (10/20/30/5 VUs respectively, as configured)
./scripts/run.sh journey all

# a single journey, with overrides
./scripts/run.sh journey browseJourney --vus 25 --ramp-up 30s --duration 2m

# api + journey together, reports land in the same results/<RUN_ID>/ folder
./scripts/run.sh both all

# include the per-phase timing breakdown (Blocked/Connecting/TLS/Sending/Waiting/Receiving)
./scripts/run.sh api getPostComments --breakdown
```

Each run opens its HTML report automatically (local interactive shells only; skipped in CI).

Or call k6 directly (what `run.sh` wraps):

```bash
k6 run tests/api-test.js -e API=getUserById -e VUS=10 -e RAMP_UP=10s -e DURATION=30s -e RAMP_DOWN=10s
k6 run tests/journey-test.js -e JOURNEY=all -e ENV=staging
```

## Configuring the base URL and environments

`config/env.json`:

```json
{
  "defaultEnv": "dev",
  "environments": {
    "dev": { "baseUrl": "https://jsonplaceholder.typicode.com" },
    "staging": { "baseUrl": "https://staging.example.com" },
    "prod": { "baseUrl": "https://api.example.com" }
  },
  "defaults": { "vus": 5, "duration": "30s", "rampUpTime": "10s", "rampDownTime": "10s", "thinkTime": "1s" }
}
```

Switch environments with `--env staging` (or `-e ENV=staging`), or bypass the file entirely with `--env-url`/`-e BASE_URL=https://...` for a one-off endpoint. The sample config points at the public `jsonplaceholder.typicode.com` API so the framework runs out of the box — **swap in your real `baseUrl` values before testing your own service.**

## Adding / editing APIs

Each entry in `config/apis.json` is independent:

```json
{
  "name": "createPost",
  "method": "POST",
  "path": "/posts",
  "body": { "title": "perf-title", "body": "perf-body", "userId": 1 },
  "vus": 10,
  "duration": "30s",
  "rampUpTime": "10s",
  "thresholds": {
    "http_req_duration": ["p(95)<700"],
    "checks": ["rate>0.98"]
  }
}
```

- `vus` / `duration` / `rampUpTime` / `rampDownTime` are optional — omit any to fall back to `config/env.json`'s `defaults`.
- `thresholds` is **optional and opt-in**. See below.
- Run just this one: `./scripts/run.sh api createPost`.

## Adding / editing journeys

Each entry in `config/journeys.json` is an ordered list of API names (by `name` from `apis.json`), executed in sequence per iteration with think-time between steps:

```json
{
  "name": "contentCreationJourney",
  "vus": 20,
  "rampUpTime": "20s",
  "steadyTime": "1m",
  "rampDownTime": "10s",
  "thinkTime": "1.5s",
  "steps": ["createPost", "createComment", "updatePost", "getPostById"],
  "thresholds": { "http_req_duration": ["p(95)<1200"], "checks": ["rate>0.95"] }
}
```

The four sample journeys and their default VU counts:

| Journey | VUs | Steps |
|---|---|---|
| `browseJourney` | 10 | getUsers → getUserById → getUserPosts → getPostComments |
| `contentCreationJourney` | 20 | createPost → createComment → updatePost → getPostById |
| `albumPhotoJourney` | 30 | getAlbums → getAlbumById → getAlbumPhotos → getPhotoById |
| `adminCleanupJourney` | 5 | getTodos → getTodoById → deleteTodo → deleteUser |

Change VUs per journey directly in the config, or override at the CLI for a single run with `--vus`.

## Thresholds — pass by default, fail only when configured

This is enforced, not just a convention:

- An API/journey **with no `thresholds` block** always reports **PASS** — k6 has no failing condition attached to it, by design.
- An API/journey **with a `thresholds` block** is enforced for real: if `http_req_duration{api:name}` or `checks{api:name}` breaches the configured condition, k6 exits non-zero and the summary table marks it `FAIL`.
- Under the hood (`src/lib/thresholds.js`), un-configured entries still get a trivially-true synthetic threshold (`avg>=0`) — this is purely so k6 emits a per-API/per-journey sub-metric into the report (k6 only reports tag-filtered metrics that appear in `options.thresholds`). It can never fail the build; it exists only so every API/journey gets a real latency row in the report even when you haven't set an SLA for it yet.

Supported fields per entry: `thresholds.http_req_duration` (array of k6 threshold expressions, e.g. `["p(95)<500","avg<200"]`), `thresholds.checks` (e.g. `["rate>0.99"]`), `thresholds.http_req_failed` (e.g. `["rate<0.01"]`).

## Reports

Every run writes to its own `results/<RUN_ID>/` folder (e.g. `results/20261017-221905/`), named by the run's start timestamp, so separate runs never overwrite each other's output:

- `api-report.html` / `journey-report.html` — custom dashboard: one row per API/journey with min/avg/median/p90/p95/max latency, request count, req/s, error %, checks %, the threshold that was applied (or "not configured (auto-pass)"), and PASS/FAIL. Pass `--breakdown` to also include a second table splitting each entry's response time into Blocked/Connecting/TLS/Sending/Waiting (TTFB)/Receiving, plus the dominant phase — useful for tracing *where* a slow response is actually going.
- `api-k6-report.html` / `journey-k6-report.html` — full [k6-reporter](https://github.com/benc-uk/k6-reporter) dashboard (all metrics, checks, thresholds).
- `api-summary.json` / `journey-summary.json` — raw k6 end-of-test summary (for CI pipelines / further processing).
- `api-rows.json` / `journey-rows.json` — just the custom table rows, machine-readable.
- Colored text summary printed to stdout.

`run.sh` opens the relevant report(s) automatically when run interactively on a local machine (skipped in CI, or when stdout isn't a terminal).

CI integration: k6 exits non-zero when any configured threshold is breached, and `run.sh` now correctly propagates that exit code, so `./scripts/run.sh api all` (or any variant) is a valid CI gate as-is — no extra parsing needed to fail the build. See `.github/workflows/perf-test.yml` for a starter workflow that runs this on push/PR and uploads `results/` as a build artifact.

## Sample results

From `./scripts/run.sh api all` against the sample `jsonplaceholder.typicode.com` config (your own service's numbers will differ):

| API | Avg | p95 | Max | Req/s | Threshold | Status |
|---|---|---|---|---|---|---|
| getPosts | 13.01ms | 15.67ms | 16.07ms | 1.50/s | p(95)<800 | PASS |
| getPostById | 9.72ms | 12.02ms | 12.13ms | 1.50/s | p(95)<500 | PASS |
| getPostById2 | 10.91ms | 12.81ms | 13.23ms | 1.50/s | p(95)<500 | PASS |
| getPostComments | 10.95ms | 15.68ms | 19.80ms | 1.50/s | p(95)<600 | PASS |
| createPost | 299.59ms | 498.81ms | 734.35ms | 1.18/s | p(95)<700 | PASS |
| updatePost | 305.76ms | 508.99ms | 754.38ms | 1.18/s | p(95)<700 | PASS |
| patchPost | 297.41ms | 492.60ms | 728.29ms | 1.18/s | p(95)<600 | PASS |
| deletePost | 301.21ms | 502.06ms | 742.83ms | 1.18/s | p(95)<500 | **FAIL** |
| getPostById3 | 14.30ms | 28.25ms | 55.69ms | 1.50/s | p(95)<1 | **FAIL** |
| getPostById4 | 21.41ms | 66.83ms | 163.65ms | 1.50/s | p(95)<500 | PASS |

`deletePost` and `getPostById3` failed here on purpose/by design in this sample — `getPostById3`'s threshold (`p(95)<1`) is intentionally unachievable to demonstrate what a real FAIL looks like end-to-end (non-zero exit code, report marked FAIL), and `deletePost` shows a genuine threshold breach caused by the public demo API's latency variance, not a bug in the framework.

With `--breakdown`, every row above also gets a response-time phase split. For most of these GET/PUT/PATCH/DELETE calls the dominant phase is **Waiting (TTFB)** — i.e. the bottleneck is the server's own response time, not DNS/TLS/network overhead:

| API | Blocked | Connecting | TLS | Sending | Waiting (TTFB) | Receiving |
|---|---|---|---|---|---|---|
| getPosts | 6.43ms | 1.07ms | 2.80ms | 0.08ms | 11.69ms | 1.24ms |
| createPost | 7.87ms | 1.36ms | 3.19ms | 0.25ms | 298.77ms | 0.57ms |

## CLI override reference

| Flag | Env var equivalent | Applies to |
|---|---|---|
| `--env <name>` | `-e ENV=<name>` | which `config/env.json` environment's `baseUrl` to use |
| `--base-url <url>` | `-e BASE_URL=<url>` | overrides `baseUrl` directly, bypassing `env.json` |
| `--vus <n>` | `-e VUS=<n>` | overrides VUs for every selected API/journey |
| `--ramp-up <dur>` | `-e RAMP_UP=<dur>` | overrides ramp-up stage duration, e.g. `20s` |
| `--duration <dur>` | `-e DURATION=<dur>` | overrides steady-state stage duration, e.g. `1m` |
| `--ramp-down <dur>` | `-e RAMP_DOWN=<dur>` | overrides ramp-down stage duration |
| `--breakdown` | `-e BREAKDOWN=1` | adds the per-phase timing breakdown table to the HTML report |

`run.sh` validates the requested API/journey name(s) against config before invoking k6, so a typo fails immediately with the list of valid names instead of a confusing empty run. The first positional argument can be `api`, `journey`, or `both` (runs both, into the same `results/<RUN_ID>/` folder).

## CI/CD

[`.github/workflows/perf-test.yml`](.github/workflows/perf-test.yml) runs the suite on GitHub Actions:

- **Triggers**: every push to `main`, every pull request, and manual runs via `workflow_dispatch` (with `mode` and `target` inputs, defaulting to `api` / `all`).
- **Job (`k6`, on `ubuntu-latest`)**: checks out the repo → installs k6 from the official apt repo → runs `./scripts/run.sh <mode> <target>` with `CI=true` (so it never tries to open a browser) → uploads the entire `results/` folder as a build artifact named `k6-results`, even when the run fails.
- **Pass/fail gate**: the workflow has no separate assertion step — it relies on `run.sh` propagating k6's real exit code (see "Thresholds" above), so a configured threshold breach fails the GitHub Actions job directly.
- **Getting results from a CI run**: open the workflow run in the Actions tab → download the `k6-results` artifact → it contains the same `results/<RUN_ID>/` folder (HTML reports, JSON summaries) you'd get locally.
- **Running a specific target from GitHub**: Actions tab → "Performance Tests" → "Run workflow" → set `mode` (`api`/`journey`/`both`) and `target` (an API/journey name, comma list, or `all`).

This is an initial workflow — no caching, matrix runs, scheduled nightly runs, or PR-comment/Slack notifications yet.
