#!/usr/bin/env bash
# Deploys one release on the IRAOPS server. Run by the release agent
# (release-agent.sh) from the release's own folder, /opt/arcus/releases/<APP_TAG>,
# with the AWS role already in the environment:
#
#   deploy.sh <APP_TAG> <ITOP_TAG> <IMAGE_BASE> <AWS_REGION> [<SIGNING_KEY>]
#
# The same steps as Intertec's deploy (deploy/aws/server/deploy.sh):
#  1. writes prod.env (the IRAOPS names, then the prod--* Key Vault secrets)
#     and itop.env (itop--*) into /opt/arcus/shared, mode 600;
#  2. backs up the running release and copies it to Azure Storage;
#  3. pulls the images (built once, by the Intertec pipeline, in ECR), checks
#     their signatures when SIGNING_KEY is given, starts the new release;
#  4. installs iTop on the first deploy, upgrades it when its image changed,
#     otherwise re-applies its settings;
#  5. waits until `web` is healthy (nginx -> BFF -> iTop sign-in);
#  6. on any failure after step 3, starts the previous release again and fails.
set -Eeuo pipefail

APP_TAG=$1 ITOP_TAG=$2 IMAGE_BASE=$3 REGION=$4 SIGNING_KEY=${5:-}
export HOME=${HOME:-/root}
ROOT=/opt/arcus
REL=$(cd "$(dirname "$0")/../../.." && pwd)
SHARED=$ROOT/shared
STATE=$ROOT/state
mkdir -p "$SHARED" "$STATE" "$ROOT/backups"
chmod 700 "$SHARED"
. "$STATE/azure.env"   # KEY_VAULT, BACKUP_ACCOUNT

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

PREV_APP=$(cat "$STATE/app_tag" 2>/dev/null || true)
PREV_ITOP=$(cat "$STATE/itop_tag" 2>/dev/null || true)
PREV_REL=$ROOT/releases/$PREV_APP

export ARCUS_REGISTRY=$IMAGE_BASE
export ARCUS_ENV_FILE=$SHARED/prod.env
export ITOP_ENV_FILE=$SHARED/itop.env

# docker compose for a release folder, with that release's image tags. A
# release older than the Azure files has no override: use this release's.
dc() {
  local rel=$1 app=$2 itop=$3 override
  shift 3
  override=$rel/deploy/azure/server/docker-compose.azure.yml
  [ -f "$override" ] || override=$REL/deploy/azure/server/docker-compose.azure.yml
  ARCUS_VERSION=$app ARCUS_ITOP_VERSION=$itop \
    docker compose -f "$rel/docker/docker-compose.prod.yml" -f "$override" --env-file "$SHARED/prod.env" "$@"
}

log "release $APP_TAG (iTop $ITOP_TAG); running now: ${PREV_APP:-nothing} (iTop ${PREV_ITOP:-none})"

# --- 1. Settings from Key Vault -> env files. Secret names are
# <prefix>--<NAME with - for _>. Values are written in single quotes; a quote
# or newline in a value is refused rather than mangled.
VAULT_TOKEN=$(curl -fsS -H Metadata:true \
  "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net" | jq -r .access_token)
vault() { curl -fsS -H "Authorization: Bearer $VAULT_TOKEN" "$1"; }

ALL_NAMES=$(mktemp)
url="https://$KEY_VAULT.vault.azure.net/secrets?api-version=7.4&maxresults=25"
while [ -n "$url" ] && [ "$url" != null ]; do
  page=$(vault "$url")
  jq -r '.value[] | select(.attributes.enabled) | .id | split("/") | last' <<<"$page" >> "$ALL_NAMES"
  url=$(jq -r '.nextLink // empty' <<<"$page")
done

render() {
  local prefix=$1 out=$2 name key value
  : > "$out.tmp"
  chmod 600 "$out.tmp"
  [ -z "${3:-}" ] || cat "$3" >> "$out.tmp"
  while read -r name; do
    case "$name" in "$prefix--"*) ;; *) continue ;; esac
    key=$(echo "${name#"$prefix--"}" | tr - _)
    value=$(vault "https://$KEY_VAULT.vault.azure.net/secrets/$name?api-version=7.4" | jq -r .value)
    if [ "$value" = "-" ]; then value=""; fi   # "-" stands for an empty value
    case "$value" in *"'"*|*$'\n'*) echo "$key: quotes and newlines are not allowed" >&2; exit 1 ;; esac
    printf "%s='%s'\n" "$key" "$value" >> "$out.tmp"
  done < "$ALL_NAMES"
  grep -q . "$out.tmp" || { echo "No settings for $prefix in $KEY_VAULT" >&2; exit 1; }
  mv "$out.tmp" "$out"
}
NAMES=$(mktemp)
cat "$REL/deploy/azure/server/names.env" > "$NAMES"
# The BFF signs licences with the IRAOPS role (docker-compose.azure.yml).
cat "$STATE/aws.env" >> "$NAMES"
render prod "$SHARED/prod.env" "$NAMES"
render itop "$SHARED/itop.env"
rm -f "$ALL_NAMES" "$NAMES"
log "settings written ($(grep -c . "$SHARED/prod.env") + $(grep -c . "$SHARED/itop.env") values)"

