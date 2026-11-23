#!/usr/bin/env bash
# SEC-03 and SEC-04 for one image: a vulnerability report, its SBOM, and the
# gate. Run by the AWS build before an image is pushed (or before an image
# already in ECR is reused), and by GitHub CI on the images it builds.
#
#   scan-image.sh <name> <image>      e.g. scan-image.sh arcus-bff 1234.dkr.ecr.../arcus-bff:abc
#
# Writes, under $SECURITY_REPORTS (default security-reports/):
#   images/<name>.json      every vulnerability Trivy finds (all severities)
#   sbom/<name>.cdx.json    the image's SBOM (CycloneDX: OS packages and libraries)
# then fails if a CRITICAL or HIGH vulnerability with a fixed version is not
# accepted in security/trivyignore.yaml (security/README.md).
set -uo pipefail

[ $# -eq 2 ] || { echo "usage: $0 <name> <image>" >&2; exit 2; }
NAME=$1 IMAGE=$2
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# shellcheck source=security/versions.env
. security/versions.env
TOOLS=${SECURITY_TOOLS_DIR:-$ROOT/.security-tools}
OUT=${SECURITY_REPORTS:-$ROOT/security-reports}
mkdir -p "$OUT/images" "$OUT/sbom"
export PATH="$TOOLS:$PATH"

bash security/install-tools.sh >/dev/null || exit 1

# The image as built here (Docker), else from its registry.
COMMON=(--cache-dir "${TRIVY_CACHE_DIR:-$TOOLS/trivy-cache}" --quiet
  --ignorefile security/trivyignore.yaml --scanners vuln)

echo "=== image $NAME ($IMAGE), trivy $TRIVY_VERSION"
trivy image "${COMMON[@]}" --format json -o "$OUT/images/$NAME.json" "$IMAGE" || exit 1
trivy convert --format cyclonedx -o "$OUT/sbom/$NAME.cdx.json" "$OUT/images/$NAME.json" || exit 1

# The gate: prints what fails. The image layers are cached by the scan above.
if trivy image "${COMMON[@]}" --skip-db-update --severity CRITICAL,HIGH --ignore-unfixed \
    --exit-code 1 --format table "$IMAGE"; then
  echo "--- image $NAME: passed"
else
  echo "--- image $NAME: FAILED. Report: $OUT/images/$NAME.json. Fix (usually a newer base image), or accept the risk (security/README.md)."
  exit 1
fi
