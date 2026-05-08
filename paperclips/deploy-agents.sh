#!/usr/bin/env bash
# API deploy path for TelegramUpdate Codex agent instruction bundles.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist/codex"
COMPANY_ID="${PAPERCLIP_COMPANY_ID:-8810f36f-c9f1-4920-b9a1-d5f7a1db9484}"
API_BASE="${PAPERCLIP_API_URL:-https://paperclip.ant013.work}"
ID_FILE="${PAPERCLIP_TG_AGENT_IDS_FILE:-$SCRIPT_DIR/tg-agent-ids.env}"
API_KEY="${PAPERCLIP_API_KEY:-${PAPERCLIP_BOARD_TOKEN:-}}"

MODE="dry-run"
TARGET="all"

if [ -f "$ID_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ID_FILE"
fi

AGENT_NAMES="tg-cto tg-code-reviewer tg-plugin-engineer tg-qa-engineer tg-infra-engineer"

agent_id() {
  case "$1" in
    tg-cto) echo "${TG_CTO_AGENT_ID:-}" ;;
    tg-code-reviewer) echo "${TG_CODE_REVIEWER_AGENT_ID:-}" ;;
    tg-plugin-engineer) echo "${TG_PLUGIN_ENGINEER_AGENT_ID:-}" ;;
    tg-qa-engineer) echo "${TG_QA_ENGINEER_AGENT_ID:-}" ;;
    tg-infra-engineer) echo "${TG_INFRA_ENGINEER_AGENT_ID:-}" ;;
    *) echo "" ;;
  esac
}

usage() {
  cat <<'USAGE'
Usage:
  ./paperclips/deploy-agents.sh --dry-run [agent-name]
  ./paperclips/deploy-agents.sh --api [agent-name]

Environment:
  PAPERCLIP_API_URL           Paperclip API base URL
  PAPERCLIP_API_KEY           API token for --api
  PAPERCLIP_BOARD_TOKEN       accepted fallback token for --api
  PAPERCLIP_TG_AGENT_IDS_FILE optional env file with TG_*_AGENT_ID values

Available agents:
  tg-cto tg-code-reviewer tg-plugin-engineer tg-qa-engineer tg-infra-engineer
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --api) MODE="api" ;;
    -h|--help) usage; exit 0 ;;
    *) TARGET="$arg" ;;
  esac
done

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: dist not found: $DIST_DIR" >&2
  echo "Run: $SCRIPT_DIR/build.sh --target codex" >&2
  exit 1
fi

if [ "$MODE" = "api" ] && [ -z "$API_KEY" ]; then
  echo "ERROR: --api mode requires PAPERCLIP_API_KEY or PAPERCLIP_BOARD_TOKEN" >&2
  exit 1
fi

fetch_adapter_type() {
  local aid="$1"
  curl -sS \
    "$API_BASE/api/agents/$aid/configuration" \
    -H "Authorization: Bearer $API_KEY" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(j.adapterType || "")})'
}

deploy_one() {
  local name="$1"
  local aid
  aid=$(agent_id "$name")
  local dist_file="$DIST_DIR/$name.md"

  if [ ! -f "$dist_file" ]; then
    echo "  SKIP: $dist_file not found"
    return 1
  fi

  if [ -z "$aid" ]; then
    echo "  ERROR: $name has no agent id"
    return 1
  fi

  echo "  $name -> $aid"
  echo "    source: $dist_file"

  if [ "$MODE" = "dry-run" ]; then
    if [ -n "$API_KEY" ]; then
      local adapter
      adapter=$(fetch_adapter_type "$aid")
      echo "    live adapterType: $adapter"
      if [ "$adapter" != "codex_local" ]; then
        echo "    REFUSE: expected codex_local"
        return 1
      fi
    else
      echo "    live adapterType: not checked (no API token)"
    fi
    return 0
  fi

  local adapter
  adapter=$(fetch_adapter_type "$aid")
  if [ "$adapter" != "codex_local" ]; then
    echo "ERROR: refusing upload to $aid; expected codex_local, got '$adapter'" >&2
    return 1
  fi

  local content
  content=$(node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(s)))' < "$dist_file")

  local response
  response=$(curl -sS -w "\n%{http_code}" -X PUT \
    "$API_BASE/api/agents/$aid/instructions-bundle/file" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"AGENTS.md\",\"content\":$content}" 2>&1)

  local http_code
  http_code=$(echo "$response" | tail -1)

  if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
    echo "    upload: OK ($http_code)"
  else
    local body
    body=$(echo "$response" | sed '$d')
    echo "    upload: FAILED ($http_code): $body"
    return 1
  fi
}

echo ""
echo "Mode: $MODE"
echo "Company: $COMPANY_ID"
echo "Source: $DIST_DIR"
echo "API: $API_BASE"
echo "ID file: $ID_FILE"
echo ""

if [ "$TARGET" = "all" ]; then
  failed=0
  for name in $AGENT_NAMES; do
    deploy_one "$name" || failed=$((failed+1))
  done
  [ "$failed" -eq 0 ] || exit 1
else
  known=0
  for name in $AGENT_NAMES; do
    if [ "$name" = "$TARGET" ]; then
      known=1
      break
    fi
  done
  if [ "$known" -ne 1 ]; then
    echo "Unknown agent: $TARGET" >&2
    echo "Available: $AGENT_NAMES" >&2
    exit 1
  fi
  deploy_one "$TARGET"
fi
