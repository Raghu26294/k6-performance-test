import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';
import { isRealThreshold } from '../thresholds.js';

// k6 can't create nested directories when writing summary files, so
// scripts/run.sh pre-creates results/<RUN_ID>/ and passes RUN_ID in. Without
// it (e.g. a raw `k6 run`), fall back to the flat results/ dir, which already
// exists, instead of a timestamped path that would fail to open.
const RUN_DIR = __ENV.RUN_ID ? `results/${__ENV.RUN_ID}` : 'results';

function metricValue(metric, statName) {
  if (!metric || !metric.values) return null;
  const v = metric.values[statName];
  return typeof v === 'number' ? v : null;
}

function thresholdsAllOk(metric) {
  if (!metric || !metric.thresholds) return true;
  return Object.values(metric.thresholds).every((t) => t.ok !== false);
}

function fmt(n, suffix) {
  return n === null ? 'N/A' : `${n.toFixed(2)}${suffix || ''}`;
}

// Labelled in the order a request actually moves through them, so the
// dominant-phase pick below reads naturally as "where the time went."
const PHASES = [
  { key: 'http_req_blocked', label: 'Blocked' },
  { key: 'http_req_connecting', label: 'Connecting' },
  { key: 'http_req_tls_handshaking', label: 'TLS' },
  { key: 'http_req_sending', label: 'Sending' },
  { key: 'http_req_waiting', label: 'Waiting (TTFB)' },
  { key: 'http_req_receiving', label: 'Receiving' },
];

function buildPhaseBreakdown(data, tagKey, name) {
  let dominant = { label: 'N/A', avgMs: -1 };
  const values = {};

  for (const { key, label } of PHASES) {
    const metric = data.metrics[`${key}{${tagKey}:${name}}`];
    const avgMs = metricValue(metric, 'avg');
    values[key] = fmt(avgMs, 'ms');
    if (avgMs !== null && avgMs > dominant.avgMs) {
      dominant = { label, avgMs };
    }
  }

  return { values, dominantPhase: dominant.label };
}

// Builds one row per API/journey, pulling real numbers out of k6's summary `data`
// and cross-referencing config to tell a real configured threshold apart from our
// synthetic always-pass one (see src/lib/thresholds.js).
function buildRows(data, entries, tagKey, includeBreakdown) {
  return entries.map((entry) => {
    const durMetric = data.metrics[`http_req_duration{${tagKey}:${entry.name}}`];
    const checksMetric = data.metrics[`checks{${tagKey}:${entry.name}}`];
    const reqsMetric = data.metrics[`http_reqs{${tagKey}:${entry.name}}`];
    const failedMetric = data.metrics[`http_req_failed{${tagKey}:${entry.name}}`];

    const durationConfigured = isRealThreshold(entry, 'http_req_duration');
    const checksConfigured = isRealThreshold(entry, 'checks');

    const durationPass = thresholdsAllOk(durMetric);
    const checksPass = thresholdsAllOk(checksMetric);

    const rate = (metric) => {
      const r = metricValue(metric, 'rate');
      return r === null ? 'N/A' : `${(r * 100).toFixed(1)}%`;
    };

    const phases = includeBreakdown ? buildPhaseBreakdown(data, tagKey, entry.name) : null;

    return {
      name: entry.name,
      phases: phases && phases.values,
      dominantPhase: phases && phases.dominantPhase,
      minMs: fmt(metricValue(durMetric, 'min'), 'ms'),
      avgMs: fmt(metricValue(durMetric, 'avg'), 'ms'),
      medianMs: fmt(metricValue(durMetric, 'med'), 'ms'),
      p90Ms: fmt(metricValue(durMetric, 'p(90)'), 'ms'),
      p95Ms: fmt(metricValue(durMetric, 'p(95)'), 'ms'),
      maxMs: fmt(metricValue(durMetric, 'max'), 'ms'),
      requests: (() => {
        const c = metricValue(reqsMetric, 'count');
        return c === null ? 'N/A' : String(c);
      })(),
      reqsPerSec: fmt(metricValue(reqsMetric, 'rate'), '/s'),
      errorRate: rate(failedMetric),
      checksRate: rate(checksMetric),
      durationThreshold: durationConfigured
        ? entry.thresholds.http_req_duration.join(', ')
        : 'not configured (auto-pass)',
      checksThreshold: checksConfigured
        ? entry.thresholds.checks.join(', ')
        : 'not configured (auto-pass)',
      durationConfigured,
      checksConfigured,
      status: durationPass && checksPass ? 'PASS' : 'FAIL',
    };
  });
}

