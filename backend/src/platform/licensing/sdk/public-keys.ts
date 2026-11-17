import type { Algorithm } from "./format.js";

/**
 * Intertec's licence-signing public keys, by `kid`. Only these are trusted:
 * a licence signed by any other key is refused. Changing this list is a code
 * change and a release, which is intended (Build Guide, section 12,
 * "Changing the signing key"): add the new key, ship, sign with it, and
 * remove the old one in a later release.
 *
 * The production key lives in AWS KMS (alias `arcus-licence-signing`,
 * deploy/aws/terraform/licensing.tf). Its public half is added here once the
 * key has been created:
 *
 *   aws kms get-public-key --key-id alias/arcus-licence-signing \
 *     --query PublicKey --output text | base64 -d | openssl pkey -pubin -inform DER
 *
 * Until then the list is empty and only development licences (kid `dev`, on
 * a build that allows them) verify.
 */
export interface TrustedKey {
  kid: string;
  alg: Algorithm;
  /** SPKI public key, PEM. */
  publicKeyPem: string;
}

export const INTERTEC_PUBLIC_KEYS: readonly TrustedKey[] = [];

/** The kid of the development key. Production builds refuse it. */
export const DEV_KID = "dev";
