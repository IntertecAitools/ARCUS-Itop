import { DEV_KID, INTERTEC_PUBLIC_KEYS, verifyLicence, type LicenceEnvelope, type TrustedKey, type VerifyResult } from "./sdk/index.js";
import { validateArcusEntitlements, type ArcusEntitlements } from "./editions.js";

export const ARCUS_PRODUCT = "arcus";

export type ArcusLicence = LicenceEnvelope<ArcusEntitlements>;

export interface ArcusKeyOptions {
  /** Accept development licences (kid "dev"). False on production builds. */
  allowDevKey: boolean;
  /** The development public key (PEM), when one has been generated locally. */
  devPublicKeyPem?: string;
}

/** The keys this build trusts: Intertec's, plus the development key where allowed. */
export function trustedKeys(options: ArcusKeyOptions): TrustedKey[] {
  const keys = [...INTERTEC_PUBLIC_KEYS];
  if (options.allowDevKey && options.devPublicKeyPem) keys.push({ kid: DEV_KID, alg: "Ed25519", publicKeyPem: options.devPublicKeyPem });
  return keys;
}

/** Verifies an Arcus licence file: signature, format, product and every field. */
export function verifyArcusLicence(text: string, options: ArcusKeyOptions & { keys?: TrustedKey[] }): VerifyResult<ArcusEntitlements> {
  return verifyLicence<ArcusEntitlements>(text, {
    product: ARCUS_PRODUCT,
    trustedKeys: options.keys ?? trustedKeys(options),
    allowDevKey: options.allowDevKey,
    validateEntitlements: validateArcusEntitlements,
  });
}