function renderCustomHtml(title, rows, includeBreakdown) {
  const failed = rows.filter((r) => r.status === 'FAIL').length;
  const passed = rows.length - failed;

  const tableRows = rows
    .map(
      (r) => `
      <tr class="${r.status === 'FAIL' ? 'fail' : 'pass'}">
        <td>${r.name}</td>
        <td>${r.minMs}</td>
        <td>${r.avgMs}</td>
        <td>${r.medianMs}</td>
        <td>${r.p90Ms}</td>
        <td>${r.p95Ms}</td>
        <td>${r.maxMs}</td>
        <td>${r.requests}</td>
        <td>${r.reqsPerSec}</td>
        <td>${r.errorRate}</td>
        <td>${r.checksRate}</td>
        <td>${r.durationThreshold}</td>
        <td>${r.checksThreshold}</td>
        <td><span class="badge ${r.status.toLowerCase()}">${r.status}</span></td>
      </tr>`
    )
    .join('');

  const phaseRows = includeBreakdown
    ? rows
        .map(
          (r) => `
      <tr>
        <td>${r.name}</td>
        <td>${r.phases.http_req_blocked}</td>
        <td>${r.phases.http_req_connecting}</td>
        <td>${r.phases.http_req_tls_handshaking}</td>
        <td>${r.phases.http_req_sending}</td>
        <td>${r.phases.http_req_waiting}</td>
        <td>${r.phases.http_req_receiving}</td>
        <td><strong>${r.dominantPhase}</strong></td>
      </tr>`
        )
        .join('')
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; color: #94a3b8; }
  .summary { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
  .card { background: #1e293b; border-radius: 8px; padding: 1rem 1.5rem; }
  .card .num { font-size: 1.8rem; font-weight: 700; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; white-space: nowrap; }
  th, td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #334155; text-align: left; }
  th { background: #1e293b; position: sticky; top: 0; }
  tr.fail { background: rgba(239, 68, 68, 0.12); }
  .badge { padding: 0.15rem 0.6rem; border-radius: 999px; font-weight: 600; font-size: 0.75rem; }
  .badge.pass { background: #166534; color: #dcfce7; }
  .badge.fail { background: #991b1b; color: #fee2e2; }
  .pass-num { color: #4ade80; }
  .fail-num { color: #f87171; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <div class="summary">
    <div class="card">Total<div class="num">${rows.length}</div></div>
    <div class="card">Passed<div class="num pass-num">${passed}</div></div>
    <div class="card">Failed<div class="num fail-num">${failed}</div></div>
  </div>
  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Name</th><th>Min</th><th>Avg</th><th>Median</th><th>p90</th><th>p95</th><th>Max</th>
        <th>Requests</th><th>Req/s</th><th>Error %</th><th>Checks %</th>
        <th>Duration Threshold</th><th>Checks Threshold</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  </div>

  ${
    includeBreakdown
      ? `<h2>Response Time Breakdown (avg ms) — where the time goes</h2>
  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Name</th><th>Blocked</th><th>Connecting</th><th>TLS</th>
        <th>Sending</th><th>Waiting (TTFB)</th><th>Receiving</th><th>Dominant Phase</th>
      </tr>
    </thead>
    <tbody>${phaseRows}</tbody>
  </table>
  </div>`
      : ''
  }
</body>
</html>`;
}

// tagKey: 'api' | 'journey'. entries: the exact list of api/journey config objects
// that were actually selected to run (must match what scenarios/thresholds were built from).
export function makeHandleSummary(tagKey, entries, reportTitle, outPrefix) {
  return function handleSummary(data) {
    const includeBreakdown = __ENV.BREAKDOWN === '1';
    const rows = buildRows(data, entries, tagKey, includeBreakdown);
    const dir = RUN_DIR;
    const out = {};
    out[`${dir}/${outPrefix}-report.html`] = renderCustomHtml(reportTitle, rows, includeBreakdown);
    out[`${dir}/${outPrefix}-rows.json`] = JSON.stringify(rows, null, 2);
    out[`${dir}/${outPrefix}-k6-report.html`] = htmlReport(data);
    out[`${dir}/${outPrefix}-summary.json`] = JSON.stringify(data, null, 2);
    out.stdout = textSummary(data, { indent: ' ', enableColors: true });
    return out;
  };
}
