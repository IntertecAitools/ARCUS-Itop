#!/usr/bin/env bash
# Hands an approved release to the IRAOPS server and waits for its answer.
# The server is never reached from here: it asks for control/release.json
# every minute (deploy/azure/server/release-agent.sh) and writes
# control/status.json and control/logs/<id>.log back.
#
# Needs APP_TAG, ITOP_TAG, RELEASE_BUCKET, IMAGE_BASE; IMAGE_SIGNING_KEY when
# image signing is on. Also usable by hand for a rollback:
#   APP_TAG=<older> ITOP_TAG=<its itop tag> RELEASE_BUCKET=... IMAGE_BASE=... bash release.sh
set -euo pipefail
: "${APP_TAG:?}" "${ITOP_TAG:?}" "${RELEASE_BUCKET:?}" "${IMAGE_BASE:?}"

aws s3api head-object --bucket "$RELEASE_BUCKET" --key "bundles/$APP_TAG.tgz" >/dev/null ||
  { echo "No IRAOPS bundle for $APP_TAG in $RELEASE_BUCKET" >&2; exit 1; }

ID="$(date -u +%Y%m%dT%H%M%SZ)-$APP_TAG"
jq -n --arg id "$ID" --arg a "$APP_TAG" --arg i "$ITOP_TAG" --arg b "$IMAGE_BASE" --arg k "${IMAGE_SIGNING_KEY:-}" \
  '{id:$id, app_tag:$a, itop_tag:$i, image_base:$b, signing_key:$k}' |
  aws s3 cp - "s3://$RELEASE_BUCKET/control/release.json" --only-show-errors
echo "Release $ID handed to the IRAOPS server (app $APP_TAG, iTop $ITOP_TAG)"

status() { aws s3 cp "s3://$RELEASE_BUCKET/control/status.json" - 2>/dev/null || echo '{}'; }

# The server picks it up within a minute or two; the deploy takes about 2
# minutes, or about 15 on the first install or an iTop upgrade.
start=$(date +%s) state=waiting
while :; do
  sleep 20
  s=$(status)
  if [ "$(jq -r '.id // ""' <<<"$s")" = "$ID" ]; then
    state=$(jq -r .state <<<"$s")
  fi
  elapsed=$(( $(date +%s) - start ))
  case "$state" in
    succeeded|failed) break ;;
    waiting)
      if [ "$elapsed" -gt 600 ]; then
        echo "The IRAOPS server did not pick the release up in 10 minutes (is it running? its release agent?)." >&2
        exit 1
      fi
      echo "  ... waiting for the server" ;;
    *)
      if [ "$elapsed" -gt 6000 ]; then echo "No result after 100 minutes." >&2; exit 1; fi
      echo "  ... $state" ;;
  esac
done

echo "--- the server's deploy log"
aws s3 cp "s3://$RELEASE_BUCKET/control/logs/$ID.log" - 2>/dev/null | tail -n 120 || echo "(no log)"
echo "Release $ID: $state"
[ "$state" = succeeded ]
