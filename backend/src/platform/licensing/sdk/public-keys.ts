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
 * Licences signed with it carry kid `arcus-2026-1` (LICENCE_KMS_KID).
 */
export interface TrustedKey {
  kid: string;
  alg: Algorithm;
  /** SPKI public key, PEM. */
  publicKeyPem: string;
}

export const INTERTEC_PUBLIC_KEYS: readonly TrustedKey[] = [
  {
    // AWS KMS key alias/arcus-licence-signing (RSA_3072), created 2026-11-19:
    // arn:aws:kms:us-east-1:557690608274:key/1de62b71-d9fd-4859-88ee-2bdc18a6ab3d
    kid: "arcus-2026-1",
    alg: "RSA-PSS-SHA256",
    publicKeyPem: [
      "-----BEGIN PUBLIC KEY-----",
      "MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAjjKr9DlyUwg7U3u5Vkrs",
      "ZAK/sQiHowDjjdiKVT9MnOL2K1o8AXQnsZZet2abowgpOE0V16L4XWVUoStv85KU",
      "ZZelQekf4cl7xTvt5NFSmXmIxtTiKbEw5HJ6u5Pk+owvEs9EzzjTjDjfez6zW2SG",
      "+mUnGWUHGnRHU4MKtjHRBdrjT4LoJ+/eeB80Lar2D7k2JFZgceIojWp+Phok/RW4",
      "Hlg13P/4ICWng2k2CkUPnDyDNcVkPOFxbbbn3J/k8NKKN1c4+6YmXJRt/F4NSGp3",
      "DYrtUEE8jAPhGn5MPGwyAV8UJ821uG441QE9s4mryOohspO2S4RfRk1WV9n6+Ktv",
      "Gz73OsFB7nWAr7JG/j7s7n8E2N9gPryK5rWUd822u+KfAcHGcr0YjLBcK1cmaLKF",
      "snjISMa5MxeXvBr1uaSAEHpi8KKpAQJKc7ynfvZRcDjLuwBcG/Cvgh8zicY8Mv3K",
      "8Di5tHRrBBXKCeNyVZ0Xhy64I5zplyx4AqBsj0tGpfW9AgMBAAE=",
      "-----END PUBLIC KEY-----",
      "",
    ].join("\n"),
  },
];

/** The kid of the development key. Production builds refuse it. */
export const DEV_KID = "dev";
