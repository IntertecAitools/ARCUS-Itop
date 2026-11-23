#!/usr/bin/env bash
# Installs the pinned cosign (security/versions.env) into $COSIGN_DIR (default
# .security-tools/), checking the download's SHA-256, and prints its path.
# Used by the build (sign-image.sh) and the server (verify-image.sh).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=security/versions.env
. "$HERE/versions.env"
DIR=${COSIGN_DIR:-$HERE/../.security-tools}
mkdir -p "$DIR"
BIN=$DIR/cosign

if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  # Elsewhere (a developer's machine): the same version, put there by hand.
  command -v cosign >/dev/null 2>&1 && { command -v cosign; exit 0; }
  [ -x "$BIN.exe" ] && { echo "$BIN.exe"; exit 0; }
  echo "cosign $COSIGN_VERSION not found: put it in $DIR or on PATH" >&2
  exit 1
fi

if ! "$BIN" version 2>/dev/null | grep -q "v$COSIGN_VERSION"; then
  tmp=$(mktemp)
  curl -fsSL --retry 3 -o "$tmp" \
    "https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign-linux-amd64"
  echo "$COSIGN_SHA256  $tmp" | sha256sum -c --quiet - || { echo "cosign: checksum mismatch" >&2; rm -f "$tmp"; exit 1; }
  install -m 0755 "$tmp" "$BIN"
  rm -f "$tmp"
fi
echo "$BIN"
