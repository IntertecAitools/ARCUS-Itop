#!/usr/bin/env bash
# "WaitForBuild" in the iraops-release pipeline: IRAOPS never builds. It waits
# until the Intertec pipeline (deploy/aws) has built and tested this commit,
# and takes the image tags from that build. Prints APP_TAG=... and ITOP_TAG=...
# on its last two lines. Fails when that build failed, or nothing built this
# commit within WAIT_MINUTES.
#
# Needs COMMIT, INTERTEC_PIPELINE, INTERTEC_BUCKET, ECR_PREFIX.
set -euo pipefail
: "${COMMIT:?}" "${INTERTEC_PIPELINE:?}" "${INTERTEC_BUCKET:?}" "${ECR_PREFIX:?}"
WAIT_MINUTES=${WAIT_MINUTES:-110}
APP_TAG=$(echo "$COMMIT" | cut -c1-12)
deadline=$(( $(date +%s) + WAIT_MINUTES * 60 ))

echo "Waiting for the Intertec build of $COMMIT ($INTERTEC_PIPELINE)"
while :; do
  # The runs of the Intertec pipeline for this commit, newest first.
  summaries=$(aws codepipeline list-pipeline-executions --pipeline-name "$INTERTEC_PIPELINE" --max-items 50 --output json)
  runs=$(jq -r --arg c "$COMMIT" '.pipelineExecutionSummaries[] | select(any(.sourceRevisions[]?; .revisionId == $c)) | .pipelineExecutionId' <<<"$summaries")
  failed=0 total=0
  for run in $runs; do
    total=$((total + 1))
    build=$(aws codepipeline list-action-executions --pipeline-name "$INTERTEC_PIPELINE" \
      --filter "pipelineExecutionId=$run" --output json |
      jq -c '[.actionExecutionDetails[] | select(.stageName == "Build")] | first // empty')
    [ -n "$build" ] || build='{}'
    status=$(jq -r '.status // "Waiting"' <<<"$build")
    case "$status" in
      Succeeded)
        ITOP_TAG=$(jq -r '.output.outputVariables.ITOP_TAG' <<<"$build")
        BUILT_TAG=$(jq -r '.output.outputVariables.APP_TAG' <<<"$build")
        [ "$BUILT_TAG" = "$APP_TAG" ] || { echo "The build says app $BUILT_TAG, expected $APP_TAG" >&2; exit 1; }
        echo "Built and tested by Intertec run $run: app $APP_TAG, iTop $ITOP_TAG"
        # The images and the bundle are there (ECR keeps the 30 newest).
        for repo in arcus-bff:$APP_TAG arcus-web:$APP_TAG arcus-itop:$ITOP_TAG; do
          aws ecr describe-images --repository-name "$ECR_PREFIX/${repo%%:*}" --image-ids "imageTag=${repo#*:}" >/dev/null
        done
        aws s3api head-object --bucket "$INTERTEC_BUCKET" --key "bundles/$APP_TAG.tgz" >/dev/null
        echo "APP_TAG=$APP_TAG"
        echo "ITOP_TAG=$ITOP_TAG"
        exit 0
        ;;
      Failed|Abandoned) failed=$((failed + 1)) ;;
    esac
    # A run stopped or superseded before its Build counts as failed too.
    rs=$(jq -r --arg r "$run" '.pipelineExecutionSummaries[] | select(.pipelineExecutionId == $r) | .status' <<<"$summaries")
    if [ "$status" != Succeeded ] && [ "$status" != Failed ] && [ "$status" != Abandoned ] && \
       { [ "$rs" = Stopped ] || [ "$rs" = Superseded ] || [ "$rs" = Failed ]; }; then
      failed=$((failed + 1))
    fi
  done
  if [ "$total" -gt 0 ] && [ "$failed" = "$total" ]; then
    echo "The Intertec build of $COMMIT failed or was stopped: nothing to release. Fix it there first." >&2
    exit 1
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "No finished Intertec build of $COMMIT after $WAIT_MINUTES minutes." >&2
    exit 1
  fi
  echo "  ... ${total} run(s) for this commit, build not finished yet"
  sleep 30
done
