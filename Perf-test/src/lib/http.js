import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEFAULTS } from './config.js';

// Fires one configured API call, tagging the request with `api` (and optionally
// `journey`/`step`) so metrics/thresholds can be sliced per-API in the summary
// and in k6's own threshold engine (e.g. http_req_duration{api:getUsers}).
export function callApi(api, extraTags) {
  const url = `${BASE_URL}${api.path}`;
  const tags = Object.assign({ api: api.name }, extraTags || {});
  const params = {
    tags,
    timeout: DEFAULTS.requestTimeout,
    headers: { 'Content-Type': 'application/json' },
  };

  let res;
  const method = (api.method || 'GET').toUpperCase();
  const payload = api.body ? JSON.stringify(api.body) : null;

  switch (method) {
    case 'GET':
      res = http.get(url, params);
      break;
    case 'DELETE':
      res = http.del(url, null, params);
      break;
    case 'POST':
      res = http.post(url, payload, params);
      break;
    case 'PUT':
      res = http.put(url, payload, params);
      break;
    case 'PATCH':
      res = http.patch(url, payload, params);
      break;
    default:
      throw new Error(`Unsupported method "${method}" for API "${api.name}"`);
  }

  check(res, {
    [`${api.name}: status is 2xx/3xx`]: (r) => r.status >= 200 && r.status < 400,
  });

  return res;
}
