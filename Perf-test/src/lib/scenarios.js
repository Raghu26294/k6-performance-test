import { DEFAULTS } from './config.js';

function toStages(vus, rampUpTime, steadyTime, rampDownTime) {
  const stages = [{ duration: rampUpTime, target: vus }];
  if (steadyTime) {
    stages.push({ duration: steadyTime, target: vus });
  }
  stages.push({ duration: rampDownTime, target: 0 });
  return stages;
}

// Precedence for every knob: CLI override (-e VUS=.., -e RAMP_UP=..) > per-entry
// config value > global config/env.json default. This is what makes VUs, ramp-up,
// duration and ramp-down configurable both centrally (config files) and per-run (CLI).
function resolve(overrides, overrideKey, entryValue, defaultValue) {
  if (overrides && overrides[overrideKey] !== undefined) return overrides[overrideKey];
  return entryValue || defaultValue;
}

// One ramping-vus scenario per selected API. The shared exec function (api-test.js)
// looks up k6/execution's scenario.name at runtime to know which API it's driving,
// so every scenario can point at the same exec entry point.
export function buildApiScenarios(apis, overrides) {
  const scenarios = {};
  for (const api of apis) {
    const vus = resolve(overrides, 'vus', api.vus, DEFAULTS.vus);
    const duration = resolve(overrides, 'duration', api.duration, DEFAULTS.duration);
    const rampUpTime = resolve(overrides, 'rampUpTime', api.rampUpTime, DEFAULTS.rampUpTime);
    const rampDownTime = resolve(overrides, 'rampDownTime', api.rampDownTime, DEFAULTS.rampDownTime);

    scenarios[api.name] = {
      executor: 'ramping-vus',
      exec: 'run',
      startVUs: 0,
      stages: toStages(vus, rampUpTime, duration, rampDownTime),
      gracefulRampDown: '5s',
      tags: { api: api.name },
    };
  }
  return scenarios;
}

// One ramping-vus scenario per journey, each with its own configurable VU count
// (10 / 20 / 30 / 5 by default, overridable in config/journeys.json or per-run).
export function buildJourneyScenarios(journeys, overrides) {
  const scenarios = {};
  for (const journey of journeys) {
    const vus = resolve(overrides, 'vus', journey.vus, DEFAULTS.vus);
    const rampUpTime = resolve(overrides, 'rampUpTime', journey.rampUpTime, DEFAULTS.rampUpTime);
    const steadyTime = resolve(overrides, 'duration', journey.steadyTime, DEFAULTS.duration);
    const rampDownTime = resolve(overrides, 'rampDownTime', journey.rampDownTime, DEFAULTS.rampDownTime);

    scenarios[journey.name] = {
      executor: 'ramping-vus',
      exec: 'run',
      startVUs: 0,
      stages: toStages(vus, rampUpTime, steadyTime, rampDownTime),
      gracefulRampDown: '10s',
      tags: { journey: journey.name },
    };
  }
  return scenarios;
}