copy_backups() {
  AZCOPY_AUTO_LOGIN_TYPE=MSI azcopy sync "$ROOT/backups" "https://$BACKUP_ACCOUNT.blob.core.windows.net/daily" \
    --recursive --log-level ERROR >/dev/null
}

# --- 2. Backup of what runs now.
if [ -f "$STATE/installed" ] && [ -n "$PREV_APP" ] && [ -d "$PREV_REL" ]; then
  log "backup before deploying"
  dc "$PREV_REL" "$PREV_APP" "$PREV_ITOP" run --rm backup backup
  copy_backups
  log "backup copied to $BACKUP_ACCOUNT/daily"
fi

# --- 3. New images, new release.
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${IMAGE_BASE%%/*}" >/dev/null
log "pulling images"
dc "$REL" "$APP_TAG" "$ITOP_TAG" pull --quiet

if [ -n "$SIGNING_KEY" ]; then
  log "checking image signatures ($SIGNING_KEY)"
  AWS_REGION=$REGION COSIGN_DIR=$ROOT/bin bash "$REL/security/verify-image.sh" "$SIGNING_KEY" \
    "${IMAGE_BASE}arcus-bff:$APP_TAG" "${IMAGE_BASE}arcus-web:$APP_TAG" "${IMAGE_BASE}arcus-itop:$ITOP_TAG"
else
  log "image signature check off (image signing not enabled)"
fi

ITOP_RUN_TAG=$PREV_ITOP
rollback() {
  local code=$?
  trap - ERR
  log "FAILED (exit $code)"
  dc "$REL" "$APP_TAG" "$ITOP_TAG" ps || true
  dc "$REL" "$APP_TAG" "$ITOP_TAG" logs --tail 60 bff web || true
  if [ -n "$PREV_APP" ] && [ -d "$PREV_REL" ] && [ "$PREV_APP" != "$APP_TAG" ]; then
    # After an iTop upgrade the database belongs to the new iTop: keep it.
    log "rolling back to $PREV_APP (iTop ${ITOP_RUN_TAG:-$PREV_ITOP})"
    dc "$PREV_REL" "$PREV_APP" "${ITOP_RUN_TAG:-$PREV_ITOP}" up -d --no-build --remove-orphans || true
  fi
  exit 1
}
trap rollback ERR

log "starting the new release"
dc "$REL" "$APP_TAG" "$ITOP_TAG" up -d --no-build --remove-orphans

wait_healthy() {
  local svc=$1 tries=$2 id status
  for _ in $(seq 1 "$tries"); do
    id=$(dc "$REL" "$APP_TAG" "$ITOP_TAG" ps -q "$svc")
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)
    [ "$status" = healthy ] && return 0
    sleep 10
  done
  log "$svc is $status after $((tries * 10))s"
  return 1
}

# --- 4. iTop: install, upgrade, or re-apply settings.
wait_healthy itop 60
if [ ! -f "$STATE/installed" ]; then
  log "first deploy: installing iTop (about 10 minutes)"
  dc "$REL" "$APP_TAG" "$ITOP_TAG" exec -T -u www-data itop itop-setup
  touch "$STATE/installed"
elif [ "$ITOP_TAG" != "$PREV_ITOP" ]; then
  log "iTop image changed ($PREV_ITOP -> $ITOP_TAG): upgrading iTop"
  dc "$REL" "$APP_TAG" "$ITOP_TAG" exec -T -u www-data itop itop-setup --upgrade
else
  log "re-applying iTop settings"
  dc "$REL" "$APP_TAG" "$ITOP_TAG" exec -T -u www-data itop itop-setup
fi
ITOP_RUN_TAG=$ITOP_TAG
echo "$ITOP_TAG" > "$STATE/itop_tag"
dc "$REL" "$APP_TAG" "$ITOP_TAG" restart itop itop-cron

# --- 5. Health: the whole chain answers.
log "waiting for the platform to be healthy"
wait_healthy bff 30
wait_healthy web 60
curl -fsS -o /dev/null http://127.0.0.1:8088/healthz

if [ ! -f "$STATE/approvals.done" ]; then
  log "turning on approval notifications (once)"
  if dc "$REL" "$APP_TAG" "$ITOP_TAG" exec -T bff node dist/cli/approvals-setup.js; then
    touch "$STATE/approvals.done"
  else
    log "WARNING: approvals-setup failed; the deploy stands, run it again later"
  fi
fi

trap - ERR
echo "$APP_TAG" > "$STATE/app_tag"
date -u +%FT%TZ > "$STATE/deployed_at"

# Keep the five newest release folders and a week of images.
ls -1dt "$ROOT"/releases/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
docker image prune -af --filter "until=168h" >/dev/null || true

dc "$REL" "$APP_TAG" "$ITOP_TAG" ps --format "table {{.Service}}\t{{.Status}}"
log "DONE: $APP_TAG is live"
