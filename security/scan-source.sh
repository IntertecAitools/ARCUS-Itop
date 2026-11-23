#!/usr/bin/env bash
# SEC-02: the source scans, run by the AWS build (deploy/aws/buildspec-build.yml)
# and by GitHub CI (.github/workflows/ci.yml). Policy, thresholds and how to
# accept a risk: security/README.md.
#
#   1. secrets           gitleaks   (Git history when .git is there, else the files)
#   2. dependencies      trivy fs   (npm and composer lock files)
#   3. infrastructure    trivy config (Terraform, Dockerfiles)
#   4. static analysis   semgrep    (Semgrep registry rules, p/default)
#
# Every scan runs; the script fails at the end if any found a critical/high
# finding (Semgrep: severity ERROR) that is not accepted. Reports go to
# $SECURITY_REPORTS/source (default security-reports/source).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# shellcheck source=security/versions.env
. security/versions.env
TOOLS=${SECURITY_TOOLS_DIR:-$ROOT/.security-tools}
OUT=${SECURITY_REPORTS:-$ROOT/security-reports}/source
TRIVY_CACHE=${TRIVY_CACHE_DIR:-$TOOLS/trivy-cache}
mkdir -p "$OUT"
export PATH="$TOOLS:$PATH"

bash security/install-tools.sh || exit 1

failed=()
step() { echo; echo "=== $1"; }
result() { # name exit-code
  if [ "$2" -eq 0 ]; then echo "--- $1: passed"; else echo "--- $1: FAILED"; failed+=("$1"); fi
}

# --- 1. Secrets
step "secrets (gitleaks $GITLEAKS_VERSION)"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ "$(git rev-parse --is-shallow-repository)" = false ]; then
  gitleaks git . --no-banner --redact --report-format json --report-path "$OUT/gitleaks.json"
else
  # The AWS build gets the source without Git history.
  gitleaks dir . --no-banner --redact --report-format json --report-path "$OUT/gitleaks.json"
fi
result secrets $?

# --- 2. Dependencies. Only findings with a fixed version fail the build:
# there is nothing to upgrade to for the others (they are still reported).
TRIVY_COMMON=(--cache-dir "$TRIVY_CACHE" --quiet --ignorefile security/trivyignore.yaml
  --skip-dirs .security-tools --skip-dirs security-reports --skip-dirs '**/node_modules' --skip-dirs '**/.terraform')
step "dependencies (trivy $TRIVY_VERSION)"
# The full report first (every severity), then the gate, which prints what fails.
trivy fs "${TRIVY_COMMON[@]}" --scanners vuln --format json -o "$OUT/dependencies.json" .
trivy fs "${TRIVY_COMMON[@]}" --scanners vuln --skip-db-update   --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 .
result dependencies $?

# --- 3. Infrastructure as code. Upstream iTop ships its own CI files.
step "infrastructure as code (trivy $TRIVY_VERSION)"
trivy config "${TRIVY_COMMON[@]}" --skip-dirs iTop --format json -o "$OUT/iac.json" .
trivy config "${TRIVY_COMMON[@]}" --skip-dirs iTop --severity CRITICAL,HIGH --exit-code 1 .
result iac $?

# --- 4. Static analysis. Skips what .semgrepignore lists.
step "static analysis (semgrep $SEMGREP_VERSION)"
semgrep scan --config p/default --metrics=off --severity ERROR --error --text   --json-output="$OUT/semgrep.json" .
result static-analysis $?

echo
if [ ${#failed[@]} -gt 0 ]; then
  echo "Security scans FAILED: ${failed[*]}. Reports: $OUT. Fix, or accept the risk (security/README.md)."
  exit 1
fi
echo "Security scans passed. Reports: $OUT"
