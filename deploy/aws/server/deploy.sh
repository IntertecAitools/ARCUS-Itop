#!/usr/bin/env bash
# Deploys one release on the production server. Run by the pipeline (SSM Run
# Command, deploy/aws/pipeline/run-deploy.sh) from the release's own folder,
# /opt/arcus/releases/<APP_TAG>:
#
#   deploy.sh <APP_TAG> <ITOP_TAG> <IMAGE_BASE> <PARAM_PATH> <REGION> <BACKUP_BUCKET>
#
#  1. writes prod.env and itop.env from SSM Parameter Store (<PARAM_PATH>/prod-env/*,
#     <PARAM_PATH>/itop-env/*) into /opt/arcus/shared, mode 600;
#  2. backs up the running release (databases + iTop files) and copies it to S3;
#  3. pulls the images from ECR and starts the new release;
#  4. installs iTop on the first deploy, runs iTop's upgrade when the iTop image
#     changed, otherwise re-applies iTop's settings (itop-setup);
#  5. waits until `web` is healthy (nginx -> BFF -> iTop sign-in);
#  6. on any failure after step 3, starts the previous release again and fails.
set -Eeuo pipefail

APP_TAG=$1 ITOP_TAG=$2 IMAGE_BASE=$3 PARAM_PATH=$4 REGION=$5 BACKUP_BUCKET=$6
ROOT=/opt/arcus
REL=$(cd "$(dirname "$0")/../../.." && pwd)
SHARED=$ROOT/shared
STATE=$ROOT/state
mkdir -p "$SHARED" "$STATE" "$ROOT/backups"
chmod 700 "$SHARED"

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

PREV_APP=$(cat "$STATE/app_tag" 2>/dev/null || true)
PREV_ITOP=$(cat "$STATE/itop_tag" 2>/dev/null || true)
PREV_REL=$ROOT/releases/$PREV_APP

export ARCUS_REGISTRY=$IMAGE_BASE
export ARCUS_ENV_FILE=$SHARED/prod.env
export ITOP_ENV_FILE=$SHARED/itop.env

# docker compose for a release folder, with that release's image tags.
dc() {
  local rel=$1 app=$2 itop=$3
  shift 3
  ARCUS_VERSION=$app ARCUS_ITOP_VERSION=$itop \
    docker compose -f "$rel/docker/docker-compose.prod.yml" --env-file "$SHARED/prod.env" "$@"
}

log "release $APP_TAG (iTop $ITOP_TAG); running now: ${PREV_APP:-nothing} (iTop ${PREV_ITOP:-none})"

# --- 1. Settings from Parameter Store -> env files. Values are written in
# single quotes (compose reads them literally); a quote or newline in a value
# is refused rather than mangled.
render() {
  local path=$1 out=$2
  aws ssm get-parameters-by-path --region "$REGION" --path "$path" --recursive --with-decryption \
    --query 'Parameters[].[Name,Value]' --output json |
    jq -r --arg q "'" '.[] | (.[0] | split("/") | last) as $k | .[1] as $v
      | if ($v | contains($q) or contains("\n")) then error("\($k): quotes and newlines are not allowed")
        else "\($k)=\($q)\($v)\($q)" end' \
      > "$out.tmp"
  [ -s "$out.tmp" ] || { echo "No settings under $path" >&2; exit 1; }
  chmod 600 "$out.tmp"
  mv "$out.tmp" "$out"
}
render "$PARAM_PATH/prod-env" "$SHARED/prod.env"
render "$PARAM_PATH/itop-env" "$SHARED/itop.env"
log "settings written ($(wc -l < "$SHARED/prod.env") + $(wc -l < "$SHARED/itop.env") values)"

# --- 2. Backup of what runs now.
if [ -f "$STATE/installed" ] && [ -n "$PREV_APP" ] && [ -d "$PREV_REL" ]; then
  log "backup before deploying"
  dc "$PREV_REL" "$PREV_APP" "$PREV_ITOP" run --rm backup backup
  aws s3 sync "$ROOT/backups" "s3://$BACKUP_BUCKET/daily/" --region "$REGION" --only-show-errors
  log "backup copied to s3://$BACKUP_BUCKET/daily/"
fi

# --- 3. New images, new release.
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${IMAGE_BASE%%/*}" >/dev/null
log "pulling images"
dc "$REL" "$APP_TAG" "$ITOP_TAG" pull --quiet

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
