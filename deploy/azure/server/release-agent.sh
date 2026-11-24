#!/usr/bin/env bash
# The IRAOPS release agent, run every minute by a systemd timer
# (iraops-release.timer). Nothing reaches into this server from outside:
# it asks the release-control bucket in AWS whether a release was approved
# (control/release.json, written by the "Release to IRAOPS" pipeline), and
# when one is new, deploys it and reports back:
#
#   control/status.json      {"id","state":"running|succeeded|failed","at"}
#   control/logs/<id>.log    the deploy's output
#
# It reaches AWS with the server's own Azure identity (no stored keys): the
# managed identity's token is exchanged for the IRAOPS role
# (deploy/azure/aws), which the BFF also uses to sign licences.
set -Eeuo pipefail

exec 9>/run/iraops-release.lock
flock -n 9 || exit 0

ROOT=/opt/arcus
STATE=$ROOT/state
. "$STATE/azure.env"   # KEY_VAULT, BACKUP_ACCOUNT

imds_token() {
  curl -fsS -H Metadata:true \
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=$1" | jq -r .access_token
}

# Settings this agent needs, from Key Vault (absent until deploy/azure/aws is applied).
VAULT_TOKEN=$(imds_token https%3A%2F%2Fvault.azure.net)
kv() {
  curl -fsS -H "Authorization: Bearer $VAULT_TOKEN" \
    "https://$KEY_VAULT.vault.azure.net/secrets/$1?api-version=7.4" 2>/dev/null | jq -r '.value // empty' || true
}
ROLE=$(kv agent--AWS-ROLE-ARN)
[ -n "$ROLE" ] || exit 0
REGION=$(kv agent--AWS-REGION)
BUCKET=$(kv agent--AWS-RELEASE-BUCKET)

# The token AWS trusts: this server's identity, audience Azure Resource
# Manager. Refreshed every run; the BFF container reads the same file.
imds_token https%3A%2F%2Fmanagement.azure.com%2F > "$ROOT/aws/token.tmp"
chown root:1000 "$ROOT/aws/token.tmp"
chmod 640 "$ROOT/aws/token.tmp"
mv "$ROOT/aws/token.tmp" "$ROOT/aws/token"
export AWS_ROLE_ARN=$ROLE AWS_WEB_IDENTITY_TOKEN_FILE=$ROOT/aws/token AWS_ROLE_SESSION_NAME=iraops-server
export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION
echo "AWS_ROLE_ARN=$ROLE" > "$STATE/aws.env"

DESIRED=$(aws s3 cp "s3://$BUCKET/control/release.json" - 2>/dev/null) || exit 0
ID=$(jq -r .id <<<"$DESIRED")
[ -n "$ID" ] && [ "$ID" != null ] || exit 0
[ "$ID" = "$(cat "$STATE/release_id" 2>/dev/null || true)" ] && exit 0

APP_TAG=$(jq -r .app_tag <<<"$DESIRED")
ITOP_TAG=$(jq -r .itop_tag <<<"$DESIRED")
IMAGE_BASE=$(jq -r .image_base <<<"$DESIRED")
SIGNING_KEY=$(jq -r '.signing_key // ""' <<<"$DESIRED")

status() {
  jq -n --arg id "$ID" --arg s "$1" --arg at "$(date -u +%FT%TZ)" '{id:$id, state:$s, at:$at}' |
    aws s3 cp - "s3://$BUCKET/control/status.json" --only-show-errors
}

# Marked first: a release that fails is not retried in a loop. Releasing
# again (or rolling back) in the pipeline writes a new id.
echo "$ID" > "$STATE/release_id"
status running
LOG=$(mktemp)
REL=$ROOT/releases/$APP_TAG
set +e
(
  set -e
  echo "[agent] release $ID: app $APP_TAG, iTop $ITOP_TAG"
  mkdir -p "$REL"
  aws s3 cp "s3://$BUCKET/bundles/$APP_TAG.tgz" /tmp/iraops-bundle.tgz --only-show-errors
  tar -xzf /tmp/iraops-bundle.tgz -C "$REL"
  rm -f /tmp/iraops-bundle.tgz
  bash "$REL/deploy/azure/server/deploy.sh" "$APP_TAG" "$ITOP_TAG" "$IMAGE_BASE" "$REGION" "$SIGNING_KEY"
) >"$LOG" 2>&1
CODE=$?
set -e
aws s3 cp "$LOG" "s3://$BUCKET/control/logs/$ID.log" --only-show-errors || true
cp "$LOG" "$STATE/last-release.log"
rm -f "$LOG"

if [ "$CODE" = 0 ]; then
  # The release's own copy of this agent takes over from the next run.
  install -m 755 "$REL/deploy/azure/server/release-agent.sh" /usr/local/bin/iraops-release-agent
  status succeeded
else
  status failed
fi
