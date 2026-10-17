// Central config loader. All test entry points call loadConfig() once at init time.
// open() is relative to THIS file's location: src/lib/ -> ../../config/*.json
const envConfig = JSON.parse(open('../../config/env.json'));
const apisConfig = JSON.parse(open('../../config/apis.json'));
const journeysConfig = JSON.parse(open('../../config/journeys.json'));

const ENV_NAME = __ENV.ENV || envConfig.defaultEnv;
const envEntry = envConfig.environments[ENV_NAME];
if (!envEntry) {
  throw new Error(
    `Unknown ENV "${ENV_NAME}". Valid options: ${Object.keys(envConfig.environments).join(', ')}`
  );
}

// -e BASE_URL always wins over the environment file, so a single endpoint can be
// repointed from the CLI without editing config.
const BASE_URL = __ENV.BASE_URL || envEntry.baseUrl;
const DEFAULTS = envConfig.defaults;

function indexApisByName(list) {
  const map = {};
  for (const api of list) {
    if (map[api.name]) {
      throw new Error(`Duplicate API name in config/apis.json: "${api.name}"`);
    }
    map[api.name] = api;
  }
  return map;
}

const API_BY_NAME = indexApisByName(apisConfig.apis);

function resolveApi(name) {
  const api = API_BY_NAME[name];
  if (!api) {
    throw new Error(`API "${name}" not found in config/apis.json`);
  }
  return api;
}

function getJourney(name) {
  const journey = journeysConfig.journeys.find((j) => j.name === name);
  if (!journey) {
    throw new Error(`Journey "${name}" not found in config/journeys.json`);
  }
  return journey;
}

export {
  BASE_URL,
  ENV_NAME,
  DEFAULTS,
  API_BY_NAME,
  resolveApi,
  getJourney,
};

export const ALL_APIS = apisConfig.apis;
export const ALL_JOURNEYS = journeysConfig.journeys;
