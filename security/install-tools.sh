#!/usr/bin/env bash
# Installs the pinned security tools (security/versions.env) into
# $SECURITY_TOOLS_DIR (default .security-tools/), checking each download's
# SHA-256. Linux x86-64 only (CodeBuild, GitHub Actions); elsewhere put the
# same versions in that folder or on PATH yourself.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=security/versions.env
. "$ROOT/security/versions.env"
TOOLS=${SECURITY_TOOLS_DIR:-$ROOT/.security-tools}
mkdir -p "$TOOLS"

have() { [ -x "$TOOLS/$1" ] || [ -x "$TOOLS/$1.exe" ] || command -v "$1" >/dev/null 2>&1; }

fetch() { # url sha256 file
  curl -fsSL --retry 3 -o "$3" "$1"
  echo "$2  $3" | sha256sum -c --quiet - || { echo "Checksum mismatch for $1" >&2; rm -f "$3"; exit 1; }
}

if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  for t in trivy gitleaks semgrep; do
    have "$t" || { echo "$t not found: put $t in $TOOLS or on PATH (see security/versions.env)" >&2; exit 1; }
  done
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! "$TOOLS/trivy" --version 2>/dev/null | grep -q "Version: $TRIVY_VERSION"; then
  fetch "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
    "$TRIVY_SHA256" "$tmp/trivy.tgz"
  tar -xzf "$tmp/trivy.tgz" -C "$TOOLS" trivy
fi

if ! "$TOOLS/gitleaks" version 2>/dev/null | grep -q "$GITLEAKS_VERSION"; then
  fetch "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    "$GITLEAKS_SHA256" "$tmp/gitleaks.tgz"
  tar -xzf "$tmp/gitleaks.tgz" -C "$TOOLS" gitleaks
fi

# Semgrep from PyPI into a virtualenv of its own (no Docker Hub pulls,
# which CodeBuild's shared addresses hit the rate limit of).
if ! "$TOOLS/semgrep-venv/bin/semgrep" --version 2>/dev/null | grep -qx "$SEMGREP_VERSION"; then
  python3 -m venv "$TOOLS/semgrep-venv"
  "$TOOLS/semgrep-venv/bin/pip" install --quiet --disable-pip-version-check "semgrep==$SEMGREP_VERSION"
fi
ln -sf "$TOOLS/semgrep-venv/bin/semgrep" "$TOOLS/semgrep"

echo "security tools: trivy $TRIVY_VERSION, gitleaks $GITLEAKS_VERSION, semgrep $SEMGREP_VERSION (in $TOOLS)"
