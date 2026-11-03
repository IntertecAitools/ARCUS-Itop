#!/usr/bin/env bash
# Sends the deploy to the server (SSM Run Command) and waits for it.
# Needs APP_TAG, ITOP_TAG (from the Build stage) and INSTANCE_ID,
# ARTIFACT_BUCKET, IMAGE_BASE, PARAM_PATH, BACKUP_BUCKET, DEPLOY_LOG_GROUP
# (the CodeBuild project's environment). Also usable by hand for a rollback:
#   APP_TAG=<older tag> ITOP_TAG=<its itop tag> ... bash run-deploy.sh
set -euo pipefail

: "${APP_TAG:?}" "${ITOP_TAG:?}" "${INSTANCE_ID:?}" "${ARTIFACT_BUCKET:?}" "${IMAGE_BASE:?}"
: "${PARAM_PATH:?}" "${BACKUP_BUCKET:?}" "${DEPLOY_LOG_GROUP:?}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

# What runs on the server: fetch this release's bundle, run its deploy.sh.
# SSM runs this with /bin/sh (dash): POSIX only here; deploy.sh is bash.
read -r -d '' SCRIPT <<EOF || true
set -eu
REL=/opt/arcus/releases/$APP_TAG
mkdir -p "\$REL"
aws s3 cp "s3://$ARTIFACT_BUCKET/bundles/$APP_TAG.tgz" /tmp/arcus-bundle.tgz --region $REGION --only-show-errors
tar -xzf /tmp/arcus-bundle.tgz -C "\$REL"
rm -f /tmp/arcus-bundle.tgz
exec bash "\$REL/deploy/aws/server/deploy.sh" "$APP_TAG" "$ITOP_TAG" "$IMAGE_BASE" "$PARAM_PATH" "$REGION" "$BACKUP_BUCKET"
EOF

jq -n --arg c "$SCRIPT" '{commands: [$c], executionTimeout: ["5400"]}' > /tmp/ssm-params.json

echo "Deploying app $APP_TAG, iTop $ITOP_TAG to $INSTANCE_ID"
CMD_ID=$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "deploy $APP_TAG" \
  --timeout-seconds 600 \
  --parameters file:///tmp/ssm-params.json \
  --cloud-watch-output-config "CloudWatchOutputEnabled=true,CloudWatchLogGroupName=$DEPLOY_LOG_GROUP" \
  --query Command.CommandId --output text)
echo "SSM command $CMD_ID (log group $DEPLOY_LOG_GROUP, stream $CMD_ID/$INSTANCE_ID/...)"

STATUS=Pending
while :; do
  sleep 15
  STATUS=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Pending|InProgress|Delayed) echo "  ... $STATUS" ;;
    *) break ;;
  esac
done

aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent --output text | tail -n 80
ERR=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query StandardErrorContent --output text | tail -n 40)
[ -n "$ERR" ] && [ "$ERR" != "None" ] && { echo "--- stderr"; echo "$ERR"; }

echo "Deploy finished: $STATUS"
[ "$STATUS" = Success ]
