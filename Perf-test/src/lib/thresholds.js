// Thresholds are opt-in per API / per journey via config/apis.json or config/journeys.json.
// - If an entry defines `thresholds`, that condition is enforced for real: k6 will fail
//   the run (non-zero exit code) when it's breached.
// - If an entry defines NO `thresholds`, we still attach a trivially-true synthetic
//   threshold (e.g. "avg>=0") purely so k6 emits the per-tag sub-metric into the end
//   summary (k6 only surfaces metric+tag combinations that appear in `options.thresholds`).
//   This gives every API/journey a row with real latency numbers in the report while
//   guaranteeing it can never fail on an unconfigured condition.
const SYNTHETIC_DURATION = ['avg>=0'];
const SYNTHETIC_RATE = ['rate>=0'];
const SYNTHETIC_COUNT = ['count>=0'];

// Request-phase breakdown metrics (where k6 splits http_req_duration into:
// blocked (waiting for a free connection) -> connecting -> tls handshake ->
// sending -> waiting (server think time / TTFB) -> receiving). Surfacing
// these per-API answers "where is the slow response actually going."
const PHASE_METRICS = [
  'http_req_blocked',
  'http_req_connecting',
  'http_req_tls_handshaking',
  'http_req_sending',
  'http_req_waiting',
  'http_req_receiving',
];

function addMetric(target, metricName, tagKey, tagValue, conditions) {
  const key = `${metricName}{${tagKey}:${tagValue}}`;
  target[key] = conditions;
}

function buildThresholdsFor(entries, tagKey, includeBreakdown) {
  const thresholds = {};
  for (const entry of entries) {
    const configured = entry.thresholds || {};

    addMetric(
      thresholds,
      'http_req_duration',
      tagKey,
      entry.name,
      configured.http_req_duration || SYNTHETIC_DURATION
    );
    addMetric(
      thresholds,
      'checks',
      tagKey,
      entry.name,
      configured.checks || SYNTHETIC_RATE
    );
    addMetric(
      thresholds,
      'http_req_failed',
      tagKey,
      entry.name,
      configured.http_req_failed || SYNTHETIC_RATE
    );
    // Not opt-in: always emit the per-tag http_reqs bucket (synthetic, can never
    // fail) purely so the report can show request count / throughput per entry.
    addMetric(thresholds, 'http_reqs', tagKey, entry.name, SYNTHETIC_COUNT);

    if (includeBreakdown) {
      for (const metricName of PHASE_METRICS) {
        addMetric(thresholds, metricName, tagKey, entry.name, SYNTHETIC_DURATION);
      }
    }
  }
  return thresholds;
}

export function buildApiThresholds(apis, options) {
  return buildThresholdsFor(apis, 'api', Boolean(options && options.breakdown));
}

export function buildJourneyThresholds(journeys, options) {
  return buildThresholdsFor(journeys, 'journey', Boolean(options && options.breakdown));
}

export function isRealThreshold(entry, metricName) {
  return Boolean(entry.thresholds && entry.thresholds[metricName]);
}
