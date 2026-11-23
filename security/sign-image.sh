#!/usr/bin/env bash
# SEC-05: signs images already in their registry, by digest, with cosign.
#
#   sign-image.sh <key> <image:tag> [<image:tag> ...]
#
# <key> is a cosign key reference: in the AWS build the KMS key,
# awskms:///alias/arcus-servicedesk-image-signing (IMAGE_SIGNING_KEY); in the
# CI test a throwaway key file. The private key never leaves KMS.
#
# An image whose digest already carries a valid signature is left alone
# (ECR tags are immutable, and a reused image was signed when first built).
# Signatures are not sent to the public Sigstore transparency log: they live
# next to the image in the registry (tag sha256-<digest>.sig).
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: $0 <key> <image:tag>..." >&2; exit 2; }
KEY=$1
shift
HERE=$(cd "$(dirname "$0")" && pwd)
COSIGN=$(bash "$HERE/install-cosign.sh")

# repo@sha256:... for an image:tag, from the registry (not a local copy).
by_digest() {
  local ref=$1 repo sig
  repo=$ref
  [[ ${ref##*/} == *:* ]] && repo=${ref%:*}
  sig=$("$COSIGN" triangulate "$ref")        # <repo>:sha256-<hex>.sig
  sig=${sig##*:sha256-}
  echo "$repo@sha256:${sig%.sig}"
}

# The public half, to tell whether an image is signed already (verifying
# needs the public key; for a KMS key it is fetched from KMS).
PUB=$(mktemp)
trap 'rm -f "$PUB"' EXIT
"$COSIGN" public-key --key "$KEY" > "$PUB"

for ref in "$@"; do
  img=$(by_digest "$ref")
  if "$COSIGN" verify --key "$PUB" --insecure-ignore-tlog=true "$img" >/dev/null 2>&1; then
    echo "signed already: $ref ($img)"
    continue
  fi
  "$COSIGN" sign --yes --key "$KEY" --tlog-upload=false "$img"
  echo "signed: $ref ($img)"
done
