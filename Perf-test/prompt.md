# Initial Prompt

You act as an automation performance tester with 20+ years of experience writing scalable performance testing code.

I need to create a framework for performance testing with two parts:

1. **API performance testing** — a sample set of 20 APIs to load test.
2. **User journey performance testing** — 4 user journeys, where each journey simulates a
   different user flow through multiple APIs. The number of (virtual) users per journey should be
   configurable, with these as the starting defaults:
   - Journey 1: 10 users
   - Journey 2: 20 users
   - Journey 3: 30 users
   - Journey 4: 5 users

Requirements:

- The **base URL**, the individual **endpoints**, the **ramp-up time**, and everything else that would normally change between environments or runs should be **configurable**, not hardcoded.
- I should be able to **run all APIs at once**, or **run just a single API** and get a result for that one — make this customizable/selectable per run.
- I plan to use **k6** (the open source performance testing tool). Guide me on setting this up and on building a **test summary reporting** framework around it.
- I need to be able to set a **threshold for each API individually**:
  - If a threshold is **not configured** for an API, it should **pass** (no threshold = no failure condition).
  - If a threshold **is configured**, check the condition against the actual result and **fail** the test if it's breached.

## Tooling

- Performance test runner: **k6** (open source), written so the same scripts can also run on **Azure Load Testing** (which uses k6 as its scripting engine) if we later want managed/cloud execution — avoid anything that only works with the local OSS CLI.
- Reporting: produce an **HTML test summary report** (plus raw JSON) after every run — recommend and use whatever open-source k6 reporting approach fits best (e.g. a k6-reporter-style HTML dashboard via `handleSummary`), on top of a custom pass/fail summary per API/journey.
- Keep it self-contained for local runs (no Grafana/InfluxDB required) — Azure Load Testing is an optional execution target, not a hard dependency.

## Project structure

Lay it out as a proper, reusable framework, not a single script — something like:

```
perf-test/
├── .github/
│   └── workflows/
├── config/
├── src/
│   └── lib/
├── scripts/
│   ├── api-test.js
│   └── journey-test.js
└── results/
```

- `.github/workflows/` — GitHub Actions CI pipeline for this framework
- `config/` — base-URL/env config, API catalog, journey definitions, thresholds
- `src/lib/` — shared code: config loading, HTTP wrapper, scenario + threshold builders,
  report generation — reused by both test entry points
- `scripts/` — the k6 entry points (`api-test.js`, `journey-test.js`) plus the CLI wrapper
  to run everything (pick API/journey, pass overrides)
- `results/` — generated reports, one folder per run

- Config (base URL, endpoints, VUs, ramp-up/duration, thresholds) should live in its own files,
  separate from the test logic, so non-developers can tune a run without touching code.
- Test logic should be generic/data-driven — one reusable script per test type (API vs. journey),
  not one script per endpoint.
- Include a CLI or script-based way to trigger a run (choose API vs. journey, choose one/subset/
  all, pass overrides) rather than editing files every time.

## Other details

- Document everything in a README: how to install k6, how to configure it, how to run it, how thresholds work, how to read the report.
- Add a **GitHub Actions** workflow that runs this automatically on push/PR (and supports a manual
  trigger to pick API vs. journey and which target to run), uploads the HTML/JSON reports as a
  build artifact, and fails the job on a threshold breach — reusing the same non-zero exit code,
  no extra parsing needed.
- Give me a quick example run against a public demo API so I can see it working end to end before pointing it at our real service.

Please design and build this as a scalable, reusable performance testing framework — not a one-off script
