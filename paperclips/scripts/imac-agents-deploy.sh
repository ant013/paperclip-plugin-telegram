#!/usr/bin/env bash
# Deploy TelegramUpdate AGENTS.md bundles from a pinned checkout.
set -eu

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKTREE_PATH="/tmp/telegram-plugin-agents-deploy"
DEPLOY_LOG="$SCRIPT_DIR/imac-agents-deploy.log"
RUN_LOG="/tmp/tg-agents-deploy-$(date -u +%Y%m%dT%H%M%SZ).log"

TARGET_SHA=""
VERIFY_MARKER="Phase handoff discipline"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--target-sha <sha>] [--verify-marker <text>]

Deploys TG Codex agent instruction bundles using:
  paperclips/build.sh --target codex
  paperclips/deploy-agents.sh --api

Requires PAPERCLIP_API_KEY or PAPERCLIP_BOARD_TOKEN.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target-sha)
      [ "$#" -ge 2 ] || { echo "ERROR: --target-sha requires an argument" >&2; exit 1; }
      TARGET_SHA="$2"; shift 2 ;;
    --verify-marker)
      [ "$#" -ge 2 ] || { echo "ERROR: --verify-marker requires an argument" >&2; exit 1; }
      VERIFY_MARKER="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

exec > >(tee -a "$RUN_LOG") 2>&1
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
die() { log "ERROR: $*" >&2; exit "${2:-1}"; }

cleanup() {
  cd "$REPO_ROOT" 2>/dev/null || cd / 2>/dev/null || true
  if [ -d "$WORKTREE_PATH" ]; then
    git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || {
      rm -rf "$WORKTREE_PATH" 2>/dev/null || true
      git worktree prune 2>/dev/null || true
    }
  fi
}
trap cleanup EXIT

log "=== TG agents deploy start (run log: $RUN_LOG) ==="
cd "$REPO_ROOT"

git fetch origin || die "git fetch failed" 2
if [ -n "$TARGET_SHA" ]; then
  git rev-parse --verify --quiet "${TARGET_SHA}^{commit}" >/dev/null || die "invalid target sha: $TARGET_SHA" 1
  DEPLOY_REF="$TARGET_SHA"
else
  DEPLOY_REF="HEAD"
fi
log "Deploy ref: $DEPLOY_REF"

if [ -d "$WORKTREE_PATH" ]; then
  git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || {
    rm -rf "$WORKTREE_PATH" 2>/dev/null || true
    git worktree prune 2>/dev/null || true
  }
fi

git worktree add --detach "$WORKTREE_PATH" "$DEPLOY_REF" || die "git worktree add failed" 2
DEPLOY_SHA="$(cd "$WORKTREE_PATH" && git rev-parse HEAD)"
log "Worktree SHA: $DEPLOY_SHA"

cd "$WORKTREE_PATH"
bash paperclips/build.sh --target codex || die "build failed" 3
bash paperclips/deploy-agents.sh --api || die "deploy failed" 3

TG_QA_AGENT_ID="3d979815-496c-46b6-ac8e-cb71b34ba94e"
PAPERCLIP_DATA="${PAPERCLIP_DATA_DIR:-$HOME/.paperclip/instances/default}"
QA_AGENTS_MD="$PAPERCLIP_DATA/companies/8810f36f-c9f1-4920-b9a1-d5f7a1db9484/agents/$TG_QA_AGENT_ID/instructions/AGENTS.md"

if [ ! -f "$QA_AGENTS_MD" ]; then
  log "WARN: local managed AGENTS.md not visible at $QA_AGENTS_MD; API upload may still be active."
elif ! grep -qF "$VERIFY_MARKER" "$QA_AGENTS_MD"; then
  die "marker '$VERIFY_MARKER' not found in deployed TGQAEngineer bundle" 4
else
  log "Verify OK: marker found in TGQAEngineer bundle"
fi

UTC_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf "%s\tsha=%s\tdeployed=tg-codex\n" "$UTC_NOW" "$DEPLOY_SHA" >> "$DEPLOY_LOG"
log "=== TG agents deploy SUCCESS sha=$DEPLOY_SHA ==="
