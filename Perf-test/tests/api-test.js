import { scenario } from 'k6/execution';
import { sleep } from 'k6';
import { ALL_APIS, DEFAULTS } from '../src/lib/config.js';
import { callApi } from '../src/lib/http.js';
import { buildApiScenarios } from '../src/lib/scenarios.js';
import { buildApiThresholds } from '../src/lib/thresholds.js';
import { makeHandleSummary } from '../src/lib/report/handleSummary.js';

// Selection: -e API=all (default) | -e API=getUsers | -e API=getUsers,getPosts,createPost
// (scripts/run.sh validates names before invoking k6, but raw `k6 run` with -e works too.)
const RAW_SELECTION = __ENV.API || 'all';
const SELECTED_APIS =
  RAW_SELECTION.toLowerCase() === 'all'
    ? ALL_APIS
    : ALL_APIS.filter((api) => RAW_SELECTION.split(',').map((s) => s.trim()).includes(api.name));

if (SELECTED_APIS.length === 0) {
  throw new Error(
    `No APIs matched selection "${RAW_SELECTION}". Check config/apis.json for valid names.`
  );
}

const API_BY_SCENARIO = {};
for (const api of SELECTED_APIS) {
  API_BY_SCENARIO[api.name] = api;
}

// Optional CLI overrides applied uniformly to every selected API, e.g.:
// k6 run tests/api-test.js -e API=getUsers -e VUS=50 -e RAMP_UP=20s -e DURATION=1m -e RAMP_DOWN=15s
const overrides = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS, 10) : undefined,
  rampUpTime: __ENV.RAMP_UP,
  duration: __ENV.DURATION,
  rampDownTime: __ENV.RAMP_DOWN,
};

export const options = {
  scenarios: buildApiScenarios(SELECTED_APIS, overrides),
  thresholds: buildApiThresholds(SELECTED_APIS, { breakdown: __ENV.BREAKDOWN === '1' }),
};

export function run() {
  const api = API_BY_SCENARIO[scenario.name];
  callApi(api);
  sleep(parseFloat(DEFAULTS.thinkTime) || 1);
}

export const handleSummary = makeHandleSummary('api', SELECTED_APIS, 'API Load Test Summary', 'api');
