#!/usr/bin/env bash
# SEC-04: the SBOMs of the backend (BFF) and the frontend, from their lock
# files, in CycloneDX. The images' own SBOMs come from security/scan-image.sh.
#
# Writes $SECURITY_REPORTS/sbom/{backend,frontend}.cdx.json (default security-reports/).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# shellcheck source=security/versions.env
. security/versions.env
TOOLS=${SECURITY_TOOLS_DIR:-$ROOT/.security-tools}
OUT=${SECURITY_REPORTS:-$ROOT/security-reports}
mkdir -p "$OUT/sbom"
export PATH="$TOOLS:$PATH"

bash security/install-tools.sh >/dev/null

for app in backend frontend; do
  trivy fs --cache-dir "${TRIVY_CACHE_DIR:-$TOOLS/trivy-cache}" --quiet --skip-dirs '**/node_modules' \
    --format cyclonedx -o "$OUT/sbom/$app.cdx.json" "$app"
  echo "SBOM: $OUT/sbom/$app.cdx.json"
done
