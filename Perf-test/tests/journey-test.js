import { scenario } from 'k6/execution';
import { sleep } from 'k6';
import { ALL_JOURNEYS, API_BY_NAME, DEFAULTS } from '../src/lib/config.js';
import { callApi } from '../src/lib/http.js';
import { buildJourneyScenarios } from '../src/lib/scenarios.js';
import { buildJourneyThresholds } from '../src/lib/thresholds.js';
import { makeHandleSummary } from '../src/lib/report/handleSummary.js';

// Selection: -e JOURNEY=all (default) | -e JOURNEY=browseJourney | -e JOURNEY=browseJourney,albumPhotoJourney
const RAW_SELECTION = __ENV.JOURNEY || 'all';
const SELECTED_JOURNEYS =
  RAW_SELECTION.toLowerCase() === 'all'
    ? ALL_JOURNEYS
    : ALL_JOURNEYS.filter((j) =>
        RAW_SELECTION.split(',').map((s) => s.trim()).includes(j.name)
      );

if (SELECTED_JOURNEYS.length === 0) {
  throw new Error(
    `No journeys matched selection "${RAW_SELECTION}". Check config/journeys.json for valid names.`
  );
}

const JOURNEY_BY_SCENARIO = {};
for (const journey of SELECTED_JOURNEYS) {
  JOURNEY_BY_SCENARIO[journey.name] = journey;
}

// Optional CLI overrides applied uniformly to every selected journey, e.g.:
// k6 run tests/journey-test.js -e JOURNEY=browseJourney -e VUS=25 -e RAMP_UP=30s
const overrides = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS, 10) : undefined,
  rampUpTime: __ENV.RAMP_UP,
  duration: __ENV.DURATION,
  rampDownTime: __ENV.RAMP_DOWN,
};

export const options = {
  scenarios: buildJourneyScenarios(SELECTED_JOURNEYS, overrides),
  thresholds: buildJourneyThresholds(SELECTED_JOURNEYS, { breakdown: __ENV.BREAKDOWN === '1' }),
};

export function run() {
  const journey = JOURNEY_BY_SCENARIO[scenario.name];
  const thinkTime = parseFloat(journey.thinkTime || DEFAULTS.thinkTime) || 1;

  for (const apiName of journey.steps) {
    const api = API_BY_NAME[apiName];
    callApi(api, { journey: journey.name, step: apiName });
    sleep(thinkTime);
  }
}

export const handleSummary = makeHandleSummary(
  'journey',
  SELECTED_JOURNEYS,
  'User Journey Load Test Summary',
  'journey'
);
