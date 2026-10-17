#!/usr/bin/env bash
# Performance test runner wrapper around k6.
#
# Usage:
#   ./scripts/run.sh api all                              # all 50 APIs
#   ./scripts/run.sh api getUserById                       # single API
#   ./scripts/run.sh api getUsers,getPosts,createPost       # a subset
#   ./scripts/run.sh journey all                           # all 4 journeys
#   ./scripts/run.sh journey browseJourney                 # single journey
#   ./scripts/run.sh both all                               # api all + journey all, same results/ folder
#
# Optional flags (any order, after the required args):
#   --env dev|staging|prod     Environment to target (default: dev, see config/env.json)
#   --base-url <url>           Override the base URL directly, skips config/env.json
#   --vus <n>                  Override VUs for every selected API/journey
#   --ramp-up <duration>       Override ramp-up time, e.g. 20s
#   --duration <duration>      Override steady-state duration, e.g. 1m
#   --ramp-down <duration>     Override ramp-down time, e.g. 10s
#   --breakdown                Include per-phase timing (Blocked/Connecting/TLS/
#                              Sending/Waiting/Receiving) in the HTML report
#
# Examples:
#   ./scripts/run.sh api createPost --env staging --vus 20 --ramp-up 15s --duration 1m
#   ./scripts/run.sh journey all --base-url https://api.mycompany.com

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v k6 >/dev/null 2>&1; then
  echo "error: k6 is not installed. Install it first (e.g. 'brew install k6')." >&2
  exit 1
fi

MODE="${1:-}"
TARGET="${2:-}"

if [[ "$MODE" != "api" && "$MODE" != "journey" && "$MODE" != "both" ]]; then
  echo "error: first argument must be 'api', 'journey', or 'both'" >&2
  echo "usage: $0 <api|journey|both> <name|all> [options]" >&2
  exit 1
fi

if [[ -z "$TARGET" ]]; then
  echo "error: second argument must be an api/journey name, a comma-separated list, or 'all'" >&2
  exit 1
fi
shift 2

ENV_NAME=""
BASE_URL=""
VUS=""
RAMP_UP=""
DURATION=""
RAMP_DOWN=""
BREAKDOWN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --vus) VUS="$2"; shift 2 ;;
    --ramp-up) RAMP_UP="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --ramp-down) RAMP_DOWN="$2"; shift 2 ;;
    --breakdown) BREAKDOWN="1"; shift ;;
    *) echo "error: unknown option '$1'" >&2; exit 1 ;;
  esac
done

# Validate the requested name(s) exist in config before spending time spinning up k6,
# so a typo fails fast with a clear message instead of a confusing empty scenario set.
validate_names() {
  local mode="$1" target="$2"
  if [[ "$target" == "all" ]]; then
    return 0
  fi
  python3 - "$mode" "$target" "$ROOT_DIR" <<'PYEOF'
import json, sys, os

mode, target, root = sys.argv[1], sys.argv[2], sys.argv[3]
requested = [t.strip() for t in target.split(",") if t.strip()]

if mode == "api":
    with open(os.path.join(root, "config/apis.json")) as f:
        known = {a["name"] for a in json.load(f)["apis"]}
else:
    with open(os.path.join(root, "config/journeys.json")) as f:
        known = {j["name"] for j in json.load(f)["journeys"]}

unknown = [r for r in requested if r not in known]
if unknown:
    print(f"error: unknown {mode} name(s): {', '.join(unknown)}", file=sys.stderr)
    print(f"known {mode} names: {', '.join(sorted(known))}", file=sys.stderr)
    sys.exit(1)
PYEOF
}

if [[ "$MODE" == "both" ]]; then
  SUBMODES=(api journey)
else
  SUBMODES=("$MODE")
fi

for m in "${SUBMODES[@]}"; do
  validate_names "$m" "$TARGET"
done

# One results/<RUN_ID>/ folder shared by every submode in this invocation, so
# 'both' lands api-*/journey-* reports together, and separate invocations never
# overwrite each other's output.
RUN_ID="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="results/${RUN_ID}"
mkdir -p "$RUN_DIR"

open_report() {
  local report_path="$1"
  if [[ -z "${CI:-}" && -t 1 && -f "$report_path" ]]; then
    if command -v open >/dev/null 2>&1; then
      open "$report_path"
      return
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$report_path" >/dev/null 2>&1 &
      return
    fi
  fi
  echo "==> report ready: $report_path"
}

OVERALL_EXIT=0
for m in "${SUBMODES[@]}"; do
  SCRIPT_PATH="tests/${m}-test.js"
  SELECT_VAR="API"
  [[ "$m" == "journey" ]] && SELECT_VAR="JOURNEY"

  K6_ARGS=(run "$SCRIPT_PATH" -e "${SELECT_VAR}=${TARGET}" -e "RUN_ID=${RUN_ID}")
  [[ -n "$ENV_NAME" ]] && K6_ARGS+=(-e "ENV=${ENV_NAME}")
  [[ -n "$BASE_URL" ]] && K6_ARGS+=(-e "BASE_URL=${BASE_URL}")
  [[ -n "$VUS" ]] && K6_ARGS+=(-e "VUS=${VUS}")
  [[ -n "$RAMP_UP" ]] && K6_ARGS+=(-e "RAMP_UP=${RAMP_UP}")
  [[ -n "$DURATION" ]] && K6_ARGS+=(-e "DURATION=${DURATION}")
  [[ -n "$RAMP_DOWN" ]] && K6_ARGS+=(-e "RAMP_DOWN=${RAMP_DOWN}")
  [[ -n "$BREAKDOWN" ]] && K6_ARGS+=(-e "BREAKDOWN=${BREAKDOWN}")

  echo "==> k6 ${K6_ARGS[*]}"
  k6 "${K6_ARGS[@]}" || OVERALL_EXIT=$?

  open_report "${RUN_DIR}/${m}-report.html"
done

exit "$OVERALL_EXIT"
