#!/usr/bin/env bash
# SEC-05: checks that images carry a valid signature from our key, before the
# server starts them (deploy/aws/server/deploy.sh). Fails on the first image
# that is unsigned, signed by another key, or changed since it was signed.
#
#   verify-image.sh <key> <image:tag> [<image:tag> ...]
#
# <key>: awskms:///alias/arcus-servicedesk-image-signing on the server (only
# the public key is fetched; the server cannot sign), a public key file in
# the CI test. The signature covers the image's digest, and the tag must
# resolve to that digest in the registry.
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: $0 <key> <image:tag>..." >&2; exit 2; }
KEY=$1
shift
HERE=$(cd "$(dirname "$0")" && pwd)
COSIGN=$(bash "$HERE/install-cosign.sh")

for ref in "$@"; do
  if ! "$COSIGN" verify --key "$KEY" --insecure-ignore-tlog=true "$ref" >/dev/null; then
    echo "SIGNATURE CHECK FAILED: $ref is not signed with $KEY" >&2
    exit 1
  fi
  # The copy Docker pulled must be the one that was checked.
  if command -v docker >/dev/null 2>&1 && docker image inspect "$ref" >/dev/null 2>&1; then
    sig=$("$COSIGN" triangulate "$ref")
    digest=sha256:${sig##*:sha256-}
    digest=${digest%.sig}
    if ! docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" | grep -q "@$digest$"; then
      echo "SIGNATURE CHECK FAILED: the pulled $ref is not the signed image ($digest)" >&2
      exit 1
    fi
  fi
  echo "signature ok: $ref"
done
